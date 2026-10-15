// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentVault, CallRuleInit, TokenCapInit} from "../src/AgentVault.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";
import {PolicyPilotPrimeVault} from "../src/PolicyPilotPrimeVault.sol";

/// @notice Call-gas ceilings the static app hardcodes. Monad charges the gas limit, so these stay tight.
contract GasProfileTest is Test {
    function test_profile() public {
        AgentVaultFactory f = new AgentVaultFactory(1 ether, 3 ether);
        address owner = address(0xA11);
        address agent = address(0xA6E);
        vm.deal(owner, 10 ether);
        address[] memory r = new address[](1);
        r[0] = owner;
        vm.prank(owner);
        AgentVault v = f.createVault{value: 0.5 ether}(
            agent, 0.1 ether, 0.4 ether, r, new CallRuleInit[](0), new TokenCapInit[](0)
        );

        uint256 g = gasleft();
        vm.prank(agent);
        v.execute(bytes32("pay"), payable(owner), 0.01 ether);
        uint256 pay = g - gasleft();

        g = gasleft();
        vm.prank(owner);
        v.deposit{value: 0.01 ether}();
        uint256 dep = g - gasleft();

        g = gasleft();
        vm.prank(owner);
        v.withdraw(payable(owner), 0.01 ether);
        uint256 wd = g - gasleft();

        g = gasleft();
        vm.prank(owner);
        v.setPaused(true);
        uint256 pause = g - gasleft();

        vm.prank(owner);
        PolicyPilotPrimeVault p = new PolicyPilotPrimeVault(
            owner, owner, owner, 1 ether, 0.05 ether, 0.05 ether, PolicyPilotPrimeVault.TrancheType.SENIOR
        );
        vm.deal(owner, 1 ether);
        g = gasleft();
        vm.prank(owner);
        p.deposit{value: 0.05 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        uint256 pdep = g - gasleft();

        uint256 shares = p.userShares(owner, PolicyPilotPrimeVault.TrancheType.SENIOR);
        g = gasleft();
        vm.prank(owner);
        p.withdraw(PolicyPilotPrimeVault.TrancheType.SENIOR, shares);
        uint256 pwd = g - gasleft();

        // gasleft() around the call, including the test contract's call overhead.
        // web/src/lib/fastPath.ts turns these into transaction gas limits (intrinsic + calldata + cushion).
        // Monad charges the gas limit, so a jump here means those limits must be raised in the same change.
        assertLt(pay, 120_000, "pay");
        assertLt(dep, 55_000, "deposit");
        assertLt(wd, 60_000, "withdraw");
        assertLt(pause, 55_000, "pause");
        assertLt(pdep, 150_000, "prime deposit");
        assertLt(pwd, 80_000, "prime withdraw");
    }
}
