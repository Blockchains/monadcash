// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {AgentVault, CallRuleInit, TokenCapInit} from "../src/AgentVault.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";

contract Rejector { receive() external payable { revert(); } }
contract Reenter {
    AgentVault public v; bytes32 public id;
    function set(AgentVault v_, bytes32 id_) external { v = v_; id = id_; }
    receive() external payable { try v.execute(keccak256(abi.encode(id, gasleft())), payable(address(this)), 1) {} catch {} }
}

contract AgentVaultTest is Test {
    AgentVaultFactory f;
    AgentVault v;
    address owner = address(0xA11CE);
    address agent = address(0xA6E7);
    address bob = address(0xB0B);
    address eve = address(0xE7E);

    function setUp() public {
        f = new AgentVaultFactory(1 ether, 3 ether);
        address[] memory r = new address[](1); r[0] = bob;
        vm.deal(owner, 10 ether); vm.deal(eve, 10 ether);
        vm.prank(owner);
        v = f.createVault{value: 0.5 ether}(agent, 0.1 ether, 0.3 ether, r, new CallRuleInit[](0), new TokenCapInit[](0));
    }

    function test_create_state() public view {
        assertEq(v.owner(), owner); assertEq(v.executor(), agent); assertEq(v.factory(), address(f));
        assertEq(address(v).balance, 0.5 ether); assertEq(f.totalDeposited(), 0.5 ether);
        assertTrue(v.allowedRecipient(bob)); assertEq(f.vaultsOf(owner)[0], address(v)); assertTrue(f.isVault(address(v)));
    }
    function test_execute_ok() public {
        vm.prank(agent); v.execute("r1", payable(bob), 0.1 ether);
        assertEq(bob.balance, 0.1 ether); assertEq(v.totalSpent(), 0.1 ether); assertEq(f.totalDeposited(), 0.4 ether);
    }
    function test_execute_guards() public {
        vm.prank(eve); vm.expectRevert(AgentVault.NotExecutor.selector); v.execute("r", payable(bob), 1);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, eve)); v.execute("r", payable(eve), 1);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.PerPaymentCapExceeded.selector, 0.2 ether, 0.1 ether)); v.execute("r", payable(bob), 0.2 ether);
        vm.prank(agent); vm.expectRevert(AgentVault.ZeroAmount.selector); v.execute("r", payable(bob), 0);
        vm.prank(agent); v.execute("r", payable(bob), 0.1 ether);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.RequestAlreadyExecuted.selector, bytes32("r"))); v.execute("r", payable(bob), 0.1 ether);
        vm.startPrank(agent); v.execute("r2", payable(bob), 0.1 ether); v.execute("r3", payable(bob), 0.1 ether);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.BudgetExceeded.selector, 1, 0)); v.execute("r4", payable(bob), 1); vm.stopPrank();
    }
    function test_pause_blocks_execute_not_withdraw() public {
        vm.prank(owner); v.setPaused(true);
        vm.prank(agent); vm.expectRevert(AgentVault.Paused.selector); v.execute("r", payable(bob), 1);
        vm.prank(owner); v.withdraw(payable(owner), 0.2 ether);
        assertEq(address(v).balance, 0.3 ether); assertEq(f.totalDeposited(), 0.3 ether);
    }
    function test_only_owner_withdraw_and_config() public {
        vm.startPrank(eve);
        vm.expectRevert(AgentVault.NotOwner.selector); v.withdraw(payable(eve), 1);
        vm.expectRevert(AgentVault.NotOwner.selector); v.emergencyWithdrawAll();
        vm.expectRevert(AgentVault.NotOwner.selector); v.setRecipient(eve, true);
        vm.expectRevert(AgentVault.NotOwner.selector); v.setExecutor(eve);
        vm.expectRevert(AgentVault.NotOwner.selector); v.setBudget(9 ether);
        vm.expectRevert(AgentVault.NotOwner.selector); v.setPerPaymentCap(9 ether);
        vm.expectRevert(AgentVault.NotOwner.selector); v.setPaused(true);
        vm.expectRevert(AgentVault.NotOwner.selector); v.deposit{value: 1}();
        vm.stopPrank();
        vm.prank(agent); vm.expectRevert(AgentVault.NotOwner.selector); v.withdraw(payable(agent), 1);
    }
    function test_factory_cannot_take_funds() public {
        vm.prank(address(f)); vm.expectRevert(AgentVault.NotOwner.selector); v.withdraw(payable(address(f)), 1);
        vm.expectRevert(AgentVaultFactory.NotVault.selector); f.noteOut(1);
        vm.expectRevert(AgentVaultFactory.NotVault.selector); f.noteIn(1);
    }
    function test_emergency_withdraw_all() public {
        uint256 b0 = owner.balance; vm.prank(owner); v.emergencyWithdrawAll();
        assertTrue(v.paused()); assertEq(address(v).balance, 0); assertEq(owner.balance, b0 + 0.5 ether); assertEq(f.totalDeposited(), 0);
    }
    function test_vault_cap() public {
        vm.prank(owner); vm.expectRevert(abi.encodeWithSelector(AgentVault.VaultCapExceeded.selector, 1.1 ether, 1 ether)); v.deposit{value: 0.6 ether}();
        vm.prank(owner); v.deposit{value: 0.5 ether}(); assertEq(address(v).balance, 1 ether);
    }
    function test_global_cap() public {
        address[] memory r = new address[](0);
        vm.startPrank(owner);
        f.createVault{value: 1 ether}(agent, 1, 1, r, new CallRuleInit[](0), new TokenCapInit[](0));
        f.createVault{value: 1 ether}(agent, 1, 1, r, new CallRuleInit[](0), new TokenCapInit[](0));
        vm.expectRevert(abi.encodeWithSelector(AgentVaultFactory.GlobalCapExceeded.selector, 3.1 ether, 3 ether));
        f.createVault{value: 0.6 ether}(agent, 1, 1, r, new CallRuleInit[](0), new TokenCapInit[](0));
        vm.stopPrank();
    }
    function test_direct_transfer_only_owner_can_withdraw() public {
        vm.prank(eve); (bool ok,) = address(v).call{value: 1 ether}(""); assertTrue(ok);
        vm.prank(eve); vm.expectRevert(AgentVault.NotOwner.selector); v.withdraw(payable(eve), 1 ether);
        vm.prank(owner); v.withdraw(payable(owner), 1.5 ether); assertEq(address(v).balance, 0);
    }
    function test_failed_recipient_reverts_all() public {
        Rejector rj = new Rejector(); vm.prank(owner); v.setRecipient(address(rj), true);
        vm.prank(agent); vm.expectRevert(AgentVault.TransferFailed.selector); v.execute("x", payable(address(rj)), 1);
        assertEq(v.totalSpent(), 0); assertFalse(v.executed("x"));
    }
    function test_reentrancy_blocked() public {
        Reenter re = new Reenter(); re.set(v, "z");
        vm.startPrank(owner); v.setRecipient(address(re), true); v.setExecutor(address(re)); vm.stopPrank();
        vm.prank(address(re)); v.execute("z0", payable(address(re)), 0.01 ether);
        assertEq(v.totalSpent(), 0.01 ether); // inner call was blocked by nonReentrant
    }
    function testFuzz_execute_bounds(uint256 amt) public {
        amt = bound(amt, 1, 1 ether);
        vm.prank(agent);
        if (amt > 0.1 ether) { vm.expectRevert(abi.encodeWithSelector(AgentVault.PerPaymentCapExceeded.selector, amt, 0.1 ether)); v.execute("f", payable(bob), amt); }
        else { v.execute("f", payable(bob), amt); assertEq(bob.balance, amt); }
    }
    function testFuzz_withdraw_only_owner(address caller, uint256 amt) public {
        vm.assume(caller != owner); amt = bound(amt, 1, 0.5 ether);
        vm.prank(caller); vm.expectRevert(AgentVault.NotOwner.selector); v.withdraw(payable(caller), amt);
        assertEq(address(v).balance, 0.5 ether);
    }
}

contract VaultHandler is Test {
    AgentVault public v; AgentVaultFactory public f; address public owner; address public agent; address public bob;
    uint256 public deposited; uint256 public withdrawn; uint256 public paid; uint256 n;
    constructor(AgentVault v_, AgentVaultFactory f_, address o, address a, address b, uint256 init) { v = v_; f = f_; owner = o; agent = a; bob = b; deposited = init; }
    function deposit(uint256 x) external { x = bound(x, 1, 1 ether); if (address(v).balance + x > v.vaultCap()) return; vm.deal(owner, x); vm.prank(owner); v.deposit{value: x}(); deposited += x; }
    function withdraw(uint256 x) external { if (address(v).balance == 0) return; x = bound(x, 1, address(v).balance); vm.prank(owner); v.withdraw(payable(owner), x); withdrawn += x; }
    function pay(uint256 x) external { x = bound(x, 1, 0.2 ether); vm.prank(agent); try v.execute(bytes32(++n), payable(bob), x) { paid += x; } catch {} }
    function attackerWithdraw(address who, uint256 x) external { if (who == owner) return; vm.prank(who); try v.withdraw(payable(who), x) { revert("attacker withdrew"); } catch {} }
    function togglePause(bool p) external { vm.prank(owner); v.setPaused(p); }
}

contract AgentVaultInvariant is Test {
    AgentVaultFactory f; AgentVault v; VaultHandler h;
    address owner = address(0xA11CE); address agent = address(0xA6E7); address bob = address(0xB0B);
    function setUp() public {
        f = new AgentVaultFactory(1 ether, 3 ether);
        address[] memory r = new address[](1); r[0] = bob;
        vm.deal(owner, 1 ether); vm.prank(owner); v = f.createVault{value: 0.4 ether}(agent, 0.1 ether, 5 ether, r, new CallRuleInit[](0), new TokenCapInit[](0));
        h = new VaultHandler(v, f, owner, agent, bob, 0.4 ether);
        targetContract(address(h));
    }
    /// funds conservation: everything deposited is either still in the vault, paid out, or withdrawn by owner
    function invariant_conservation() public view { assertEq(h.deposited(), address(v).balance + h.paid() + h.withdrawn()); }
    function invariant_factory_accounting() public view { assertEq(f.totalDeposited(), address(v).balance); }
    function invariant_caps() public view { assertLe(address(v).balance, v.vaultCap()); assertLe(v.totalSpent(), v.budget()); assertEq(bob.balance, h.paid()); }
}
