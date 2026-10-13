// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PolicyPilot} from "../src/PolicyPilot.sol";
import {MockToken} from "../src/MockToken.sol";

/// @notice Deploys MockToken + PolicyPilot, configures policy, funds the contract.
/// Env: PRIVATE_KEY (deployer = admin = executor unless EXECUTOR set), RECIPIENT_1, RECIPIENT_2.
contract Deploy is Script {
    uint256 constant PER_REQUEST_LIMIT = 100e18;
    uint256 constant BUDGET = 250e18;
    uint256 constant FUND = 1000e18;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address exec = vm.envOr("EXECUTOR", deployer);
        address r1 = vm.envAddress("RECIPIENT_1");
        address r2 = vm.envAddress("RECIPIENT_2");
        vm.startBroadcast(pk);
        MockToken token = new MockToken();
        PolicyPilot pp = new PolicyPilot(IERC20(address(token)), deployer, exec, PER_REQUEST_LIMIT, BUDGET);
        pp.setRecipient(r1, true);
        pp.setRecipient(r2, true);
        token.mint(address(pp), FUND);
        vm.stopBroadcast();
        console2.log("MockToken", address(token));
        console2.log("PolicyPilot", address(pp));
    }
}
