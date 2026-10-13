// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

struct CallRuleInit { address target; bytes4 selector; uint8 recipientWord; }
struct TokenCapInit { address token; uint256 cap; }

interface IVaultFactoryAccounting {
    function noteIn(uint256 amount) external;
    function noteOut(uint256 amount) external;
}

/// @title AgentVault
/// @notice Native-MON vault owned by one user. A delegated executor (agent key) may pay allowlisted
///         recipients within a per-payment cap and a cumulative budget. The owner can deposit, withdraw,
///         pause and reconfigure at any time. Nobody else (not the factory, not the deployer) can move funds.
/// @dev ALPHA, UNAUDITED. Deposits are capped per vault and globally by the factory.
contract AgentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error NotOwner();
    error NotExecutor();
    error Paused();
    error ZeroAddress();
    error ZeroAmount();
    error RecipientNotAllowed(address recipient);
    error PerPaymentCapExceeded(uint256 amount, uint256 cap);
    error BudgetExceeded(uint256 requested, uint256 remaining);
    error RequestAlreadyExecuted(bytes32 requestId);
    error VaultCapExceeded(uint256 newBalance, uint256 cap);
    error InsufficientBalance(uint256 requested, uint256 balance);
    error TransferFailed();
    error DirectTransferDisabled();
    error CallNotAllowed(address target, bytes4 selector);
    error ForbiddenSelector(bytes4 selector);
    error ForbiddenTarget(address target);
    error RecipientMustBeVault(address recipient);
    error TokenCapExceeded(address token, uint256 amount, uint256 cap);
    error MinOutNotMet(uint256 received, uint256 minOut);
    error CallFailed(bytes returndata);
    error BadCalldata();

    event Deposited(address indexed from, uint256 amount, uint256 balance);
    event Withdrawn(address indexed to, uint256 amount, uint256 balance);
    event Executed(bytes32 indexed requestId, address indexed recipient, uint256 amount, uint256 totalSpent);
    event RecipientSet(address indexed recipient, bool allowed);
    event ExecutorSet(address indexed executor);
    event PerPaymentCapSet(uint256 cap);
    event BudgetSet(uint256 budget);
    event PausedSet(bool paused);
    event CallRuleSet(address indexed target, bytes4 indexed selector, bool allowed, uint8 recipientWord);
    event TokenCapSet(address indexed token, uint256 cap);
    event DappCalled(bytes32 indexed requestId, address indexed target, bytes4 indexed selector, uint256 value, address outToken, uint256 received, uint256 totalSpent);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    address public immutable factory;
    address public immutable owner;
    uint256 public immutable vaultCap;
    address public executor;
    uint256 public perPaymentCap;
    uint256 public budget;
    uint256 public totalSpent;
    bool public paused;
    mapping(address => bool) public allowedRecipient;
    mapping(bytes32 => bool) public executed;

    /// @notice Dapp call rules. recipientWord: index of the 32-byte ABI argument word that must equal this vault
    ///         (e.g. swap recipient / staking receiver); 255 = no recipient argument.
    struct CallRule { bool allowed; uint8 recipientWord; }
    mapping(address => mapping(bytes4 => CallRule)) public callRule;
    mapping(address => uint256) public allowedTargetCount; // >0 means the target may send MON back (e.g. WMON.withdraw)
    mapping(address => uint256) public tokenCap; // max exact approval per call; 0 = token cannot be approved

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    /// @dev Deployed directly (not as a minimal proxy) so that receive() works with 2300-gas transfers (e.g. WMON.withdraw).
    constructor(
        address owner_,
        address executor_,
        uint256 perPaymentCap_,
        uint256 budget_,
        uint256 vaultCap_,
        address[] memory recipients,
        CallRuleInit[] memory rules,
        TokenCapInit[] memory caps
    ) {
        if (owner_ == address(0) || executor_ == address(0)) revert ZeroAddress();
        factory = msg.sender;
        owner = owner_;
        executor = executor_;
        perPaymentCap = perPaymentCap_;
        budget = budget_;
        vaultCap = vaultCap_;
        emit ExecutorSet(executor_);
        emit PerPaymentCapSet(perPaymentCap_);
        emit BudgetSet(budget_);
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            allowedRecipient[recipients[i]] = true;
            emit RecipientSet(recipients[i], true);
        }
        for (uint256 i; i < rules.length; ++i) _setCallRule(rules[i].target, rules[i].selector, true, rules[i].recipientWord);
        for (uint256 i; i < caps.length; ++i) { tokenCap[caps[i].token] = caps[i].cap; emit TokenCapSet(caps[i].token, caps[i].cap); }
    }

    /// @dev Accepts MON from dapps (e.g. WMON.withdraw uses a 2300-gas transfer, so this must stay empty).
    ///      Plain transfers are not counted as deposits and can only be withdrawn by the owner. Owners use deposit().
    receive() external payable {}

    function remainingBudget() public view returns (uint256) { return budget > totalSpent ? budget - totalSpent : 0; }

    /// @notice Owner deposit. Factory may forward the owner's initial deposit at creation.
    function deposit() external payable nonReentrant {
        if (msg.sender != owner && msg.sender != factory) revert NotOwner();
        if (msg.value == 0) revert ZeroAmount();
        if (address(this).balance > vaultCap) revert VaultCapExceeded(address(this).balance, vaultCap);
        IVaultFactoryAccounting(factory).noteIn(msg.value);
        emit Deposited(owner, msg.value, address(this).balance);
    }

    /// @notice Owner can withdraw at any time, including while paused.
    function withdraw(address payable to, uint256 amount) public onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > address(this).balance) revert InsufficientBalance(amount, address(this).balance);
        IVaultFactoryAccounting(factory).noteOut(amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount, address(this).balance);
    }

    /// @notice Emergency: pause and pull everything back to the owner in one call.
    function emergencyWithdrawAll() external onlyOwner {
        if (!paused) { paused = true; emit PausedSet(true); }
        uint256 bal = address(this).balance;
        if (bal > 0) withdraw(payable(owner), bal);
    }

    function execute(bytes32 requestId, address payable recipient, uint256 amount) external nonReentrant {
        if (msg.sender != executor) revert NotExecutor();
        if (paused) revert Paused();
        if (amount == 0) revert ZeroAmount();
        if (!allowedRecipient[recipient]) revert RecipientNotAllowed(recipient);
        if (executed[requestId]) revert RequestAlreadyExecuted(requestId);
        if (amount > perPaymentCap) revert PerPaymentCapExceeded(amount, perPaymentCap);
        uint256 rem = remainingBudget();
        if (amount > rem) revert BudgetExceeded(amount, rem);
        if (amount > address(this).balance) revert InsufficientBalance(amount, address(this).balance);
        executed[requestId] = true;
        totalSpent += amount;
        IVaultFactoryAccounting(factory).noteOut(amount);
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Executed(requestId, recipient, amount, totalSpent);
    }

    /// @notice Agent calls an allowlisted dapp function, bounded by the same cap/budget for attached MON.
    /// @param approveToken optional ERC20 to approve to `target` for exactly `approveAmount` (reset to 0 afterwards)
    /// @param outToken token whose vault balance must grow by >= minOut (address(0) = native MON; ignored if minOut == 0)
    /// @param approveToken optional ERC20 approved to `target` for exactly `approveAmount`, reset to 0 after the call
    /// @param outToken token whose vault balance must grow by >= minOut (address(0) = native MON); unchecked if minOut == 0
    struct CallOpts { address approveToken; uint256 approveAmount; address outToken; uint256 minOut; }

    /// @notice Agent calls an allowlisted dapp function. Attached MON is bounded by the same cap/budget as payouts.
    function executeCall(bytes32 requestId, address target, uint256 value, bytes calldata data, CallOpts calldata o)
        external nonReentrant returns (bytes memory ret)
    {
        if (msg.sender != executor) revert NotExecutor();
        if (paused) revert Paused();
        if (executed[requestId]) revert RequestAlreadyExecuted(requestId);
        bytes4 sel = _checkRule(target, data);
        _checkValue(value);
        if (o.approveToken != address(0) && o.approveAmount > tokenCap[o.approveToken]) {
            revert TokenCapExceeded(o.approveToken, o.approveAmount, tokenCap[o.approveToken]);
        }
        uint256 before = o.minOut == 0 ? 0 : _bal(o.outToken);
        executed[requestId] = true;
        totalSpent += value;
        if (value > 0) IVaultFactoryAccounting(factory).noteOut(value);
        if (o.approveToken != address(0)) IERC20(o.approveToken).forceApprove(target, o.approveAmount);
        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        if (o.approveToken != address(0)) IERC20(o.approveToken).forceApprove(target, 0);
        uint256 received;
        if (o.minOut != 0) {
            uint256 afterBal = _bal(o.outToken);
            received = afterBal > before ? afterBal - before : 0;
            if (received < o.minOut) revert MinOutNotMet(received, o.minOut);
        }
        emit DappCalled(requestId, target, sel, value, o.outToken, received, totalSpent);
    }

    function _checkRule(address target, bytes calldata data) internal view returns (bytes4 sel) {
        if (data.length < 4) revert BadCalldata();
        sel = bytes4(data[:4]);
        CallRule memory rule = callRule[target][sel];
        if (!rule.allowed) revert CallNotAllowed(target, sel);
        if (rule.recipientWord != 255) {
            uint256 off = 4 + uint256(rule.recipientWord) * 32;
            if (data.length < off + 32) revert BadCalldata();
            address r = address(uint160(uint256(bytes32(data[off:off + 32]))));
            if (r != address(this)) revert RecipientMustBeVault(r);
        }
    }

    function _checkValue(uint256 value) internal view {
        if (value == 0) return;
        if (value > perPaymentCap) revert PerPaymentCapExceeded(value, perPaymentCap);
        uint256 rem = remainingBudget();
        if (value > rem) revert BudgetExceeded(value, rem);
        if (value > address(this).balance) revert InsufficientBalance(value, address(this).balance);
    }

    function _bal(address token) internal view returns (uint256) {
        return token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    /// @notice Owner allowlists a (target, selector). Token-moving / approval selectors are always forbidden,
    ///         so the agent can never grant unlimited approvals or transfer tokens out directly.
    function setCallRule(address target, bytes4 selector, bool allowed, uint8 recipientWord) external onlyOwner {
        _setCallRule(target, selector, allowed, recipientWord);
    }

    function _setCallRule(address target, bytes4 selector, bool allowed, uint8 recipientWord) internal {
        if (target == address(0)) revert ZeroAddress();
        if (target == address(this) || target == factory || target == owner || target == executor) revert ForbiddenTarget(target);
        if (
            selector == IERC20.approve.selector || selector == IERC20.transfer.selector
                || selector == IERC20.transferFrom.selector || selector == bytes4(0x39509351) /* increaseAllowance */
                || selector == bytes4(0xd505accf) /* permit */ || selector == bytes4(0x87517c45) /* permit2 approve */
        ) revert ForbiddenSelector(selector);
        CallRule storage r = callRule[target][selector];
        if (allowed && !r.allowed) allowedTargetCount[target] += 1;
        if (!allowed && r.allowed) allowedTargetCount[target] -= 1;
        r.allowed = allowed;
        r.recipientWord = recipientWord;
        emit CallRuleSet(target, selector, allowed, recipientWord);
    }

    function setTokenCap(address token, uint256 cap) external onlyOwner { tokenCap[token] = cap; emit TokenCapSet(token, cap); }

    /// @notice Owner pulls any ERC20 the vault holds (e.g. USDC/WMON/sMON from dapp calls).
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokenWithdrawn(token, to, amount);
    }

    function setRecipient(address r, bool allowed) external onlyOwner { if (r == address(0)) revert ZeroAddress(); allowedRecipient[r] = allowed; emit RecipientSet(r, allowed); }
    function setExecutor(address e) external onlyOwner { if (e == address(0)) revert ZeroAddress(); executor = e; emit ExecutorSet(e); }
    function setPerPaymentCap(uint256 c) external onlyOwner { perPaymentCap = c; emit PerPaymentCapSet(c); }
    function setBudget(uint256 b) external onlyOwner { budget = b; emit BudgetSet(b); }
    function setPaused(bool p) external onlyOwner { paused = p; emit PausedSet(p); }
}
