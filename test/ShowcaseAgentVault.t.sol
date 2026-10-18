// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentVault, CallRuleInit, TokenCapInit} from "../src/AgentVault.sol";
import {ShowcaseAgentVault, ShowcaseVaultFactory} from "../src/ShowcaseAgentVault.sol";

contract Rejecter { receive() external payable { revert("no"); } }

contract ShowcaseAgentVaultTest is Test {
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");
    address payee = makeAddr("payee");
    ShowcaseVaultFactory f;
    ShowcaseAgentVault v;

    function setUp() public {
        f = new ShowcaseVaultFactory(owner, 1000 ether, 100_000 ether);
        vm.deal(owner, 1000 ether);
        address[] memory r = new address[](1); r[0] = payee;
        vm.prank(owner);
        v = f.createVault{value: 5 ether}(agent, 0.5 ether, 100 ether, r, new CallRuleInit[](0), new TokenCapInit[](0));
    }

    function test_onlyTeamOwnerCreates() public {
        vm.prank(stranger);
        vm.expectRevert(ShowcaseVaultFactory.NotTeamOwner.selector);
        f.createVault(agent, 1, 1, new address[](0), new CallRuleInit[](0), new TokenCapInit[](0));
    }

    function test_agentSweepsToOwnerKeepsOne() public {
        uint256 b0 = owner.balance;
        vm.prank(agent);
        uint256 amt = v.sweepToOwner();
        assertEq(amt, 4 ether);
        assertEq(address(v).balance, 1 ether);
        assertEq(owner.balance, b0 + 4 ether);
        assertEq(f.totalDeposited(), 1 ether);
    }

    function test_ownerCanSweep() public {
        vm.prank(owner);
        assertEq(v.sweepToOwner(), 4 ether);
    }

    function test_sweepIdempotentAndBelowKeep() public {
        vm.startPrank(agent);
        v.sweepToOwner();
        assertEq(v.sweepToOwner(), 0);
        vm.stopPrank();
        vm.prank(owner); v.withdraw(payable(owner), 0.6 ether);
        vm.prank(agent); assertEq(v.sweepToOwner(), 0);
        assertEq(address(v).balance, 0.4 ether);
    }

    function test_strangerCannotSweepOrUnpause() public {
        vm.startPrank(stranger);
        vm.expectRevert(AgentVault.NotExecutor.selector); v.sweepToOwner();
        vm.expectRevert(AgentVault.NotExecutor.selector); v.unpause();
        vm.stopPrank();
    }

    function test_sweepWorksWhilePaused() public {
        vm.prank(owner); v.setPaused(true);
        vm.prank(agent); assertEq(v.sweepToOwner(), 4 ether);
        assertTrue(v.paused());
    }

    function test_agentUnpausesButCannotPause() public {
        vm.prank(owner); v.setPaused(true);
        vm.prank(agent); v.unpause();
        assertFalse(v.paused());
        vm.prank(agent); v.unpause(); // no-op
        vm.prank(agent); vm.expectRevert(AgentVault.NotOwner.selector); v.setPaused(true);
    }

    function test_agentCannotUseOwnerFunctions() public {
        vm.startPrank(agent);
        vm.expectRevert(AgentVault.NotOwner.selector); v.withdraw(payable(agent), 1 ether);
        vm.expectRevert(AgentVault.NotOwner.selector); v.emergencyWithdrawAll();
        vm.expectRevert(AgentVault.NotOwner.selector); v.setExecutor(stranger);
        vm.stopPrank();
    }

    function test_ownerPowersUnchanged() public {
        vm.startPrank(owner);
        v.setExecutor(stranger);
        v.emergencyWithdrawAll();
        vm.stopPrank();
        assertEq(address(v).balance, 0);
        vm.prank(agent); vm.expectRevert(AgentVault.NotExecutor.selector); v.sweepToOwner();
    }

    function test_policyStillEnforced() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.PerPaymentCapExceeded.selector, 0.6 ether, 0.5 ether));
        v.execute(keccak256("x"), payable(payee), 0.6 ether);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, stranger));
        v.execute(keccak256("y"), payable(stranger), 0.1 ether);
        vm.prank(agent); v.execute(keccak256("z"), payable(payee), 0.5 ether);
        assertEq(payee.balance, 0.5 ether);
    }

    function test_plainTransfersCountedAndSweepable() public {
        vm.deal(stranger, 3 ether);
        vm.prank(stranger); (bool ok,) = address(v).call{value: 3 ether}(""); assertTrue(ok);
        vm.prank(agent); assertEq(v.sweepToOwner(), 7 ether);
    }

    function testFuzz_sweepLeavesMin(uint96 extra) public {
        vm.deal(address(this), uint256(extra));
        if (extra > 0) { (bool ok,) = address(v).call{value: extra}(""); vm.assume(ok); }
        uint256 bal = address(v).balance;
        vm.prank(agent); uint256 amt = v.sweepToOwner();
        assertEq(address(v).balance, bal > 1 ether ? 1 ether : bal);
        assertEq(amt, bal > 1 ether ? bal - 1 ether : 0);
    }
}
