// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title  ShowcaseRefiller: PolicyPilot showcase agents (operated by the team)
/// @notice ALPHA / UNAUDITED. Use at your own risk. Not part of the user-facing PolicyPilot product.
///         A capped native-MON float that tops up a FIXED allowlist of team showcase vaults and agent gas wallets.
///         It lets the team's GitHub Actions jobs re-fund the showcase using agent keys only, so the deployer/owner key
///         never has to leave the operator's machine.
/// @dev    Safety properties (all enforced on-chain):
///         - Recipients and their min/target levels are set in the constructor and can NEVER change (no setter).
///         - MON can only leave to an allowlisted recipient (refill) or to the immutable owner (withdraw).
///         - Only allowlisted callers (team agent wallets, fixed at construction) or the owner can trigger refill().
///         - Each refill() is bounded by perCallCap, a rolling 24h dailyCap and a cooldown between successful refills,
///           so a leaked agent key can at most move dailyCap per 24h, and only to the allowlist.
///         - Only the owner can withdraw the float, and only to itself.
///         - Reentrancy guard + checks-effects-interactions; recipient calls are gas-limited and a failing recipient
///           is skipped (its accounting is rolled back) instead of blocking the rest. Native MON only, no tokens.
contract ShowcaseRefiller is ReentrancyGuard {
    struct Slot {
        address payable to;
        uint96 min;    // normal refill: top up when balance < min
        uint96 target; // ... up to target. full refill: top up whenever balance < target
    }

    address public immutable owner;
    uint256 public immutable perCallCap;
    uint256 public immutable dailyCap;
    uint256 public immutable cooldown;
    uint256 public constant WINDOW = 1 days;
    uint256 public constant SEND_GAS = 50_000;
    uint256 public constant DUST = 0.05 ether; // top-ups smaller than this are skipped
    uint256 public constant MAX_SLOTS = 64;

    Slot[] private _slots;
    mapping(address => bool) public isRecipient;
    mapping(address => bool) public isCaller;

    uint256 public windowStart;
    uint256 public sentInWindow;
    uint256 public lastRefill;

    event Funded(address indexed from, uint256 amount);
    event Refilled(address indexed to, uint256 amount, uint256 balanceBefore);
    event RefillFailed(address indexed to, uint256 amount);
    event RefillCall(address indexed caller, bool full, uint256 sent, uint256 sentInWindow);
    event Withdrawn(uint256 amount);

    error NotOwner();
    error NotCaller();
    error CooldownActive(uint256 readyAt);
    error BadConfig();
    error BadSlot(uint256 index);
    error DuplicateRecipient(address to);
    error CallerNotRecipient(address caller);
    error TransferFailed();
    error InsufficientFloat(uint256 amount, uint256 balance);

    constructor(Slot[] memory slots_, address[] memory callers_, uint256 perCallCap_, uint256 dailyCap_, uint256 cooldown_) payable {
        if (slots_.length == 0 || slots_.length > MAX_SLOTS) revert BadConfig();
        if (perCallCap_ == 0 || dailyCap_ < perCallCap_ || cooldown_ == 0) revert BadConfig();
        owner = msg.sender;
        perCallCap = perCallCap_;
        dailyCap = dailyCap_;
        cooldown = cooldown_;
        for (uint256 i; i < slots_.length; ++i) {
            Slot memory s = slots_[i];
            if (s.to == address(0) || s.to == address(this) || s.target == 0 || s.min > s.target) revert BadSlot(i);
            if (isRecipient[s.to]) revert DuplicateRecipient(s.to);
            isRecipient[s.to] = true;
            _slots.push(s);
        }
        for (uint256 i; i < callers_.length; ++i) {
            if (!isRecipient[callers_[i]]) revert CallerNotRecipient(callers_[i]);
            isCaller[callers_[i]] = true;
        }
        if (msg.value > 0) emit Funded(msg.sender, msg.value);
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    function slotCount() external view returns (uint256) { return _slots.length; }
    function slot(uint256 i) external view returns (address to, uint96 min, uint96 target) { Slot memory s = _slots[i]; return (s.to, s.min, s.target); }
    function readyAt() public view returns (uint256) { return lastRefill == 0 ? 0 : lastRefill + cooldown; }

    /// @notice MON left under the 24h cap right now.
    function windowLeft() public view returns (uint256) {
        if (block.timestamp >= windowStart + WINDOW) return dailyCap;
        return dailyCap - sentInWindow;
    }

    /// @notice What refill(full) would want to send, ignoring caps and the float (total, number of recipients).
    function pending(bool full) external view returns (uint256 total, uint256 count) {
        for (uint256 i; i < _slots.length; ++i) {
            uint256 a = _need(_slots[i], full);
            if (a > 0) { total += a; ++count; }
        }
    }

    /// @notice Top up allowlisted recipients from the float. full=false: only those below `min`; full=true: everyone
    ///         below `target`. Always up to `target`, in slot order, bounded by perCallCap, the 24h cap and the float.
    function refill(bool full) external nonReentrant returns (uint256 sent) {
        if (!isCaller[msg.sender] && msg.sender != owner) revert NotCaller();
        if (lastRefill != 0 && block.timestamp < lastRefill + cooldown) revert CooldownActive(lastRefill + cooldown);
        if (block.timestamp >= windowStart + WINDOW) { windowStart = block.timestamp; sentInWindow = 0; }
        uint256 budget = perCallCap;
        uint256 left = dailyCap - sentInWindow;
        if (left < budget) budget = left;
        if (address(this).balance < budget) budget = address(this).balance;

        for (uint256 i; i < _slots.length && budget >= DUST; ++i) {
            Slot memory s = _slots[i];
            uint256 a = _need(s, full);
            if (a == 0) continue;
            if (a > budget) a = budget;
            uint256 before = s.to.balance;
            // effects before the interaction
            budget -= a; sentInWindow += a; sent += a;
            (bool ok,) = s.to.call{value: a, gas: SEND_GAS}("");
            if (ok) emit Refilled(s.to, a, before);
            else { budget += a; sentInWindow -= a; sent -= a; emit RefillFailed(s.to, a); }
        }
        if (sent > 0) lastRefill = block.timestamp; // a no-op call does not start the cooldown
        emit RefillCall(msg.sender, full, sent, sentInWindow);
    }

    /// @notice Owner pulls MON from the float back to itself (the only other way MON can leave).
    function withdraw(uint256 amount) public nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        if (amount > address(this).balance) revert InsufficientFloat(amount, address(this).balance);
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(amount);
    }

    function withdrawAll() external { withdraw(address(this).balance); }

    function _need(Slot memory s, bool full) private view returns (uint256) {
        uint256 b = s.to.balance;
        if (b >= (full ? s.target : s.min)) return 0;
        uint256 a = s.target - b;
        return a < DUST ? 0 : a;
    }
}
