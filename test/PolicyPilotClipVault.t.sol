// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyPilotClipVault} from "../src/PolicyPilotClipVault.sol";

contract ClipToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ClipWMON is ClipToken {
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

contract ClipMockPool {
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant CAKE = 0x63e48B725540A3Db24ACF6682a29f877808C53F2;
    uint256 public outAmount;

    function setOut(uint256 v) external {
        outAmount = v;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        uint256 amountIn = uint256(amountSpecified);
        uint256 out = outAmount;
        if (zeroForOne) {
            _callback(int256(amountIn), 0, data);
            ClipToken(USDC).mint(recipient, out);
            return (int256(amountIn), -int256(out));
        }
        _callback(0, int256(amountIn), data);
        ClipToken(WMON).mint(recipient, out);
        return (-int256(out), int256(amountIn));
    }

    function _callback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) internal {
        if (address(this) == CAKE) {
            PolicyPilotClipVault(payable(msg.sender)).pancakeV3SwapCallback(amount0Delta, amount1Delta, data);
        } else {
            PolicyPilotClipVault(payable(msg.sender)).uniswapV3SwapCallback(amount0Delta, amount1Delta, data);
        }
    }
}

contract PolicyPilotClipVaultTest is Test {
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant UNI = 0x659bD0BC4167BA25c62E05656F78043E7eD4a9da;
    address constant THIN = 0x5Bc39A29EA5d8315263EC8939d6AD393dEbC34E9;
    address constant CAKE = 0x63e48B725540A3Db24ACF6682a29f877808C53F2;

    address alice = address(0xA11CE);
    address carol = address(0xCA201);
    address treasury = address(0xFE7);

    function setUp() public {
        vm.chainId(143);
        ClipWMON w = new ClipWMON();
        ClipToken u = new ClipToken();
        ClipMockPool p = new ClipMockPool();
        vm.etch(WMON, address(w).code);
        vm.etch(USDC, address(u).code);
        vm.etch(UNI, address(p).code);
        vm.etch(THIN, address(p).code);
        vm.etch(CAKE, address(p).code);
        vm.deal(WMON, 100 ether);
    }

    function test_clip_pays_the_gain_and_leaves_eighty_percent() public {
        ClipMockPool(THIN).setOut(2_000_000);
        ClipMockPool(CAKE).setOut(0.51 ether);
        vm.deal(alice, 0.5 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 0.5 ether}(treasury, 10 ether);
        uint256 start = address(v).balance;
        uint256 carolBefore = carol.balance;

        vm.prank(carol);
        (uint256 profit, uint256 bounty) = v.clip(PolicyPilotClipVault.Venue.UNI_THIN, PolicyPilotClipVault.Venue.CAKE, 0.5 ether, 1, 0.5 ether + 1);

        assertEq(profit, 0.01 ether, "gain");
        assertEq(bounty, 0.001 ether, "caller 10%");
        assertEq(address(v).balance, start + profit - bounty - bounty, "80% stayed");
        assertEq(carol.balance, carolBefore + bounty, "caller paid");
        assertEq(treasury.balance, 0.001 ether, "treasury paid");
        assertGt(address(v).balance, start, "depositors hold more MON");
    }

    function test_whole_balance_is_allowed() public {
        ClipMockPool(UNI).setOut(1_000_000);
        ClipMockPool(CAKE).setOut(1.02 ether);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 1 ether}(treasury, 10 ether);
        vm.prank(carol);
        (uint256 profit,) = v.clip(PolicyPilotClipVault.Venue.UNI, PolicyPilotClipVault.Venue.CAKE, 1 ether, 1, 1 ether + 1);
        assertEq(profit, 0.02 ether);
    }

    function test_flat_round_trip_reverts() public {
        ClipMockPool(THIN).setOut(1_000_000);
        ClipMockPool(CAKE).setOut(0.5 ether);
        vm.deal(alice, 0.5 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 0.5 ether}(treasury, 10 ether);
        vm.prank(carol);
        vm.expectRevert();
        v.clip(PolicyPilotClipVault.Venue.UNI_THIN, PolicyPilotClipVault.Venue.CAKE, 0.5 ether, 1, 0.5 ether + 1);
    }

    function test_same_venue_and_oversize_revert() public {
        vm.deal(alice, 0.2 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 0.2 ether}(treasury, 10 ether);
        vm.expectRevert(PolicyPilotClipVault.SameVenue.selector);
        v.clip(PolicyPilotClipVault.Venue.CAKE, PolicyPilotClipVault.Venue.CAKE, 0.1 ether, 1, 0.1 ether + 1);
        vm.expectRevert();
        v.clip(PolicyPilotClipVault.Venue.UNI, PolicyPilotClipVault.Venue.CAKE, 0.3 ether, 1, 0.3 ether + 1);
    }

    function test_stranger_callback_reverts() public {
        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 0.1 ether}(treasury, 10 ether);
        vm.prank(alice);
        vm.expectRevert(PolicyPilotClipVault.NotPool.selector);
        v.uniswapV3SwapCallback(1, 0, "");
        vm.prank(alice);
        vm.expectRevert(PolicyPilotClipVault.NotPool.selector);
        v.pancakeV3SwapCallback(0, 1, "");
    }

    function test_withdraw_returns_the_deposit() public {
        vm.deal(alice, 0.4 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 0.4 ether}(treasury, 10 ether);
        uint256 shares = v.balanceOf(alice);
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 assets = v.withdraw(shares);
        assertGt(assets, 0.39 ether);
        assertEq(alice.balance, before + assets);
        assertEq(address(v).balance, 0.4 ether - assets);
    }

    function test_cap_and_wrong_network() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        PolicyPilotClipVault v = new PolicyPilotClipVault{value: 1 ether}(treasury, 1 ether);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        v.deposit{value: 0.1 ether}();
        vm.chainId(1);
        vm.expectRevert(PolicyPilotClipVault.WrongNetwork.selector);
        new PolicyPilotClipVault(treasury, 1 ether);
    }
}
