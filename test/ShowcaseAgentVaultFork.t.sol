// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShowcaseAgentVault} from "../src/ShowcaseAgentVault.sol";

/// Fork test against Monad mainnet (run with --fork-url https://rpc.monad.xyz; skipped elsewhere):
/// every real team ShowcaseAgentVault sweeps to exactly 1 MON for its own agent, paying only the deployer,
/// and its agent can unpause it after an owner pause.
contract ShowcaseAgentVaultForkTest is Test {
    address constant DEPLOYER = 0xc0c4E411e41bECAD6DA860F67063C2D6363a6113;

    function test_fork_sweepAndUnpause() public {
        if (block.chainid != 143) return;
        // runner/showcase-vaults-v4-143.json (dca, staker, payroll, rogue, dca1, mm, rebalancer, tipper, tester, dca3, staker3, payroll3, rogue3)
        address[13] memory vs = [
            0x9F776CE2aCcD8e466ebbB8710a088C2004061e9f,
            0xF75a44463d66d75C70aEEd23677FF2FA2937673F,
            0xD8Bf001147e81220bB893aA3A5e01704D7F1a9E3,
            0x8a4bbdf4d605f3e28eAAD00B54D0c51758454C3e,
            0xAd6a379B6A0635aBcb8985eca6F68C6410220903,
            0x83F9B56947A3515BeCDE5eEb630d120529A58F40,
            0x485f6645FE15835Cb485a562c3DaeAB25E0EE856,
            0xb4eC8cE35AEbcED38E3189045f8F0f4912B7B1CC,
            0xaacBbbAd578519D04CE65E90ca129209AD7bB597,
            0xaE348C07c0AA69d78E0f43eBdbB840b56E79daf7,
            0x5C2DA52e249d15dd59927e209379214334F428C9,
            0xDF0AbdB53b24Ad37811f2Cc87043fabE42d777AD,
            0x40260dB17D4c9476314f5105EF6bbC3a1Ad46f75
        ];
        for (uint256 i; i < vs.length; ++i) {
            ShowcaseAgentVault v = ShowcaseAgentVault(payable(vs[i]));
            address agent = v.executor();
            assertEq(v.owner(), DEPLOYER);
            vm.deal(address(v), address(v).balance + 3 ether);
            uint256 bal = address(v).balance; uint256 d0 = DEPLOYER.balance;
            vm.prank(agent); uint256 amt = v.sweepToOwner();
            assertEq(address(v).balance, 1 ether, "keeps exactly 1 MON");
            assertEq(amt, bal - 1 ether); assertEq(DEPLOYER.balance, d0 + amt, "only the deployer is paid");
            vm.prank(DEPLOYER); v.setPaused(true);
            vm.prank(agent); v.unpause();
            assertFalse(v.paused());
        }
    }
}
