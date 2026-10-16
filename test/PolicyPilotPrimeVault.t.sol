// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyPilotPrimeVault} from "../src/PolicyPilotPrimeVault.sol";

contract Router {
    function echo() external payable {
        (bool ok,) = msg.sender.call{value: msg.value}("");
        require(ok);
    }

    function plus(uint256 bonus) external payable {
        (bool ok,) = msg.sender.call{value: msg.value + bonus}("");
        require(ok);
    }
    function keep() external payable {}
    receive() external payable {}
}

contract Reject {
    receive() external payable {
        revert("no");
    }
}

contract Reenter {
    PolicyPilotPrimeVault v;
    bool armed;

    constructor(PolicyPilotPrimeVault _v) {
        v = _v;
    }

    function attack(PolicyPilotPrimeVault.TrancheType t, uint256 shares) external {
        armed = true;
        v.withdraw(t, shares);
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        v.deposit{value: msg.value}(PolicyPilotPrimeVault.TrancheType.SENIOR);
    }
}

contract PolicyPilotPrimeVaultTest is Test {
    PolicyPilotPrimeVault v;
    Router router;
    address admin = makeAddr("admin");
    address exec = makeAddr("exec");
    address guardian = makeAddr("guardian");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant CAP = 1000 ether;
    uint256 constant HOP = 50 ether;
    uint256 constant LOSS = 50 ether;

    function setUp() public {
        vm.prank(admin);
        v = new PolicyPilotPrimeVault(
            guardian, treasury, exec, CAP, HOP, LOSS, PolicyPilotPrimeVault.TrancheType.SENIOR
        );
        router = new Router();
    }

    function _senior() internal view returns (uint256 assets, uint256 supply) {
        (assets, supply) = v.seniorTranche();
    }

    function _junior() internal view returns (uint256 assets, uint256 supply) {
        (assets, supply) = v.juniorTranche();
    }

    function test_constantsMatchTheRetailCopy() public view {
        assertEq(v.SENIOR_PROFIT_BPS(), 3000);
        assertEq(v.PERFORMANCE_FEE_BPS(), 1000);
        assertEq(v.HOP_BPS(), 10_000);
        assertEq(v.BREAKER_BPS(), 150);
    }

    function test_constructorRejectsZeros() public {
        vm.expectRevert(PolicyPilotPrimeVault.ZeroAddress.selector);
        new PolicyPilotPrimeVault(address(0), treasury, exec, 1, 1, 0, PolicyPilotPrimeVault.TrancheType.SENIOR);
        vm.expectRevert(PolicyPilotPrimeVault.ZeroAmount.selector);
        new PolicyPilotPrimeVault(guardian, treasury, exec, 0, 1, 0, PolicyPilotPrimeVault.TrancheType.SENIOR);
    }

    function test_constructorDepositLandsInTheChosenTranche() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        PolicyPilotPrimeVault opened = new PolicyPilotPrimeVault{value: 0.4 ether}(
            alice, alice, alice, 1 ether, 0.05 ether, 0.05 ether, PolicyPilotPrimeVault.TrancheType.JUNIOR
        );
        assertEq(opened.assetsOf(alice, PolicyPilotPrimeVault.TrancheType.JUNIOR), 0.4 ether);
        assertEq(opened.assetsOf(alice, PolicyPilotPrimeVault.TrancheType.SENIOR), 0);
        assertEq(opened.highWatermark(), 0.4 ether);
        assertEq(address(opened).balance, opened.totalVaultAssets());
    }

    function test_depositAndWithdrawAreExactForOneDepositor() public {
        vm.deal(alice, 3 ether);
        vm.startPrank(alice);
        v.deposit{value: 1 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: 2 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        uint256 s = v.userShares(alice, PolicyPilotPrimeVault.TrancheType.SENIOR);
        uint256 j = v.userShares(alice, PolicyPilotPrimeVault.TrancheType.JUNIOR);
        uint256 outS = v.withdraw(PolicyPilotPrimeVault.TrancheType.SENIOR, s);
        uint256 outJ = v.withdraw(PolicyPilotPrimeVault.TrancheType.JUNIOR, j);
        vm.stopPrank();
        assertEq(outS, 1 ether);
        assertEq(outJ, 2 ether);
        assertEq(v.totalVaultAssets(), 0);
        assertEq(address(v).balance, 0);
    }

    function test_twoDepositorsKeepTheirOwnMoney() public {
        vm.deal(alice, 5 ether);
        vm.deal(bob, 5 ether);
        vm.prank(alice);
        v.deposit{value: 4 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        vm.prank(bob);
        v.deposit{value: 1 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        uint256 shares = v.userShares(alice, PolicyPilotPrimeVault.TrancheType.SENIOR);
        vm.prank(alice);
        uint256 out = v.withdraw(PolicyPilotPrimeVault.TrancheType.SENIOR, shares);
        assertEq(out, 4 ether);
        assertEq(v.assetsOf(bob, PolicyPilotPrimeVault.TrancheType.SENIOR), 1 ether);
    }

    function test_vaultCap() public {
        vm.deal(alice, CAP + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PolicyPilotPrimeVault.VaultCapExceeded.selector, CAP + 1, CAP));
        v.deposit{value: CAP + 1}(PolicyPilotPrimeVault.TrancheType.SENIOR);
    }

    function test_donationDoesNotStealSharesUntilSkim() public {
        vm.deal(alice, 1000 ether + 1);
        vm.prank(alice);
        v.deposit{value: 1}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        vm.deal(address(v), 1000 ether + 1);
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        v.deposit{value: 10 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        assertApproxEqAbs(v.assetsOf(bob, PolicyPilotPrimeVault.TrancheType.SENIOR), 10 ether, 1);
        uint256 before = v.totalVaultAssets();
        vm.prank(bob);
        v.skim();
        assertGt(v.totalVaultAssets(), before);
        assertEq(address(v).balance, v.totalVaultAssets() + 0); // fee left to treasury, so balance == assets
        assertEq(address(v).balance, v.totalVaultAssets());
    }

    function test_feeOnlyOnGainsAboveTheWatermark() public {
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        v.deposit{value: 100 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        // 1% loss, inside the 1.5% breaker. Junior holds it all.
        vm.prank(exec);
        v.hop(bytes32("loss"), address(router), abi.encodeWithSelector(Router.keep.selector), 1 ether, 1 ether);
        assertEq(v.highWatermark(), 100 ether);
        assertEq(v.totalVaultAssets(), 99 ether);
        assertEq(v.drawdownBps(), 100);

        vm.deal(alice, 2 ether);
        vm.prank(alice);
        v.ingestProfit{value: 2 ether}();
        // Gain above the watermark is 1 ether, fee is 0.1, so 1.9 is distributed.
        assertEq(treasury.balance, 0.1 ether);
        assertEq(v.totalVaultAssets(), 100.9 ether);
        assertEq(v.highWatermark(), 100.9 ether);
        (uint256 seniorAssets,) = _senior();
        (uint256 juniorAssets,) = _junior();
        // Senior has no shareholders, so the whole 1.9 stays with junior.
        assertEq(seniorAssets, 0);
        assertEq(juniorAssets, 100.9 ether);
    }

    function test_profitSplitsThirtySeventyWhenBothTranchesHaveDepositors() public {
        vm.deal(alice, 200 ether);
        vm.startPrank(alice);
        v.deposit{value: 100 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: 100 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.stopPrank();
        vm.deal(bob, 100 ether);
        vm.prank(bob);
        v.ingestProfit{value: 100 ether}();
        assertEq(treasury.balance, 10 ether);
        (uint256 seniorAssets,) = _senior();
        (uint256 juniorAssets,) = _junior();
        assertEq(seniorAssets, 127 ether);
        assertEq(juniorAssets, 163 ether);
        assertEq(v.totalVaultAssets(), 290 ether);
        assertEq(address(v).balance, 290 ether);
    }

    function test_hopRevertsWhenUnprofitableAndWhenOverTheFivePercentCap() public {
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        v.deposit{value: 100 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.prank(exec);
        vm.expectRevert(abi.encodeWithSelector(PolicyPilotPrimeVault.Unprofitable.selector, 1 ether, 0));
        v.hop(bytes32("bad"), address(router), abi.encodeWithSelector(Router.keep.selector), 1 ether, 0);
        assertEq(v.totalVaultAssets(), 100 ether);
        assertFalse(v.executed(bytes32("bad")));

        vm.prank(exec);
        vm.expectRevert(abi.encodeWithSelector(PolicyPilotPrimeVault.HopCapExceeded.selector, 50 ether + 1, 50 ether));
        v.hop(bytes32("big"), address(router), abi.encodeWithSelector(Router.echo.selector), 50 ether + 1, 0);
    }

    function test_hopProfitPaysTheWatermarkFee() public {
        vm.deal(alice, 100 ether);
        vm.startPrank(alice);
        v.deposit{value: 40 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: 60 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.stopPrank();
        vm.deal(address(router), 10 ether);
        vm.prank(exec);
        v.hop(bytes32("plus"), address(router), abi.encodeWithSelector(Router.plus.selector, 10 ether), 1 ether, 0);
        assertEq(treasury.balance, 1 ether);
        (uint256 seniorAssets,) = _senior();
        (uint256 juniorAssets,) = _junior();
        // 9 ether distributable: 2.7 senior, 6.3 junior.
        assertEq(seniorAssets, 42.7 ether);
        assertEq(juniorAssets, 66.3 ether);
        assertEq(address(v).balance, v.totalVaultAssets());
    }

    function test_lossHitsJuniorThenSeniorAndHaltsPastTheFloor() public {
        vm.deal(alice, 110 ether);
        vm.startPrank(alice);
        v.deposit{value: 100 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: 10 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.stopPrank();
        // The whole balance can move, up to the 50 MON absolute cap, so 4 ether is inside and past the 1.5% floor.
        vm.prank(exec);
        v.hop(bytes32("spill"), address(router), abi.encodeWithSelector(Router.keep.selector), 4 ether, 4 ether);
        (uint256 seniorAssets,) = _senior();
        (uint256 juniorAssets,) = _junior();
        assertEq(juniorAssets, 6 ether);
        assertEq(seniorAssets, 100 ether);
        assertTrue(v.isEmergencyHalted());
        assertGt(v.drawdownBps(), 150);

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(PolicyPilotPrimeVault.CircuitBreakerTripped.selector);
        v.deposit{value: 1 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        vm.prank(exec);
        vm.expectRevert(PolicyPilotPrimeVault.CircuitBreakerTripped.selector);
        v.hop(bytes32("again"), address(router), abi.encodeWithSelector(Router.echo.selector), 0.1 ether, 0);

        uint256 shares = v.userShares(alice, PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.prank(alice);
        uint256 back = v.withdraw(PolicyPilotPrimeVault.TrancheType.JUNIOR, shares);
        assertEq(back, 6 ether);
    }

    function test_lossSpillsIntoSeniorWhenJuniorIsSmaller() public {
        vm.deal(alice, 80 ether);
        vm.startPrank(alice);
        v.deposit{value: 70 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: 1 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.stopPrank();
        vm.prank(exec);
        v.hop(bytes32("spill"), address(router), abi.encodeWithSelector(Router.keep.selector), 2 ether, 2 ether);
        (uint256 seniorAssets,) = _senior();
        (uint256 juniorAssets,) = _junior();
        assertEq(juniorAssets, 0);
        assertEq(seniorAssets, 69 ether);
        assertTrue(v.isEmergencyHalted());
    }

    function test_strangerCannotHopOrHaltAndGuardianCannotResume() public {
        vm.prank(alice);
        vm.expectRevert(PolicyPilotPrimeVault.NotExecutor.selector);
        v.hop(bytes32("x"), address(router), abi.encodeWithSelector(Router.echo.selector), 0, 0);
        vm.prank(alice);
        vm.expectRevert(PolicyPilotPrimeVault.NotAdmin.selector);
        v.triggerEmergencyHalt("nope");
        vm.prank(guardian);
        v.triggerEmergencyHalt("pause");
        assertTrue(v.isEmergencyHalted());
        vm.prank(guardian);
        vm.expectRevert(PolicyPilotPrimeVault.NotAdmin.selector);
        v.resumeTrading();
        vm.prank(admin);
        v.resumeTrading();
        assertFalse(v.isEmergencyHalted());
    }

    function test_replayAndRejectingTreasury() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        v.deposit{value: 10 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.prank(exec);
        v.hop(bytes32("once"), address(router), abi.encodeWithSelector(Router.echo.selector), 0.1 ether, 0);
        vm.prank(exec);
        vm.expectRevert(abi.encodeWithSelector(PolicyPilotPrimeVault.RequestAlreadyExecuted.selector, bytes32("once")));
        v.hop(bytes32("once"), address(router), abi.encodeWithSelector(Router.echo.selector), 0.1 ether, 0);

        Reject sink = new Reject();
        vm.prank(admin);
        PolicyPilotPrimeVault paid = new PolicyPilotPrimeVault(
            guardian, address(sink), exec, CAP, HOP, LOSS, PolicyPilotPrimeVault.TrancheType.SENIOR
        );
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        paid.deposit{value: 1 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(PolicyPilotPrimeVault.TransferFailed.selector);
        paid.ingestProfit{value: 1 ether}();
        assertEq(paid.totalVaultAssets(), 1 ether);
    }

    function test_reentrancyOnWithdrawCannotDeposit() public {
        Reenter attacker = new Reenter(v);
        vm.deal(address(attacker), 2 ether);
        vm.prank(address(attacker));
        v.deposit{value: 1 ether}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        uint256 shares = v.userShares(address(attacker), PolicyPilotPrimeVault.TrancheType.SENIOR);
        uint256 bal = address(v).balance;
        vm.prank(address(attacker));
        vm.expectRevert(PolicyPilotPrimeVault.TransferFailed.selector);
        attacker.attack(PolicyPilotPrimeVault.TrancheType.SENIOR, shares);
        assertEq(address(v).balance, bal);
        assertEq(v.assetsOf(address(attacker), PolicyPilotPrimeVault.TrancheType.SENIOR), 1 ether);
    }

    function test_resumeRestartsTheWatermark() public {
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        v.deposit{value: 100 ether}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.prank(exec);
        v.hop(bytes32("down"), address(router), abi.encodeWithSelector(Router.keep.selector), 2 ether, 2 ether);
        assertTrue(v.isEmergencyHalted());
        vm.prank(admin);
        v.resumeTrading();
        assertEq(v.highWatermark(), 98 ether);
        assertTrue(v.tradingLive());
        vm.prank(exec);
        v.hop(bytes32("ok"), address(router), abi.encodeWithSelector(Router.echo.selector), 1 ether, 0);
        assertEq(v.totalVaultAssets(), 98 ether);
    }

    function testFuzz_roundTrip(uint96 rawX, uint96 rawY) public {
        uint256 x = bound(rawX, 1, 400 ether);
        uint256 y = bound(rawY, 1, 400 ether);
        vm.deal(alice, x + y);
        vm.startPrank(alice);
        v.deposit{value: x}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: y}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        uint256 outX = v.withdraw(
            PolicyPilotPrimeVault.TrancheType.SENIOR, v.userShares(alice, PolicyPilotPrimeVault.TrancheType.SENIOR)
        );
        uint256 outY = v.withdraw(
            PolicyPilotPrimeVault.TrancheType.JUNIOR, v.userShares(alice, PolicyPilotPrimeVault.TrancheType.JUNIOR)
        );
        vm.stopPrank();
        assertApproxEqAbs(outX, x, 1);
        assertApproxEqAbs(outY, y, 1);
    }

    function testFuzz_juniorIsHitBeforeSenior(uint96 rawJ, uint96 rawS, uint96 rawL) public {
        uint256 j = bound(rawJ, 0.1 ether, 2 ether);
        uint256 s = bound(rawS, 20 ether, 40 ether);
        uint256 nav = j + s;
        uint256 ceiling = nav < 50 ether ? nav : 50 ether;
        uint256 loss = bound(rawL, 1, ceiling);
        vm.deal(alice, j + s);
        vm.startPrank(alice);
        v.deposit{value: s}(PolicyPilotPrimeVault.TrancheType.SENIOR);
        v.deposit{value: j}(PolicyPilotPrimeVault.TrancheType.JUNIOR);
        vm.stopPrank();
        vm.prank(exec);
        v.hop(
            keccak256(abi.encode(j, s, loss)), address(router), abi.encodeWithSelector(Router.keep.selector), loss, loss
        );
        (uint256 seniorAssets,) = _senior();
        (uint256 juniorAssets,) = _junior();
        if (loss <= j) {
            assertEq(juniorAssets, j - loss);
            assertEq(seniorAssets, s);
        } else {
            assertEq(juniorAssets, 0);
            assertEq(seniorAssets, s - (loss - j));
        }
        assertEq(address(v).balance, v.totalVaultAssets());
    }
}
