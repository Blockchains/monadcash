// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShowcaseRefiller} from "../src/ShowcaseRefiller.sol";

contract EmptyReceiver { receive() external payable {} } // like AgentVault.receive()
contract RevertingReceiver { receive() external payable { revert("no"); } }
contract GasHog { uint256 x; receive() external payable { for (uint256 i; i < 1000; ++i) x += i; } }
contract Reenterer {
    ShowcaseRefiller public r; bool public tried; bool public reentered;
    function set(ShowcaseRefiller r_) external { r = r_; }
    receive() external payable {
        if (address(r) != address(0) && !tried) {
            tried = true;
            try r.refill(true) { reentered = true; } catch {}
            try r.withdraw(1) { reentered = true; } catch {}
        }
    }
}

contract ShowcaseRefillerTest is Test {
    ShowcaseRefiller r;
    address owner = makeAddr("deployer");
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");
    address idleAgent = makeAddr("idle3");
    address stranger = makeAddr("stranger");
    EmptyReceiver vault; EmptyReceiver rogueVault;
    uint256 constant PER_CALL = 250 ether; uint256 constant DAILY = 350 ether; uint256 constant CD = 15 minutes;

    function _slots() internal returns (ShowcaseRefiller.Slot[] memory s) {
        vault = new EmptyReceiver(); rogueVault = new EmptyReceiver();
        s = new ShowcaseRefiller.Slot[](5);
        s[0] = ShowcaseRefiller.Slot(payable(agentA), 15 ether, 30 ether);
        s[1] = ShowcaseRefiller.Slot(payable(agentB), 15 ether, 30 ether);
        s[2] = ShowcaseRefiller.Slot(payable(idleAgent), 1 ether, 2 ether);
        s[3] = ShowcaseRefiller.Slot(payable(address(vault)), 10 ether, 20 ether);
        s[4] = ShowcaseRefiller.Slot(payable(address(rogueVault)), 0.2 ether, 0.5 ether);
    }
    function _callers() internal view returns (address[] memory c) { c = new address[](3); c[0] = agentA; c[1] = agentB; c[2] = idleAgent; }

    function setUp() public {
        vm.warp(1_800_000_000);
        ShowcaseRefiller.Slot[] memory s = _slots();
        vm.deal(owner, 10_000 ether);
        vm.prank(owner);
        r = new ShowcaseRefiller{value: 1000 ether}(s, _callers(), PER_CALL, DAILY, CD);
    }

    // ---------- constructor / allowlist ----------
    function test_config() public view {
        assertEq(r.owner(), owner);
        assertEq(r.slotCount(), 5);
        assertTrue(r.isRecipient(agentA) && r.isRecipient(address(vault)) && !r.isRecipient(stranger));
        assertTrue(r.isCaller(agentA) && !r.isCaller(address(vault)) && !r.isCaller(stranger) && !r.isCaller(owner));
        (address to, uint96 mn, uint96 tg) = r.slot(3);
        assertEq(to, address(vault)); assertEq(mn, 10 ether); assertEq(tg, 20 ether);
        assertEq(address(r).balance, 1000 ether);
    }
    function test_constructorRejectsBadConfig() public {
        ShowcaseRefiller.Slot[] memory s = _slots(); address[] memory c = _callers();
        vm.expectRevert(ShowcaseRefiller.BadConfig.selector); new ShowcaseRefiller(new ShowcaseRefiller.Slot[](0), c, 1, 1, 1);
        vm.expectRevert(ShowcaseRefiller.BadConfig.selector); new ShowcaseRefiller(s, c, 0, 1, 1);
        vm.expectRevert(ShowcaseRefiller.BadConfig.selector); new ShowcaseRefiller(s, c, 2, 1, 1);
        vm.expectRevert(ShowcaseRefiller.BadConfig.selector); new ShowcaseRefiller(s, c, 1, 1, 0);
        s[1].to = payable(address(0));
        vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.BadSlot.selector, 1)); new ShowcaseRefiller(s, c, 1, 1, 1);
        s = _slots(); s[2].min = 3 ether;
        vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.BadSlot.selector, 2)); new ShowcaseRefiller(s, c, 1, 1, 1);
        s = _slots(); s[0].target = 0; s[0].min = 0;
        vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.BadSlot.selector, 0)); new ShowcaseRefiller(s, c, 1, 1, 1);
        s = _slots(); s[1].to = payable(agentA);
        vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.DuplicateRecipient.selector, agentA)); new ShowcaseRefiller(s, c, 1, 1, 1);
        s = _slots(); c[1] = stranger;
        vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.CallerNotRecipient.selector, stranger)); new ShowcaseRefiller(s, c, 1, 1, 1);
    }
    function test_noSetterExists() public {
        // the allowlist is immutable: any unknown selector (e.g. setSlots/addRecipient/setOwner) reverts
        (bool ok,) = address(r).call(abi.encodeWithSignature("setSlots((address,uint96,uint96)[])", new ShowcaseRefiller.Slot[](0)));
        assertFalse(ok);
        vm.prank(owner); (ok,) = address(r).call(abi.encodeWithSignature("addRecipient(address)", stranger));
        assertFalse(ok);
        vm.prank(owner); (ok,) = address(r).call(abi.encodeWithSignature("transferOwnership(address)", stranger));
        assertFalse(ok);
    }

    // ---------- callers ----------
    function test_strangerCannotRefill() public {
        vm.prank(stranger); vm.expectRevert(ShowcaseRefiller.NotCaller.selector); r.refill(true);
        vm.prank(address(vault)); vm.expectRevert(ShowcaseRefiller.NotCaller.selector); r.refill(false); // recipient but not caller
    }
    function test_agentAndOwnerCanRefill() public {
        vm.prank(agentB); assertGt(r.refill(false), 0);
        vm.warp(block.timestamp + CD); vm.deal(agentA, 0);
        vm.prank(owner); assertEq(r.refill(false), 30 ether);
    }

    // ---------- targets ----------
    function test_refillToTargets() public {
        vm.prank(agentA); uint256 sent = r.refill(false);
        assertEq(agentA.balance, 30 ether); assertEq(agentB.balance, 30 ether); assertEq(idleAgent.balance, 2 ether);
        assertEq(address(vault).balance, 20 ether); assertEq(address(rogueVault).balance, 0.5 ether);
        assertEq(sent, 82.5 ether); assertEq(address(r).balance, 1000 ether - 82.5 ether);
        assertEq(stranger.balance, 0);
    }
    function test_normalSkipsAboveMinButFullTopsUp() public {
        vm.deal(agentA, 20 ether); vm.deal(address(vault), 12 ether); vm.deal(agentB, 30 ether);
        vm.deal(idleAgent, 2 ether); vm.deal(address(rogueVault), 0.5 ether);
        (uint256 p, uint256 n) = r.pending(false); assertEq(p, 0); assertEq(n, 0);
        vm.prank(agentA); assertEq(r.refill(false), 0);
        assertEq(r.lastRefill(), 0, "no-op does not start cooldown");
        (p, n) = r.pending(true); assertEq(p, 18 ether); assertEq(n, 2);
        vm.prank(agentA); assertEq(r.refill(true), 18 ether);
        assertEq(agentA.balance, 30 ether); assertEq(address(vault).balance, 20 ether);
    }
    function test_neverAboveTarget() public {
        vm.deal(agentA, 31 ether); vm.deal(agentB, 29.99 ether); // above target / dust below target
        vm.prank(agentA); r.refill(true);
        assertEq(agentA.balance, 31 ether); assertEq(agentB.balance, 29.99 ether);
    }

    // ---------- caps ----------
    function test_perCallCap() public {
        ShowcaseRefiller.Slot[] memory s = _slots(); vm.prank(owner);
        ShowcaseRefiller small = new ShowcaseRefiller{value: 1000 ether}(s, _callers(), 40 ether, 1000 ether, CD);
        vm.prank(agentA); assertEq(small.refill(false), 40 ether);
        assertEq(agentA.balance, 30 ether); assertEq(agentB.balance, 10 ether, "partial top-up within the cap");
        assertEq(address(vault).balance, 0);
    }
    function test_dailyCapAndReset() public {
        ShowcaseRefiller.Slot[] memory s = _slots(); vm.prank(owner);
        ShowcaseRefiller d = new ShowcaseRefiller{value: 1000 ether}(s, _callers(), 50 ether, 100 ether, CD);
        uint256 total;
        for (uint256 i; i < 5; ++i) {
            vm.deal(agentA, 0); vm.deal(agentB, 0);
            vm.prank(agentA); total += d.refill(false);
            vm.warp(block.timestamp + CD);
        }
        assertEq(total, 100 ether, "24h cap holds across calls");
        assertEq(d.windowLeft(), 0);
        vm.warp(d.windowStart() + 1 days);
        vm.deal(agentA, 0); vm.prank(agentA); assertEq(d.refill(false), 50 ether, "cap resets after 24h");
    }
    function test_floatLimit() public {
        vm.prank(owner); r.withdraw(950 ether);
        vm.prank(agentA); assertEq(r.refill(false), 50 ether);
        assertEq(address(r).balance, 0);
    }

    // ---------- cooldown ----------
    function test_cooldown() public {
        vm.prank(agentA); r.refill(false);
        vm.deal(agentA, 0);
        vm.prank(agentB); vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.CooldownActive.selector, block.timestamp + CD)); r.refill(false);
        vm.warp(block.timestamp + CD - 1);
        vm.prank(agentB); vm.expectRevert(); r.refill(true);
        vm.warp(block.timestamp + 1);
        vm.prank(agentB); assertEq(r.refill(false), 30 ether);
        assertEq(r.readyAt(), block.timestamp + CD);
    }

    // ---------- withdraw ----------
    function test_nonOwnerCannotWithdraw() public {
        address[4] memory who = [agentA, stranger, address(vault), idleAgent];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]); vm.expectRevert(ShowcaseRefiller.NotOwner.selector); r.withdraw(1 ether);
            vm.prank(who[i]); vm.expectRevert(ShowcaseRefiller.NotOwner.selector); r.withdrawAll();
        }
        assertEq(address(r).balance, 1000 ether);
    }
    function test_ownerWithdrawGoesToOwner() public {
        uint256 b = owner.balance;
        vm.prank(owner); r.withdraw(100 ether);
        assertEq(owner.balance, b + 100 ether);
        vm.prank(owner); vm.expectRevert(abi.encodeWithSelector(ShowcaseRefiller.InsufficientFloat.selector, 901 ether, 900 ether)); r.withdraw(901 ether);
        vm.prank(owner); r.withdrawAll();
        assertEq(address(r).balance, 0); assertEq(owner.balance, b + 1000 ether);
    }
    function test_anyoneCanFund() public {
        vm.deal(stranger, 5 ether); vm.prank(stranger);
        (bool ok,) = address(r).call{value: 5 ether}(""); assertTrue(ok);
        assertEq(address(r).balance, 1005 ether);
    }

    // ---------- reentrancy / failing recipients ----------
    function test_reentrancyBlockedAndFailingRecipientSkipped() public {
        Reenterer re = new Reenterer(); RevertingReceiver bad = new RevertingReceiver(); GasHog hog = new GasHog();
        ShowcaseRefiller.Slot[] memory s = new ShowcaseRefiller.Slot[](4);
        s[0] = ShowcaseRefiller.Slot(payable(address(re)), 1 ether, 2 ether);
        s[1] = ShowcaseRefiller.Slot(payable(address(bad)), 1 ether, 2 ether);
        s[2] = ShowcaseRefiller.Slot(payable(address(hog)), 1 ether, 2 ether);
        s[3] = ShowcaseRefiller.Slot(payable(agentA), 1 ether, 2 ether);
        address[] memory c = new address[](1); c[0] = agentA;
        vm.prank(owner); ShowcaseRefiller x = new ShowcaseRefiller{value: 100 ether}(s, c, 50 ether, 100 ether, CD);
        re.set(x);
        vm.prank(agentA); uint256 sent = x.refill(false);
        assertFalse(re.reentered(), "reentry must fail");
        assertEq(address(re).balance, 2 ether);   // reentry attempt was caught inside, transfer itself fine
        assertEq(address(bad).balance, 0);        // reverting recipient skipped
        assertEq(address(hog).balance, 0);        // out-of-gas recipient skipped (SEND_GAS)
        assertEq(agentA.balance, 2 ether);        // later recipients still served
        assertEq(sent, 4 ether); assertEq(x.sentInWindow(), 4 ether, "failed sends rolled back");
        assertEq(address(x).balance, 96 ether);
    }

    // ---------- fuzz: MON only ever reaches the allowlist ----------
    function testFuzz_onlyAllowlistReceives(address caller, uint96 a, uint96 b, uint96 v) public {
        vm.assume(caller != owner && !r.isCaller(caller));
        vm.deal(agentA, a % 40 ether); vm.deal(agentB, b % 40 ether); vm.deal(address(vault), v % 25 ether);
        uint256 sb = stranger.balance; uint256 fb = address(r).balance;
        vm.prank(caller); vm.expectRevert(ShowcaseRefiller.NotCaller.selector); r.refill(true);
        uint256 before = agentA.balance + agentB.balance + idleAgent.balance + address(vault).balance + address(rogueVault).balance;
        vm.prank(agentA); uint256 sent = r.refill(true);
        uint256 after_ = agentA.balance + agentB.balance + idleAgent.balance + address(vault).balance + address(rogueVault).balance;
        assertEq(after_ - before, sent); assertEq(fb - address(r).balance, sent); assertEq(stranger.balance, sb);
        assertLe(sent, PER_CALL);
    }
}
