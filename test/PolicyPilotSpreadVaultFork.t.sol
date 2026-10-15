// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyPilotSpreadVault} from "../src/PolicyPilotSpreadVault.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @notice Live Monad pools. Run: forge test --fork-url https://rpc.monad.xyz --match-contract PolicyPilotSpreadVaultForkTest -vv
contract PolicyPilotSpreadVaultForkTest is Test {
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant UNI_QUOTER = 0x661E93cca42AfacB172121EF892830cA3b70F08d;
    address constant CAKE_QUOTER = 0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997;

    address alice = address(0xA11CE);
    address carol = address(0xCA201);
    address treasury = address(0xFE7);
    bool on;

    uint256 bestIn;
    uint256 bestProfit;
    uint256 bestUsdc;
    uint8 bestSell;
    uint8 bestBuy;

    function setUp() public {
        if (block.chainid != 143) return;
        on = true;
        vm.deal(carol, 1 ether);
    }

    function test_fork_capture_best_live_gain() public {
        if (!on) return;
        _search();
        _captureBest();
    }

    function _search() internal {
        uint256[8] memory sizes = [uint256(0.05 ether), 0.1 ether, 0.2 ether, 0.4 ether, 0.6 ether, 0.8 ether, 1 ether, 2 ether];
        for (uint256 i; i < sizes.length; ++i) {
            _searchSize(sizes[i]);
        }
        assertGt(bestProfit, 0, "no live MON gain");
        emit log_named_uint("bestIn", bestIn);
        emit log_named_uint("quotedProfit", bestProfit);
        emit log_named_uint("sellVenue", bestSell);
        emit log_named_uint("buyVenue", bestBuy);
    }

    function _searchSize(uint256 amount) internal {
        for (uint8 s; s < 3; ++s) {
            uint256 usdc = _tryQuote(s, WMON, USDC, amount);
            if (usdc == 0) continue;
            for (uint8 b; b < 3; ++b) {
                if (b == s) continue;
                _consider(amount, s, b, usdc, _tryQuote(b, USDC, WMON, usdc));
            }
        }
    }

    function _consider(uint256 amount, uint8 sell, uint8 buy, uint256 usdc, uint256 back) internal {
        if (back <= amount) return;
        uint256 gain = back - amount;
        if (gain <= bestProfit) return;
        bestProfit = gain;
        bestIn = amount;
        bestUsdc = usdc;
        bestSell = sell;
        bestBuy = buy;
    }

    function _captureBest() internal {
        uint256 amount = bestIn;
        uint256 minUsdc = bestUsdc * 95 / 100;
        if (minUsdc == 0) minUsdc = 1;
        vm.deal(alice, amount);
        vm.prank(alice);
        PolicyPilotSpreadVault v = new PolicyPilotSpreadVault{value: amount}(treasury, 10 ether, 0, 10_000);
        uint256 start = address(v).balance;
        uint256 carolBefore = carol.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(carol);
        uint256 gasStart = gasleft();
        (uint256 profit, uint256 bounty) = v.capture(_venue(bestSell), _venue(bestBuy), amount, minUsdc, amount);
        uint256 gasUsed = gasStart - gasleft();

        assertGt(profit, 0, "pool gained MON");
        uint256 protocolFee = profit / 10;
        assertEq(bounty, protocolFee, "caller bounty");
        assertEq(address(v).balance, start + profit - bounty - protocolFee, "80% stayed in the pool");
        assertGt(address(v).balance, start, "depositors hold more MON");
        assertEq(carol.balance, carolBefore + bounty, "caller paid from the profit");
        assertEq(treasury.balance, treasuryBefore + protocolFee, "treasury paid from the profit");

        emit log_named_uint("capturedProfit", profit);
        emit log_named_uint("poolAfter", address(v).balance);
        emit log_named_uint("gasUsed", gasUsed);
        emit log_named_uint("gasCostAt100gwei", gasUsed * 100 gwei);
    }

    function _venue(uint8 id) internal pure returns (PolicyPilotSpreadVault.Venue) {
        if (id == 0) return PolicyPilotSpreadVault.Venue.UNI;
        if (id == 1) return PolicyPilotSpreadVault.Venue.CAKE;
        return PolicyPilotSpreadVault.Venue.UNI_THIN;
    }

    function _quoter(uint8 venue) internal pure returns (address) {
        return venue == 1 ? CAKE_QUOTER : UNI_QUOTER;
    }

    function _fee(uint8 venue) internal pure returns (uint24) {
        return venue == 0 ? 3000 : 500;
    }

    function _tryQuote(uint8 venue, address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        try IQuoterV2(_quoter(venue))
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, fee: _fee(venue), sqrtPriceLimitX96: 0
                })
            ) returns (uint256 amountOut, uint160, uint32, uint256) {
            return amountOut;
        } catch {
            return 0;
        }
    }
}
