// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @title PolicyPilotPrimeVault
/// @notice A personal MON pool with two tranches. Capital Protected (senior) is paid first and loses
///         last. Max Alpha (junior) takes the first loss and the rest of the profit. Alpha, unaudited.
///         There is no promised rate: the only protection is junior MON sitting in this contract.
/// @dev A hop may move at most 5% of the pool and at most `absoluteHopCap`. It reverts when the loss
///      is above `maxLoss`. After settlement, a drawdown of 1.5% from the high watermark halts new
///      hops and deposits. The 10% performance fee is charged only on NAV above the high watermark.
contract PolicyPilotPrimeVault is ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();
    error ZeroDeposit();
    error ZeroShares();
    error ZeroAssets();
    error NotAdmin();
    error NotExecutor();
    error VaultCapExceeded(uint256 next, uint256 cap);
    error InsufficientShares();
    error CircuitBreakerTripped();
    error HopCapExceeded(uint256 value, uint256 ceiling);
    error LossCapExceeded(uint256 maxLoss, uint256 cap);
    error Unprofitable(uint256 loss, uint256 maxLoss);
    error HopFailed(bytes returndata);
    error RequestAlreadyExecuted(bytes32 requestId);
    error ForbiddenTarget();
    error BadHop();
    error LossExceedsAssets(uint256 loss, uint256 assets);
    error TransferFailed();

    enum TrancheType {
        SENIOR,
        JUNIOR
    }

    struct Tranche {
        uint256 totalAssets;
        uint256 totalSupply;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant SENIOR_PROFIT_BPS = 3_000;
    uint256 public constant PERFORMANCE_FEE_BPS = 1_000;
    uint256 public constant HOP_BPS = 500;
    uint256 public constant BREAKER_BPS = 150;
    uint256 internal constant OFFSET = 1_000_000;

    address public immutable admin;
    address public immutable guardian;
    address public immutable protocolTreasury;
    uint256 public immutable vaultCap;
    uint256 public immutable absoluteHopCap;
    uint256 public immutable absoluteLossCap;

    address public executor;
    Tranche public seniorTranche;
    Tranche public juniorTranche;
    mapping(address => mapping(TrancheType => uint256)) public userShares;
    mapping(bytes32 => bool) public executed;

    bool public isEmergencyHalted;
    uint256 public highWatermark;

    event Deposit(address indexed user, TrancheType indexed tranche, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, TrancheType indexed tranche, uint256 assets, uint256 shares);
    event ProfitIngested(uint256 grossProfit, uint256 seniorYield, uint256 juniorYield, uint256 protocolFee);
    event LossAbsorbed(uint256 loss, uint256 junior, uint256 senior);
    event HopSettled(bytes32 indexed requestId, address indexed target, uint256 value, int256 pnl);
    event CircuitBreakerTriggered(string reason, uint256 timestamp);
    event TradingResumed(uint256 watermark);
    event ExecutorSet(address indexed executor);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }
    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }
    modifier whenActive() {
        if (isEmergencyHalted || _belowFloor(totalVaultAssets())) revert CircuitBreakerTripped();
        _;
    }

    /// @param initial Tranche that receives `msg.value`. Zero value opens an empty vault.
    constructor(
        address guardian_,
        address treasury_,
        address executor_,
        uint256 vaultCap_,
        uint256 absoluteHopCap_,
        uint256 absoluteLossCap_,
        TrancheType initial
    ) payable {
        if (guardian_ == address(0) || treasury_ == address(0) || executor_ == address(0)) {
            revert ZeroAddress();
        }
        if (treasury_ == address(this)) revert ZeroAddress();
        if (vaultCap_ == 0 || absoluteHopCap_ == 0) revert ZeroAmount();
        admin = msg.sender;
        guardian = guardian_;
        protocolTreasury = treasury_;
        executor = executor_;
        vaultCap = vaultCap_;
        absoluteHopCap = absoluteHopCap_;
        absoluteLossCap = absoluteLossCap_;
        emit ExecutorSet(executor_);
        if (msg.value > 0) _deposit(msg.sender, initial, msg.value);
    }

    receive() external payable {}

    function deposit(TrancheType tranche) external payable whenActive nonReentrant returns (uint256 shares) {
        shares = _deposit(msg.sender, tranche, msg.value);
    }

    /// @notice Always available, including while halted, so depositors can leave.
    function withdraw(TrancheType tranche, uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0 || userShares[msg.sender][tranche] < shares) revert InsufficientShares();
        Tranche storage t = _tranche(tranche);
        assets = _toAssets(shares, t.totalSupply, t.totalAssets);
        if (assets == 0) revert ZeroAssets();
        userShares[msg.sender][tranche] -= shares;
        t.totalSupply -= shares;
        t.totalAssets -= assets;
        uint256 nav = totalVaultAssets();
        uint256 before = nav + assets;
        highWatermark = before == 0 ? 0 : Math.mulDiv(highWatermark, nav, before);
        (bool ok,) = msg.sender.call{value: assets}("");
        if (!ok) revert TransferFailed();
        emit Withdraw(msg.sender, tranche, assets, shares);
    }

    /// @notice One bounded call. `maxLoss` of 0 reverts unless the pool's MON balance does not fall.
    ///         A loss within `maxLoss` is taken from junior first. Crossing the 1.5% floor halts the vault.
    function hop(bytes32 requestId, address target, bytes calldata data, uint256 value, uint256 maxLoss)
        external
        onlyExecutor
        whenActive
        nonReentrant
    {
        if (executed[requestId]) revert RequestAlreadyExecuted(requestId);
        if (target == address(0) || target == address(this)) revert ForbiddenTarget();
        if (value == 0 && data.length < 4) revert BadHop();
        uint256 nav = totalVaultAssets();
        uint256 ceiling = _ceiling(nav);
        if (value > ceiling) revert HopCapExceeded(value, ceiling);
        if (value > nav || value > address(this).balance) {
            revert HopCapExceeded(value, nav < address(this).balance ? nav : address(this).balance);
        }
        uint256 lossCap = absoluteLossCap < value ? absoluteLossCap : value;
        if (maxLoss > lossCap) revert LossCapExceeded(maxLoss, lossCap);
        executed[requestId] = true;
        uint256 beforeBal = address(this).balance;
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert HopFailed(ret);
        uint256 afterBal = address(this).balance;
        int256 pnl;
        if (afterBal >= beforeBal) {
            uint256 profit = afterBal - beforeBal;
            pnl = int256(profit);
            if (profit > 0) _creditProfit(profit);
        } else {
            uint256 loss = beforeBal - afterBal;
            if (loss > maxLoss) revert Unprofitable(loss, maxLoss);
            pnl = -int256(loss);
            _applyLoss(loss);
            if (_belowFloor(totalVaultAssets())) {
                isEmergencyHalted = true;
                emit CircuitBreakerTriggered("drawdown", block.timestamp);
            }
        }
        emit HopSettled(requestId, target, value, pnl);
    }

    /// @notice Turn MON sent straight to the contract into tranche profit. This is not a deposit.
    function skim() external whenActive nonReentrant {
        uint256 nav = totalVaultAssets();
        uint256 bal = address(this).balance;
        if (bal <= nav) revert ZeroAmount();
        _creditProfit(bal - nav);
    }

    function ingestProfit() external payable whenActive nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _creditProfit(msg.value);
    }

    function triggerEmergencyHalt(string calldata reason) external {
        if (msg.sender != admin && msg.sender != guardian) revert NotAdmin();
        isEmergencyHalted = true;
        emit CircuitBreakerTriggered(reason, block.timestamp);
    }

    /// @notice Accepts the current NAV as the new high watermark so trading can start again.
    function resumeTrading() external onlyAdmin {
        isEmergencyHalted = false;
        uint256 nav = totalVaultAssets();
        if (nav < highWatermark) highWatermark = nav;
        emit TradingResumed(highWatermark);
    }

    function setExecutor(address next) external onlyAdmin {
        if (next == address(0)) revert ZeroAddress();
        executor = next;
        emit ExecutorSet(next);
    }

    function totalVaultAssets() public view returns (uint256) {
        return seniorTranche.totalAssets + juniorTranche.totalAssets;
    }

    function assetsOf(address user, TrancheType tranche) external view returns (uint256) {
        Tranche storage t = _tranche(tranche);
        uint256 shares = userShares[user][tranche];
        if (shares == 0 || t.totalSupply == 0) return 0;
        return _toAssets(shares, t.totalSupply, t.totalAssets);
    }

    function drawdownBps() external view returns (uint256) {
        uint256 nav = totalVaultAssets();
        if (highWatermark == 0 || nav >= highWatermark) return 0;
        return Math.mulDiv(highWatermark - nav, BPS, highWatermark);
    }

    function breakerFloor() public view returns (uint256) {
        return Math.mulDiv(highWatermark, BPS - BREAKER_BPS, BPS);
    }

    function hopCeiling() external view returns (uint256) {
        return _ceiling(totalVaultAssets());
    }

    function tradingLive() external view returns (bool) {
        return !isEmergencyHalted && !_belowFloor(totalVaultAssets());
    }

    function _deposit(address user, TrancheType tranche, uint256 assets) internal returns (uint256 shares) {
        if (assets == 0) revert ZeroDeposit();
        uint256 next = totalVaultAssets() + assets;
        if (next > vaultCap) revert VaultCapExceeded(next, vaultCap);
        Tranche storage t = _tranche(tranche);
        shares = _toShares(assets, t.totalSupply, t.totalAssets);
        if (shares == 0) revert ZeroShares();
        t.totalSupply += shares;
        t.totalAssets += assets;
        userShares[user][tranche] += shares;
        highWatermark += assets;
        emit Deposit(user, tranche, assets, shares);
    }

    function _creditProfit(uint256 profit) internal {
        uint256 nav = totalVaultAssets();
        uint256 fee;
        if (nav + profit > highWatermark) {
            uint256 gain = nav + profit - highWatermark;
            fee = Math.mulDiv(gain, PERFORMANCE_FEE_BPS, BPS);
            if (fee > profit) fee = profit;
        }
        uint256 distributable = profit - fee;
        uint256 seniorCut = Math.mulDiv(distributable, SENIOR_PROFIT_BPS, BPS);
        uint256 juniorCut = distributable - seniorCut;
        if (seniorTranche.totalSupply == 0 && juniorTranche.totalSupply > 0) {
            juniorCut += seniorCut;
            seniorCut = 0;
        } else if (juniorTranche.totalSupply == 0 && seniorTranche.totalSupply > 0) {
            seniorCut += juniorCut;
            juniorCut = 0;
        }
        seniorTranche.totalAssets += seniorCut;
        juniorTranche.totalAssets += juniorCut;
        uint256 navAfter = totalVaultAssets();
        if (navAfter > highWatermark) highWatermark = navAfter;
        if (fee > 0) {
            (bool ok,) = protocolTreasury.call{value: fee}("");
            if (!ok) revert TransferFailed();
        }
        emit ProfitIngested(profit, seniorCut, juniorCut, fee);
    }

    function _applyLoss(uint256 loss) internal {
        uint256 junior = juniorTranche.totalAssets;
        if (loss <= junior) {
            juniorTranche.totalAssets = junior - loss;
            emit LossAbsorbed(loss, loss, 0);
            return;
        }
        uint256 rest = loss - junior;
        uint256 senior = seniorTranche.totalAssets;
        if (rest > senior) revert LossExceedsAssets(loss, junior + senior);
        juniorTranche.totalAssets = 0;
        seniorTranche.totalAssets = senior - rest;
        emit LossAbsorbed(loss, junior, rest);
    }

    function _tranche(TrancheType tranche) internal view returns (Tranche storage t) {
        t = tranche == TrancheType.SENIOR ? seniorTranche : juniorTranche;
    }

    function _toShares(uint256 assets, uint256 supply, uint256 total) internal pure returns (uint256) {
        return Math.mulDiv(assets, supply + OFFSET, total + 1);
    }

    function _toAssets(uint256 shares, uint256 supply, uint256 total) internal pure returns (uint256) {
        return Math.mulDiv(shares, total + 1, supply + OFFSET);
    }

    function _ceiling(uint256 nav) internal view returns (uint256) {
        uint256 pct = Math.mulDiv(nav, HOP_BPS, BPS);
        return pct < absoluteHopCap ? pct : absoluteHopCap;
    }

    function _belowFloor(uint256 nav) internal view returns (bool) {
        if (highWatermark == 0) return false;
        return nav < Math.mulDiv(highWatermark, BPS - BREAKER_BPS, BPS);
    }
}
