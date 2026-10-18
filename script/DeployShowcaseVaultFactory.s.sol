// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ShowcaseVaultFactory} from "../src/ShowcaseAgentVault.sol";

/// PolicyPilot showcase agents (operated by the team). ALPHA / UNAUDITED.
/// forge script script/DeployShowcaseVaultFactory.s.sol --rpc-url monad --broadcast   (MONAD_MAINNET_PRIVATE_KEY in env)
contract DeployShowcaseVaultFactory is Script {
    address constant DEPLOYER = 0xc0c4E411e41bECAD6DA860F67063C2D6363a6113;

    function run() external returns (ShowcaseVaultFactory f) {
        uint256 pk = vm.envUint("MONAD_MAINNET_PRIVATE_KEY");
        require(vm.addr(pk) == DEPLOYER, "wrong key");
        vm.startBroadcast(pk);
        f = new ShowcaseVaultFactory(DEPLOYER, 1000 ether, 100_000 ether);
        vm.stopBroadcast();
    }
}
