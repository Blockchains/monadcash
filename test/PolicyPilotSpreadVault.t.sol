// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyPilotSpreadVault} from "../src/PolicyPilotSpreadVault.sol";

interface IMini {
    function balanceOf(address) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract MiniToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MiniWMON is MiniToken {
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "mon");
    }

    receive() external payable {}
}

/// @dev Matches `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))`.
contract RateRouterSwap {
    address public immutable wmon;
    address public immutable usdc;
    uint256 public wmonToUsdc;
    uint256 public usdcToWmon;

    constructor(address wmon_, address usdc_) {
        wmon = wmon_;
        usdc = usdc_;
    }

    function set(uint256 wmonToUsdc_, uint256 usdcToWmon_) external {
        wmonToUsdc = wmonToUsdc_;
        usdcToWmon = usdcToWmon_;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    uint24 public lastFee;

    function exactInputSingle(ExactInputSingleParams calldata p) external returns (uint256 amountOut) {
        lastFee = p.fee;
        if (p.tokenIn == wmon && p.tokenOut == usdc) {
            amountOut = p.amountIn * wmonToUsdc / 1e18;
            require(amountOut >= p.amountOutMinimum, "min usdc");
            require(MiniToken(wmon).transferFrom(msg.sender, address(this), p.amountIn), "pull wmon");
            MiniToken(usdc).mint(p.recipient, amountOut);
        } else if (p.tokenIn == usdc && p.tokenOut == wmon) {
            amountOut = p.amountIn * usdcToWmon / 1e6;
            require(amountOut >= p.amountOutMinimum, "min wmon");
            require(MiniToken(usdc).transferFrom(msg.sender, address(this), p.amountIn), "pull usdc");
            MiniToken(wmon).mint(p.recipient, amountOut);
            (bool funded,) = wmon.call{value: amountOut}("");
            require(funded, "fund wmon");
        } else {
            revert("path");
        }
    }
}

contract ReenterRouter {
    address public vault;

    function set(address vault_) external {
        vault = vault_;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata) external returns (uint256) {
        PolicyPilotSpreadVault(payable(vault))
            .capture(PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 1, 1, 2);
        return 1;
    }
}

contract PolicyPilotSpreadVaultTest is Test {
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant UNI = 0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900;
    address constant CAKE = 0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address treasury = address(0xFE7);

    function setUp() public {
        vm.chainId(143);
        MiniWMON w = new MiniWMON();
        MiniToken u = new MiniToken();
        RateRouterSwap r = new RateRouterSwap(WMON, USDC);
        vm.etch(WMON, address(w).code);
        vm.etch(USDC, address(u).code);
        vm.etch(UNI, address(r).code);
        vm.etch(CAKE, address(r).code);
        // 1 MON -> 2 USDC on Uniswap. 1 USDC -> 0.55 MON on Pancake, so 2 USDC -> 1.1 MON.
        RateRouterSwap(UNI).set(2e6, 0.4e18);
        RateRouterSwap(CAKE).set(1e6, 0.55e18);
        vm.deal(UNI, 100 ether);
        vm.deal(CAKE, 100 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 1 ether);
    }

    function _open(uint256 minBps, uint256 maxBps, uint256 value) internal returns (PolicyPilotSpreadVault v) {
        vm.prank(alice);
        v = new PolicyPilotSpreadVault{value: value}(treasury, 1 ether, minBps, maxBps);
    }

    function test_profitableRoundTripPaysCallerAndLeavesEightyPercent() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 1 ether);
        uint256 treasuryBefore = treasury.balance;
        uint256 carolBefore = carol.balance;
        vm.prank(carol);
        (uint256 profit, uint256 bounty) = v.capture(
            PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 1 ether, 1, 1 ether + 0.0005 ether
        );
        assertEq(profit, 0.1 ether, "profit");
        assertEq(bounty, 0.01 ether, "bounty");
        assertEq(carol.balance - carolBefore, 0.01 ether, "caller paid");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "treasury paid");
        assertEq(address(v).balance, 1.08 ether, "pool keeps 80%");
        assertGt(v.assetsOf(alice), 1.07 ether, "depositor gained");
        assertEq(IMini(WMON).allowance(address(v), UNI), 0, "wmon approval cleared");
        assertEq(IMini(USDC).allowance(address(v), CAKE), 0, "usdc approval cleared");
        assertEq(IMini(WMON).balanceOf(address(v)), 0, "no wrapped dust");
        assertEq(IMini(USDC).balanceOf(address(v)), 0, "no usdc dust");
        assertEq(RateRouterSwap(UNI).lastFee(), 3000, "deep uniswap fee");
        assertEq(RateRouterSwap(CAKE).lastFee(), 500, "pancake fee");
    }

    function test_unprofitableRoundTripReverts() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 1 ether);
        // Pancake buys MON at a loss: 2 USDC -> 0.8 MON.
        RateRouterSwap(CAKE).set(1e6, 0.4e18);
        vm.prank(carol);
        vm.expectRevert();
        v.capture(
            PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 1 ether, 1, 1 ether + 0.0005 ether
        );
        assertEq(address(v).balance, 1 ether, "untouched");
    }

    function test_sameVenueAndOversizedTradeRevert() public {
        PolicyPilotSpreadVault v = _open(5, 5_000, 1 ether);
        vm.prank(carol);
        vm.expectRevert(PolicyPilotSpreadVault.SameVenue.selector);
        v.capture(PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.UNI, 0.1 ether, 1, 0.2 ether);
        vm.prank(carol);
        vm.expectRevert();
        v.capture(PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 0.6 ether, 1, 0.7 ether);
    }

    function test_twoDepositorsRoundTripAndWithdraw() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 0.6 ether);
        vm.prank(bob);
        v.deposit{value: 0.4 ether}();
        uint256 aliceShares = v.balanceOf(alice);
        uint256 bobShares = v.balanceOf(bob);
        vm.prank(alice);
        v.withdraw(aliceShares);
        assertApproxEqAbs(alice.balance, 10 ether, 1000, "alice principal");
        vm.prank(bob);
        v.withdraw(bobShares);
        assertApproxEqAbs(bob.balance, 10 ether, 1000, "bob principal");
        assertLt(address(v).balance, 1000, "dust only");
    }

    function test_capZeroAndWrongNetwork() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PolicyPilotSpreadVault.VaultCapExceeded.selector, 1 ether + 1, 1 ether));
        new PolicyPilotSpreadVault{value: 1 ether + 1}(treasury, 1 ether, 5, 10_000);
        vm.chainId(10143);
        vm.prank(alice);
        vm.expectRevert(PolicyPilotSpreadVault.WrongNetwork.selector);
        new PolicyPilotSpreadVault(treasury, 1 ether, 5, 10_000);
    }

    function test_reenterCaptureReverts() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 1 ether);
        ReenterRouter bad = new ReenterRouter();
        vm.etch(UNI, address(bad).code);
        ReenterRouter(UNI).set(address(v));
        vm.prank(carol);
        vm.expectRevert();
        v.capture(PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 0.1 ether, 1, 0.2 ether);
        assertEq(address(v).balance, 1 ether, "untouched");
    }

    function test_sweepUsdcDoesNotMoveMon() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 1 ether);
        MiniToken(USDC).mint(address(v), 5e6);
        uint256 before = address(v).balance;
        v.sweep(USDC);
        assertEq(IMini(USDC).balanceOf(treasury), 5e6, "usdc to treasury");
        assertEq(address(v).balance, before, "mon stays");
        vm.expectRevert(PolicyPilotSpreadVault.NotSweepable.selector);
        v.sweep(alice);
    }

    function test_zeroFloorAcceptsASmallGainOnTheThinPool() public {
        PolicyPilotSpreadVault v = _open(0, 10_000, 1 ether);
        assertEq(v.minProfitBps(), 0, "zero floor");
        // 1 MON -> 2 USDC on the Uniswap router, and 2 USDC -> 1.0002 MON on Pancake.
        RateRouterSwap(CAKE).set(1e6, 0.5001e18);
        uint256 carolBefore = carol.balance;
        vm.prank(carol);
        (uint256 profit, uint256 bounty) = v.capture(
            PolicyPilotSpreadVault.Venue.UNI_THIN, PolicyPilotSpreadVault.Venue.CAKE, 1 ether, 1, 1 ether
        );
        assertEq(profit, 0.0002 ether, "small profit");
        assertEq(bounty, 0.00002 ether, "bounty");
        assertEq(carol.balance - carolBefore, 0.00002 ether, "caller paid");
        assertEq(address(v).balance, 1.00016 ether, "pool keeps 80%");
        assertEq(RateRouterSwap(UNI).lastFee(), 500, "thin fee uses the uniswap router");
        assertEq(RateRouterSwap(CAKE).lastFee(), 500, "pancake fee");

        RateRouterSwap(CAKE).set(1e6, 0.5e18);
        vm.prank(carol);
        vm.expectRevert();
        v.capture(PolicyPilotSpreadVault.Venue.UNI_THIN, PolicyPilotSpreadVault.Venue.CAKE, 1 ether, 1, 1 ether);
        assertEq(address(v).balance, 1.00016 ether, "flat trip untouched");
    }

    function test_fiveBpsFloorStillRejectsASmallerQuotedMinimum() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 1 ether);
        vm.prank(carol);
        vm.expectRevert(PolicyPilotSpreadVault.Floor.selector);
        v.capture(PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 1 ether, 1, 1 ether + 0.0001 ether);
    }

    function test_bpsAboveFiveHundredReverts() public {
        vm.prank(alice);
        vm.expectRevert(PolicyPilotSpreadVault.Floor.selector);
        new PolicyPilotSpreadVault(treasury, 1 ether, 501, 10_000);
    }

    function test_callerCannotLowerTheFloor() public {
        PolicyPilotSpreadVault v = _open(5, 10_000, 1 ether);
        vm.prank(carol);
        vm.expectRevert(PolicyPilotSpreadVault.Floor.selector);
        v.capture(PolicyPilotSpreadVault.Venue.UNI, PolicyPilotSpreadVault.Venue.CAKE, 1 ether, 1, 1 ether);
    }
}
