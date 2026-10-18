// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console} from "forge-std/Script.sol";
import {ShowcaseRefiller} from "../src/ShowcaseRefiller.sol";

/// PolicyPilot showcase agents (operated by the team). ALPHA / UNAUDITED.
/// Fixed config for the Monad mainnet ShowcaseRefiller: the 13 team agent wallets + 13 team vaults
/// (same addresses as runner/agent-refill-config-143.json). Agents first so gas is served before vaults.
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
            0xe5546Be7747b0910ba50593F91f9E00B4ACeF0e9, // dca
            0xD1d25BD880282CD8e87dedf3E3A9a931f21346fa, // staker
            0xBB3b9a771Ff1ee29B47424dD9eEdF93ffad08240, // payroll
            0x7dC5A827bF7474378F8Fb76C6a6A4B59BAd68856, // rogue (0.5)
            0x4443b84eF9FeeD617Af02dDE996b23748374DA81, // dca1
            0x2C9EC710CA04771B885F3417FE2F9eA0E638Dcf6, // mm
            0x221313ad5dC798189875053deb61A8a2a5a692aE, // rebalancer
            0xD8aFa3A2f9b71AE287a08CF7547526081EB543Ee, // tipper
            0xC17350f1d9853D0b51135FD60F176A758705C5d6, // tester
            0x039De4FcBbC519AbCB52c37e5DB789a94D93A05f, // dca3
            0x52498945c1910E9CCAB4a9790B3649AF20A3D367, // staker3
            0xFCAA9172735049D24f93db8728404b479576ddd2, // payroll3
            0xAE71468367813FF18504643d5C56C2a024C1e51c  // rogue3 (0.5)
        ];
        s = new ShowcaseRefiller.Slot[](26);
        callers = new address[](13);
        for (uint256 i; i < 13; ++i) {
            // Sustainable mode (v2): agents 20 MON (~1.7 days of measured gas, refilled below 6), idle "3" agents 0.5,
            // vaults 1 MON (refilled below 0.5), rogue vaults 0.5. The refiller never tops anything above its target.
            bool idle = i >= 9; // the "3" agents are not run by showcase-agents.yml: gas dust only
            s[i] = ShowcaseRefiller.Slot(payable(agents[i]), idle ? 0.2 ether : 6 ether, idle ? 0.5 ether : 20 ether);
            bool rogue = i == 3 || i == 12;
            s[13 + i] = ShowcaseRefiller.Slot(payable(vaults[i]), rogue ? 0.2 ether : 0.5 ether, rogue ? 0.5 ether : 1 ether);
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
