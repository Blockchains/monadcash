// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault, CallRuleInit, TokenCapInit} from "./AgentVault.sol";

/// @title AgentVaultFactory
/// @notice Anyone creates their own AgentVault. No owner, no admin, no upgrade path, no fee.
///         Enforces immutable safety caps: max balance per vault and max total deposits across all vaults.
/// @dev ALPHA, UNAUDITED.
contract AgentVaultFactory {
    error NotVault();
    error GlobalCapExceeded(uint256 newTotal, uint256 cap);

    event VaultCreated(address indexed owner, address indexed vault, address indexed executor);

    uint256 public immutable vaultCap;
    uint256 public immutable globalCap;
    uint256 public totalDeposited; // current MON held across all vaults (in - out)
    mapping(address => bool) public isVault;
    mapping(address => address[]) internal _vaultsOf;
    address[] public allVaults;

    constructor(uint256 vaultCap_, uint256 globalCap_) { vaultCap = vaultCap_; globalCap = globalCap_; }

    /// @notice One transaction "harness": deploy your vault with limits, payout recipients, dapp call rules,
    ///         token approval caps, and an optional initial deposit (msg.value).
    function createVault(
        address executor,
        uint256 perPaymentCap,
        uint256 budget,
        address[] calldata recipients,
        CallRuleInit[] calldata rules,
        TokenCapInit[] calldata caps
    ) external payable returns (AgentVault v) {
        v = new AgentVault(msg.sender, executor, perPaymentCap, budget, vaultCap, recipients, rules, caps);
        isVault[address(v)] = true;
        _vaultsOf[msg.sender].push(address(v));
        allVaults.push(address(v));
        emit VaultCreated(msg.sender, address(v), executor);
        if (msg.value > 0) v.deposit{value: msg.value}();
    }

    function noteIn(uint256 amount) external {
        if (!isVault[msg.sender]) revert NotVault();
        uint256 t = totalDeposited + amount;
        if (t > globalCap) revert GlobalCapExceeded(t, globalCap);
        totalDeposited = t;
    }

    function noteOut(uint256 amount) external {
        if (!isVault[msg.sender]) revert NotVault();
        totalDeposited = totalDeposited >= amount ? totalDeposited - amount : 0;
    }

    function vaultsOf(address owner) external view returns (address[] memory) { return _vaultsOf[owner]; }
    function vaultCount() external view returns (uint256) { return allVaults.length; }
}
