// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyPilotClipVault} from "../src/PolicyPilotClipVault.sol";

interface IClipQuoter {
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

/// @notice Live Monad pools. Run: forge test --fork-url https://rpc.monad.xyz --match-contract PolicyPilotClipVaultForkTest -vv
contract PolicyPilotClipVaultForkTest is Test {
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

    function test_fork_clip_best_live_gain_and_gas() public {
        if (!on) return;
        uint256[12] memory sizes = [
            uint256(0.05 ether),
            0.1 ether,
            0.2 ether,
            0.3 ether,
            0.4 ether,
            0.5 ether,
            0.6 ether,
            0.8 ether,
            1 ether,
            2 ether,
            5 ether,
            10 ether
        ];
        for (uint256 i; i < sizes.length; ++i) {
            _searchSize(sizes[i]);
        }
        assertGt(bestProfit, 0, "no live MON gain");
        emit log_named_uint("bestIn", bestIn);
        emit log_named_uint("quotedProfit", bestProfit);
        emit log_named_uint("sellVenue", bestSell);
        emit log_named_uint("buyVenue", bestBuy);

        uint256 minUsdc = bestUsdc * 95 / 100;
        if (minUsdc == 0) minUsdc = 1;
        vm.deal(alice, bestIn);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: bestIn}(treasury, 10 ether);
        uint256 start = address(v).balance;

        vm.prank(carol);
        uint256 gasStart = gasleft();
        (uint256 profit, uint256 bounty) = v.clip(_venue(bestSell), _venue(bestBuy), bestIn, minUsdc, bestIn + 1);
        uint256 gasUsed = gasStart - gasleft();

        assertGt(profit, 0, "pool gained MON");
        assertEq(bounty, profit / 10, "caller bounty");
        assertGt(address(v).balance, start, "depositors hold more MON");
        uint256 charge = gasUsed * 100 gwei;
        emit log_named_uint("capturedProfit", profit);
        emit log_named_uint("poolAfter", address(v).balance);
        emit log_named_uint("gasUsed", gasUsed);
        emit log_named_uint("gasCostAt100gwei", charge);
        emit log_named_uint("netAt100gwei", profit > charge ? profit - charge : 0);
    }

    function _searchSize(uint256 amount) internal {
        for (uint8 s; s < 3; ++s) {
            uint256 usdc = _tryQuote(s, WMON, USDC, amount);
            if (usdc == 0) continue;
            for (uint8 b; b < 3; ++b) {
                if (b == s) continue;
                uint256 back = _tryQuote(b, USDC, WMON, usdc);
                if (back <= amount) continue;
                uint256 gain = back - amount;
                if (gain <= bestProfit) continue;
                bestProfit = gain;
                bestIn = amount;
                bestUsdc = usdc;
                bestSell = s;
                bestBuy = b;
            }
        }
    }

    function _venue(uint8 id) internal pure returns (PolicyPilotClipVault.Venue) {
        if (id == 0) return PolicyPilotClipVault.Venue.UNI;
        if (id == 1) return PolicyPilotClipVault.Venue.CAKE;
        return PolicyPilotClipVault.Venue.UNI_THIN;
    }

    function _quoter(uint8 venue) internal pure returns (address) {
        return venue == 1 ? CAKE_QUOTER : UNI_QUOTER;
    }

    function _fee(uint8 venue) internal pure returns (uint24) {
        return venue == 0 ? 3000 : 500;
    }

    function _tryQuote(uint8 venue, address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        try IClipQuoter(_quoter(venue))
            .quoteExactInputSingle(
                IClipQuoter.QuoteExactInputSingleParams({
                    tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, fee: _fee(venue), sqrtPriceLimitX96: 0
                })
            ) returns (uint256 amountOut, uint160, uint32, uint256) {
            return amountOut;
        } catch {
            return 0;
        }
    }
}
