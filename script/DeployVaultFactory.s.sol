// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console} from "forge-std/Script.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";

/// Usage: forge script script/DeployVaultFactory.s.sol --rpc-url $RPC [--broadcast] --private-key $KEY
/// Default VAULT_CAP is 10 MON. The require allows up to v3's 1000 MON chain cap, which is also the app ceiling. Default global cap is 10000 MON.
contract DeployVaultFactory is Script {
    function run() external returns (AgentVaultFactory f) {
        uint256 vaultCap = vm.envOr("VAULT_CAP", uint256(10 ether));
        uint256 globalCap = vm.envOr("GLOBAL_CAP", uint256(10000 ether));
        require(vaultCap <= 1000 ether, "vault cap must be <= 1000 MON");
        vm.startBroadcast();
        f = new AgentVaultFactory(vaultCap, globalCap);
        vm.stopBroadcast();
        console.log("AgentVaultFactory", address(f));
        console.log("vaultCap", vaultCap, "globalCap", globalCap);
    }
}
