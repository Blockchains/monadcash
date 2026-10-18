// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ShowcaseRefiller} from "../src/ShowcaseRefiller.sol";
import {ShowcaseRefillerConfig} from "../script/DeployShowcaseRefiller.s.sol";

/// Mainnet fork: the real 13 team vaults (v1/v2/v3 AgentVault bytecode) accept refiller top-ups within SEND_GAS.
/// Run: forge test --match-contract ShowcaseRefillerForkTest --fork-url https://rpc.monad.xyz
contract ShowcaseRefillerForkTest is Test {
    function test_fork_realVaultsAndAgentsReceive() public {
        if (block.chainid != 143) return; // only meaningful on a Monad mainnet fork (--fork-url)
        (ShowcaseRefiller.Slot[] memory s, address[] memory c) = ShowcaseRefillerConfig.slots();
        vm.deal(ShowcaseRefillerConfig.DEPLOYER, 2000 ether);
        vm.prank(ShowcaseRefillerConfig.DEPLOYER);
        ShowcaseRefiller r = new ShowcaseRefiller{value: 1000 ether}(s, c, ShowcaseRefillerConfig.PER_CALL_CAP, ShowcaseRefillerConfig.DAILY_CAP, ShowcaseRefillerConfig.COOLDOWN);
        assertEq(r.owner(), ShowcaseRefillerConfig.DEPLOYER);
        for (uint256 i; i < 26; ++i) vm.deal(s[i].to, 0); // empty everything: worst case
        vm.prank(c[0]);
        uint256 sent = r.refill(true);
        uint256 expect;
        for (uint256 i; i < 26; ++i) expect += s[i].target;
        assertEq(sent, ShowcaseRefillerConfig.PER_CALL_CAP < expect ? ShowcaseRefillerConfig.PER_CALL_CAP : expect);
        vm.warp(block.timestamp + ShowcaseRefillerConfig.COOLDOWN);
        vm.prank(c[1]);
        sent += r.refill(true);
        assertEq(sent, expect > ShowcaseRefillerConfig.DAILY_CAP ? ShowcaseRefillerConfig.DAILY_CAP : expect);
        // with roomy caps, every real vault and agent accepts its top-up within SEND_GAS (none skipped)
        for (uint256 i; i < 26; ++i) vm.deal(s[i].to, 0);
        vm.prank(ShowcaseRefillerConfig.DEPLOYER);
        ShowcaseRefiller big = new ShowcaseRefiller{value: 600 ether}(s, c, 600 ether, 600 ether, 1);
        vm.prank(c[2]);
        assertEq(big.refill(true), expect);
        for (uint256 i; i < 26; ++i) assertEq(s[i].to.balance, s[i].target, "every real recipient accepted its top-up");
    }
}
