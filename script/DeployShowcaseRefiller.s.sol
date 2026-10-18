// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console} from "forge-std/Script.sol";
import {ShowcaseRefiller} from "../src/ShowcaseRefiller.sol";

/// PolicyPilot showcase agents (operated by the team). ALPHA / UNAUDITED.
/// Fixed config for the Monad mainnet ShowcaseRefiller: the 13 team agent wallets + 13 team vaults
/// (same addresses as runner/agent-refill-config-143.json). Agents first so gas is served before vaults.
/// v4 (2026-10-18, low-burn mode): active agents min 1 / target 3 MON (~2 days of rotated usage), idle 0.2 / 0.5.
/// v3 (2026-10-18): vaults are the ShowcaseAgentVaults whose agents sweepToOwner() everything above 1 MON daily.
library ShowcaseRefillerConfig {
    address internal constant DEPLOYER = 0xc0c4E411e41bECAD6DA860F67063C2D6363a6113;
    uint256 internal constant PER_CALL_CAP = 150 ether;
    uint256 internal constant DAILY_CAP = 250 ether;
    uint256 internal constant COOLDOWN = 15 minutes;

    function slots() internal pure returns (ShowcaseRefiller.Slot[] memory s, address[] memory callers) {
        address[13] memory agents = [
            0xb0a6cF247de8277C087E3794f68b3Eb2901B8400, // dca
            0xaC5FDf2c32A8F7B8060d16AfB20aD3afbBAD7c0d, // staker
            0x313f0C1D933a8a7a136f98731fa2b35d8DfB0Bb7, // payroll
            0xC156C3f7384846CF9B1B05f7E9400a46Ba571c3E, // rogue
            0xeD6148dF8A308496F90F398C06DAB0e2af80A785, // dca1
            0x8fdaB828628F211BC10E074Fa550430cf5048462, // mm
            0xC2cF684A3931143FD877F02222085713842a090E, // rebalancer
            0x13EA6e579D96C7b06813f3Da6b75C82e37aFb007, // tipper
            0xA7977707cb89B1c8b56b686fC9e57184B4BB9d43, // tester
            0x9C7B91b83Ba6326f7eD0709cb0a054D5Ae72e7e3, // dca3
            0xFC0Db107C2a9CA6bFDfaDba807cC46B84164F26e, // staker3
            0x3f32493215bafA3727Da5E8ae20983f8D25107a0, // payroll3
            0xf85ed50DfB220b975732dAD4038660460dad5507  // rogue3
        ];
        address[13] memory vaults = [
            0x9F776CE2aCcD8e466ebbB8710a088C2004061e9f, // dca
            0xF75a44463d66d75C70aEEd23677FF2FA2937673F, // staker
            0xD8Bf001147e81220bB893aA3A5e01704D7F1a9E3, // payroll
            0x8a4bbdf4d605f3e28eAAD00B54D0c51758454C3e, // rogue
            0xAd6a379B6A0635aBcb8985eca6F68C6410220903, // dca1
            0x83F9B56947A3515BeCDE5eEb630d120529A58F40, // mm
            0x485f6645FE15835Cb485a562c3DaeAB25E0EE856, // rebalancer
            0xb4eC8cE35AEbcED38E3189045f8F0f4912B7B1CC, // tipper
            0xaacBbbAd578519D04CE65E90ca129209AD7bB597, // tester
            0xaE348C07c0AA69d78E0f43eBdbB840b56E79daf7, // dca3
            0x5C2DA52e249d15dd59927e209379214334F428C9, // staker3
            0xDF0AbdB53b24Ad37811f2Cc87043fabE42d777AD, // payroll3
            0x40260dB17D4c9476314f5105EF6bbC3a1Ad46f75  // rogue3
        ];
        s = new ShowcaseRefiller.Slot[](26);
        callers = new address[](13);
        for (uint256 i; i < 13; ++i) {
            // Low-burn mode (v4): active agents 3 MON (~2 days of rotated usage, refilled below 1), idle "3" agents 0.5,
            // v3: the 13 ShowcaseAgentVaults (ShowcaseVaultFactory), every vault exactly 1 MON (refilled below 0.5). The refiller never tops anything above its target.
            bool idle = i >= 9; // the "3" agents are not run by showcase-agents.yml: gas dust only
            s[i] = ShowcaseRefiller.Slot(payable(agents[i]), idle ? 0.2 ether : 1 ether, idle ? 0.5 ether : 3 ether);
            s[13 + i] = ShowcaseRefiller.Slot(payable(vaults[i]), 0.5 ether, 1 ether);
            callers[i] = agents[i];
        }
    }
}

/// Usage (key never on the command line): set -a; . ~/.policypilot/mainnet-wallet.env; set +a;
///   forge script script/DeployShowcaseRefiller.s.sol --rpc-url https://rpc.monad.xyz [--broadcast]
/// Deploys with zero float; fund it afterwards with a plain transfer (anyone can fund, only the owner can withdraw).
contract DeployShowcaseRefiller is Script {
    function run() external returns (ShowcaseRefiller r) {
        uint256 pk = vm.envUint("MONAD_MAINNET_PRIVATE_KEY");
        require(vm.addr(pk) == ShowcaseRefillerConfig.DEPLOYER, "key is not the team deployer");
        (ShowcaseRefiller.Slot[] memory s, address[] memory c) = ShowcaseRefillerConfig.slots();
        vm.startBroadcast(pk);
        r = new ShowcaseRefiller(s, c, ShowcaseRefillerConfig.PER_CALL_CAP, ShowcaseRefillerConfig.DAILY_CAP, ShowcaseRefillerConfig.COOLDOWN);
        vm.stopBroadcast();
        console.log("ShowcaseRefiller", address(r));
    }
}
