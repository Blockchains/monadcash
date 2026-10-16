// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

interface IClipERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IClipWMON is IClipERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IClipV3Pool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title PolicyPilotClipVault
/// @notice A personal MON pool that clips a two-pool round trip by calling the Uniswap v3 and
///         PancakeSwap v3 pools directly. There is no profit floor and no trade-size cap inside
///         the pool: any increase in the pool's MON clears, a shortfall of at most 0.50% still
///         settles, and the whole balance can be the trade. A larger shortfall reverts.
///         10% of a gain is paid to the caller, 10% to the treasury, and 80% stays. A loss pays neither.
/// @dev Monad charges the gas limit, not the gas used. This path does not approve a router and does
///      not route through one, so the repeating cost is the two pool swaps plus wrapping.
///      Alpha and unaudited. There is no promised rate. The caller pays gas, including on a revert.
contract PolicyPilotClipVault is ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error ZeroAssets();
    error WrongNetwork();
    error Floor();
    error VaultCapExceeded(uint256 next, uint256 cap);
    error InsufficientShares();
    error SameVenue();
    error TradeTooLarge(uint256 amount, uint256 maxAmount);
    error Unprofitable(uint256 got, uint256 need);
    error TransferFailed();
    error NotPool();
    error NotSweepable();

    enum Venue {
        UNI,
        CAKE,
        UNI_THIN
    }

    uint256 public constant BPS = 10_000;
    /// @notice Largest shortfall, in basis points of the MON sold, that still settles.
    uint256 public constant LOSS_BPS = 50;
    uint256 public constant KEEPER_BPS = 1_000;
    uint256 public constant PROTOCOL_BPS = 1_000;
    uint256 internal constant OFFSET = 1_000_000;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address public constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address public constant UNI_POOL = 0x659bD0BC4167BA25c62E05656F78043E7eD4a9da;
    address public constant UNI_THIN_POOL = 0x5Bc39A29EA5d8315263EC8939d6AD393dEbC34E9;
    address public constant CAKE_POOL = 0x63e48B725540A3Db24ACF6682a29f877808C53F2;

    address public immutable treasury;
    uint256 public immutable vaultCap;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event Clipped(
        address indexed caller,
        Venue sellVenue,
        Venue buyVenue,
        uint256 amountIn,
        uint256 profit,
        uint256 bounty,
        uint256 protocolFee
    );
    event Swept(address indexed token, uint256 amount);

    /// @param vaultCap_ Most MON the pool will hold. A clip can use the whole balance.
    constructor(address treasury_, uint256 vaultCap_) payable {
        if (block.chainid != 143) revert WrongNetwork();
        if (treasury_ == address(0) || treasury_ == address(this)) revert ZeroAddress();
        if (vaultCap_ == 0) revert ZeroAmount();
        treasury = treasury_;
        vaultCap = vaultCap_;
        if (msg.value > 0) _deposit(msg.sender, msg.value);
    }

    receive() external payable {}

    function deposit() external payable nonReentrant returns (uint256 shares) {
        shares = _deposit(msg.sender, msg.value);
    }

    /// @notice Always available, so a depositor can leave even if quotes are stale.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0 || balanceOf[msg.sender] < shares) revert InsufficientShares();
        assets = _assetsFor(shares, address(this).balance);
        if (assets == 0) revert ZeroAssets();
        balanceOf[msg.sender] -= shares;
        totalSupply -= shares;
        _pay(msg.sender, assets);
        emit Withdraw(msg.sender, assets, shares);
    }

    function assetsOf(address user) external view returns (uint256) {
        return _assetsFor(balanceOf[user], address(this).balance);
    }

    /// @notice Sell WMON on `sellVenue` and buy it back on `buyVenue`.
    ///         A gain pays the bounty. A shortfall inside `LOSS_BPS` still settles and pays nothing.
    /// @param minUsdc Minimum USDC the first leg must deliver.
    /// @param minWmon Minimum WMON the second leg must deliver. It can sit `LOSS_BPS` under `amount`.
    function clip(Venue sellVenue, Venue buyVenue, uint256 amount, uint256 minUsdc, uint256 minWmon)
        external
        nonReentrant
        returns (uint256 profit, uint256 bounty)
    {
        if (sellVenue == buyVenue) revert SameVenue();
        uint256 allowance = amount * LOSS_BPS / BPS;
        if (minUsdc == 0 || minWmon + allowance < amount) revert Floor();
        if (amount > uint256(type(int256).max)) revert TradeTooLarge(amount, uint256(type(int256).max));
        uint256 start = address(this).balance;
        if (amount == 0 || amount > start) revert TradeTooLarge(amount, start);

        IClipWMON(WMON).deposit{value: amount}();
        uint256 usdc = _swap(_pool(sellVenue), true, amount, minUsdc);
        uint256 back = _swap(_pool(buyVenue), false, usdc, minWmon);
        IClipWMON(WMON).withdraw(back);

        uint256 end = address(this).balance;
        if (start > end && start - end > allowance) revert Unprofitable(end, start - allowance);
        profit = end > start ? end - start : 0;
        bounty = profit * KEEPER_BPS / BPS;
        uint256 fee = profit * PROTOCOL_BPS / BPS;
        if (bounty > 0) _pay(msg.sender, bounty);
        if (fee > 0) _pay(treasury, fee);
        emit Clipped(msg.sender, sellVenue, buyVenue, amount, profit, bounty, fee);
    }

    /// @notice The v3 pools pay this during a WMON -> USDC swap. Anyone else is rejected.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        _payPool(amount0Delta, amount1Delta);
    }

    /// @notice PancakeSwap v3 uses its own callback name. The pool check is the same.
    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        _payPool(amount0Delta, amount1Delta);
    }

    /// @notice Send leftover WMON or USDC to the treasury. MON stays in the pool for depositors.
    function sweep(address token) external nonReentrant {
        if (token != WMON && token != USDC) revert NotSweepable();
        uint256 amount = IClipERC20(token).balanceOf(address(this));
        if (amount == 0) revert ZeroAmount();
        _transfer(token, treasury, amount);
        emit Swept(token, amount);
    }

    function _payPool(int256 amount0Delta, int256 amount1Delta) internal {
        if (msg.sender != UNI_POOL && msg.sender != UNI_THIN_POOL && msg.sender != CAKE_POOL) revert NotPool();
        if (amount0Delta > 0) _transfer(WMON, msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) _transfer(USDC, msg.sender, uint256(amount1Delta));
    }

    function _swap(address pool, bool zeroForOne, uint256 amountIn, uint256 minOut) internal returns (uint256 out) {
        uint160 limit = zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1;
        (int256 amount0, int256 amount1) = IClipV3Pool(pool).swap(address(this), zeroForOne, int256(amountIn), limit, "");
        int256 received = zeroForOne ? amount1 : amount0;
        if (received >= 0) revert Unprofitable(0, minOut);
        out = uint256(-received);
        if (out < minOut) revert Unprofitable(out, minOut);
    }

    function _pool(Venue venue) internal pure returns (address) {
        if (venue == Venue.UNI) return UNI_POOL;
        if (venue == Venue.UNI_THIN) return UNI_THIN_POOL;
        return CAKE_POOL;
    }

    function _deposit(address receiver, uint256 assets) internal returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 bal = address(this).balance;
        if (bal > vaultCap) revert VaultCapExceeded(bal, vaultCap);
        uint256 before = bal - assets;
        shares = Math.mulDiv(assets, totalSupply + OFFSET, before + 1);
        if (shares == 0) revert ZeroShares();
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Deposit(receiver, assets, shares);
    }

    function _assetsFor(uint256 shares, uint256 bal) internal view returns (uint256) {
        if (shares == 0 || totalSupply == 0) return 0;
        return Math.mulDiv(shares, bal + 1, totalSupply + OFFSET);
    }

    function _transfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IClipERC20.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
