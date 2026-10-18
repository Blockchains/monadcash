// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentVault, CallRuleInit, TokenCapInit, IVaultFactoryAccounting} from "./AgentVault.sol";

/// @title  ShowcaseAgentVault: PolicyPilot showcase agents (operated by the team)
/// @notice ALPHA / UNAUDITED. A team-only AgentVault with two extra, narrowly scoped functions so the daily
///         "return to the deployer" and "never stay paused" rules run box-free (agent keys only):
///         - sweepToOwner(): sends everything above KEEP (1 MON) to the immutable owner. Destination cannot be chosen.
///         - unpause(): clears the pause flag. Pausing stays owner-only (setPaused/emergencyWithdrawAll).
///         Both are callable by the executor (the agent) or the owner. Every AgentVault policy and owner function is
///         unchanged. Trade-off: a pause can be undone by the agent; the owner's emergency path is
///         emergencyWithdrawAll() (empties the vault to the owner) and setExecutor() (revokes the agent).
contract ShowcaseAgentVault is AgentVault {
    uint256 public constant KEEP = 1 ether;

    event SweptToOwner(address indexed caller, uint256 amount, uint256 balance);
    event Unpaused(address indexed caller);

    constructor(
        address owner_,
        address executor_,
        uint256 perPaymentCap_,
        uint256 budget_,
        uint256 vaultCap_,
        address[] memory recipients,
        CallRuleInit[] memory rules,
        TokenCapInit[] memory caps
    ) AgentVault(owner_, executor_, perPaymentCap_, budget_, vaultCap_, recipients, rules, caps) {}

    modifier onlyExecutorOrOwner() {
        if (msg.sender != executor && msg.sender != owner) revert NotExecutor();
        _;
    }

    /// @notice Return all native MON above KEEP to the owner. Works while paused. Returns the amount sent.
    function sweepToOwner() external onlyExecutorOrOwner nonReentrant returns (uint256 amount) {
        uint256 bal = address(this).balance;
        if (bal <= KEEP) return 0;
        amount = bal - KEEP;
        IVaultFactoryAccounting(factory).noteOut(amount);
        (bool ok,) = payable(owner).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(owner, amount, address(this).balance);
        emit SweptToOwner(msg.sender, amount, address(this).balance);
    }

    /// @notice Clear the pause flag (no-op if not paused).
    function unpause() external onlyExecutorOrOwner {
        if (paused) { paused = false; emit PausedSet(false); emit Unpaused(msg.sender); }
    }
}

/// @title  ShowcaseVaultFactory: PolicyPilot showcase agents (operated by the team). ALPHA / UNAUDITED.
/// @notice Creates ShowcaseAgentVaults for the team owner only, with the same accounting interface and caps as
///         AgentVaultFactory (noteIn/noteOut, per-vault and global caps).
contract ShowcaseVaultFactory is IVaultFactoryAccounting {
    error NotVault();
    error NotTeamOwner();
    error GlobalCapExceeded(uint256 newTotal, uint256 cap);
    event VaultCreated(address indexed owner, address indexed vault, address indexed executor);

    address public immutable teamOwner;
    uint256 public immutable vaultCap;
    uint256 public immutable globalCap;
    uint256 public totalDeposited;
    mapping(address => bool) public isVault;
    address[] public allVaults;

    constructor(address teamOwner_, uint256 vaultCap_, uint256 globalCap_) { teamOwner = teamOwner_; vaultCap = vaultCap_; globalCap = globalCap_; }

    function createVault(address executor, uint256 perPaymentCap, uint256 budget, address[] calldata recipients, CallRuleInit[] calldata rules, TokenCapInit[] calldata caps)
        external payable returns (ShowcaseAgentVault v)
    {
        if (msg.sender != teamOwner) revert NotTeamOwner();
        v = new ShowcaseAgentVault(msg.sender, executor, perPaymentCap, budget, vaultCap, recipients, rules, caps);
        isVault[address(v)] = true;
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

    function vaultCount() external view returns (uint256) { return allVaults.length; }
}
