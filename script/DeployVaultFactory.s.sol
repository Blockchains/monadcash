// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console} from "forge-std/Script.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";

/// Usage: VAULT_CAP=1000000000000000000 GLOBAL_CAP=5000000000000000000 forge script script/DeployVaultFactory.s.sol --rpc-url $RPC [--broadcast] --private-key $KEY
contract DeployVaultFactory is Script {
    function run() external returns (AgentVaultFactory f) {
        uint256 vaultCap = vm.envOr("VAULT_CAP", uint256(1 ether));
        uint256 globalCap = vm.envOr("GLOBAL_CAP", uint256(5 ether));
        require(vaultCap <= 1 ether, "vault cap must be <= 1 MON");
        vm.startBroadcast();
        f = new AgentVaultFactory(vaultCap, globalCap);
        vm.stopBroadcast();
        console.log("AgentVaultFactory", address(f));
        console.log("vaultCap", vaultCap, "globalCap", globalCap);
    }
}
