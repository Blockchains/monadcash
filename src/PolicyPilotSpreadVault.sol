// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

interface ISpreadERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWMON is ISpreadERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title PolicyPilotSpreadVault
/// @notice A personal MON pool. Anyone may run one round trip across the fixed Uniswap v3 and
///         PancakeSwap v3 pools. A zero profit floor still settles a shortfall of at most 0.50%.
///         A larger shortfall reverts. A positive floor still requires that gain.
///         10% of a gain is paid to the caller, 10% to the treasury, and 80% stays in the pool.
///         Alpha and unaudited. There is no promised rate. The caller pays gas, including on a revert.
/// @dev The routers, fee tiers, WMON, and USDC are fixed. A caller cannot point the pool at another contract.
contract PolicyPilotSpreadVault is ReentrancyGuard {
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
    error ApproveFailed();
    error TransferFailed();
    error NotSweepable();

    enum Venue {
        UNI,
        CAKE,
        UNI_THIN
    }

    uint256 public constant BPS = 10_000;
    /// @notice Largest shortfall, in basis points of the MON sold, accepted when `minProfitBps` is zero.
    uint256 public constant LOSS_BPS = 50;
    uint256 public constant KEEPER_BPS = 1_000;
    uint256 public constant PROTOCOL_BPS = 1_000;
    uint256 internal constant OFFSET = 1_000_000;

    address public constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address public constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address public constant UNI_ROUTER = 0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900;
    address public constant CAKE_ROUTER = 0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C;
    uint24 public constant UNI_FEE = 3000;
    uint24 public constant UNI_THIN_FEE = 500;
    uint24 public constant CAKE_FEE = 500;

    address public immutable treasury;
    uint256 public immutable vaultCap;
    uint256 public immutable minProfitBps;
    uint256 public immutable maxTradeBps;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event Captured(
        address indexed caller,
        Venue sellVenue,
        Venue buyVenue,
        uint256 amountIn,
        uint256 profit,
        uint256 bounty,
        uint256 protocolFee
    );
    event Swept(address indexed token, uint256 amount);

    /// @param minProfitBps_ Floor for a round trip, in basis points of the MON sold. 0 to 500.
    ///        Zero accepts any increase in the pool's MON.
    /// @param maxTradeBps_ Largest single round trip, in basis points of the pool's MON. 1 to 10000.
    constructor(address treasury_, uint256 vaultCap_, uint256 minProfitBps_, uint256 maxTradeBps_) payable {
        if (block.chainid != 143) revert WrongNetwork();
        if (treasury_ == address(0) || treasury_ == address(this)) revert ZeroAddress();
        if (vaultCap_ == 0) revert ZeroAmount();
        if (minProfitBps_ > 500) revert Floor();
        if (maxTradeBps_ == 0 || maxTradeBps_ > BPS) revert Floor();
        treasury = treasury_;
        vaultCap = vaultCap_;
        minProfitBps = minProfitBps_;
        maxTradeBps = maxTradeBps_;
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

    function maxTrade() external view returns (uint256) {
        return address(this).balance * maxTradeBps / BPS;
    }

    /// @notice Sell wrapped MON for USDC on `sellVenue`, buy it back on `buyVenue`.
    ///         A zero floor settles a shortfall inside `LOSS_BPS`. A positive floor still requires that gain.
    /// @param minUsdc Minimum USDC the first leg must deliver. The caller sets this from a quote.
    /// @param minWmon Minimum WMON the second leg must deliver. With a zero floor it can sit `LOSS_BPS` under `amount`.
    function capture(Venue sellVenue, Venue buyVenue, uint256 amount, uint256 minUsdc, uint256 minWmon)
        external
        nonReentrant
        returns (uint256 profit, uint256 bounty)
    {
        if (sellVenue == buyVenue) revert SameVenue();
        if (minUsdc == 0) revert Floor();
        uint256 start = address(this).balance;
        uint256 maxAmount = start * maxTradeBps / BPS;
        if (amount == 0 || amount > maxAmount || amount > start) revert TradeTooLarge(amount, maxAmount);
        uint256 allowance = minProfitBps == 0 ? amount * LOSS_BPS / BPS : 0;
        if (minWmon + allowance < amount + amount * minProfitBps / BPS) revert Floor();

        IWMON(WMON).deposit{value: amount}();
        _swap(_router(sellVenue), WMON, USDC, _fee(sellVenue), amount, minUsdc);

        uint256 usdcBal = ISpreadERC20(USDC).balanceOf(address(this));
        if (usdcBal < minUsdc) revert Unprofitable(usdcBal, minUsdc);
        _swap(_router(buyVenue), USDC, WMON, _fee(buyVenue), usdcBal, minWmon);

        uint256 back = ISpreadERC20(WMON).balanceOf(address(this));
        if (back < minWmon) revert Unprofitable(back, minWmon);
        IWMON(WMON).withdraw(back);

        uint256 end = address(this).balance;
        if (start > end && start - end > allowance) revert Unprofitable(end, start - allowance);
        profit = end > start ? end - start : 0;
        if (profit < amount * minProfitBps / BPS) revert Unprofitable(profit, amount * minProfitBps / BPS);

        bounty = profit * KEEPER_BPS / BPS;
        uint256 fee = profit * PROTOCOL_BPS / BPS;
        if (bounty > 0) _pay(msg.sender, bounty);
        if (fee > 0) _pay(treasury, fee);
        emit Captured(msg.sender, sellVenue, buyVenue, amount, profit, bounty, fee);
    }

    /// @notice Send leftover WMON or USDC to the treasury. MON stays in the pool for depositors.
    function sweep(address token) external nonReentrant {
        if (token != WMON && token != USDC) revert NotSweepable();
        uint256 amount = ISpreadERC20(token).balanceOf(address(this));
        if (amount == 0) revert ZeroAmount();
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), treasury, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        emit Swept(token, amount);
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

    function _swap(address router, address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut)
        internal
    {
        _approve(tokenIn, router, amountIn);
        ISwapRouter02(router)
            .exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fee,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                })
            );
        _approve(tokenIn, router, 0);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(ISpreadERC20.approve.selector, spender, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert ApproveFailed();
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _router(Venue venue) internal pure returns (address) {
        return venue == Venue.CAKE ? CAKE_ROUTER : UNI_ROUTER;
    }

    function _fee(Venue venue) internal pure returns (uint24) {
        if (venue == Venue.UNI) return UNI_FEE;
        if (venue == Venue.UNI_THIN) return UNI_THIN_FEE;
        return CAKE_FEE;
    }
}
