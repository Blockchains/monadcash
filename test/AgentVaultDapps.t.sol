// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {AgentVault, CallRuleInit, TokenCapInit} from "../src/AgentVault.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract MockWMON is ERC20 {
    constructor() ERC20("WMON", "WMON") {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 a) external { _burn(msg.sender, a); payable(msg.sender).transfer(a); }
}
contract MockToken is ERC20 { constructor() ERC20("USD", "USD") {} function mint(address t, uint256 a) external { _mint(t, a); } }
/// swap(tokenIn, amountIn, recipient, minOut): pulls tokenIn (or takes MON if tokenIn==0), pays 2x in `out`
contract MockRouter {
    MockToken public out; bool public greedy;
    constructor(MockToken o) { out = o; }
    function setGreedy(bool g) external { greedy = g; }
    function swap(address tokenIn, uint256 amountIn, address recipient, uint256 minOut) external payable returns (uint256 o) {
        if (tokenIn == address(0)) require(msg.value == amountIn, "value");
        else IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        o = greedy ? 0 : amountIn * 2;
        require(o >= minOut, "slippage");
        out.mint(recipient, o);
    }
    function pullMore(address token, address from, uint256 a) external { IERC20(token).transferFrom(from, address(this), a); }
}

contract AgentVaultDappsTest is Test {
    AgentVaultFactory f; AgentVault v; MockWMON w; MockToken usd; MockRouter r;
    address owner = address(0xA11CE); address agent = address(0xA6E7); address eve = address(0xE7E);
    AgentVault.CallOpts none;

    function setUp() public {
        f = new AgentVaultFactory(1 ether, 3 ether); w = new MockWMON(); usd = new MockToken(); r = new MockRouter(usd);
        vm.deal(owner, 10 ether);
        vm.startPrank(owner);
        v = f.createVault{value: 1 ether}(agent, 0.2 ether, 0.5 ether, new address[](0), new CallRuleInit[](0), new TokenCapInit[](0));
        v.setCallRule(address(w), MockWMON.deposit.selector, true, 255);
        v.setCallRule(address(w), MockWMON.withdraw.selector, true, 255);
        v.setCallRule(address(r), MockRouter.swap.selector, true, 2); // recipient = word 2
        v.setTokenCap(address(usd), 100 ether);
        vm.stopPrank();
    }
    function _call(bytes32 id, address t, uint256 val, bytes memory d, AgentVault.CallOpts memory o) internal { vm.prank(agent); v.executeCall(id, t, val, d, o); }

    function test_wrap_unwrap() public {
        _call("w1", address(w), 0.1 ether, abi.encodeCall(MockWMON.deposit, ()), AgentVault.CallOpts(address(0), 0, address(w), 0.1 ether));
        assertEq(w.balanceOf(address(v)), 0.1 ether); assertEq(v.totalSpent(), 0.1 ether);
        _call("w2", address(w), 0, abi.encodeCall(MockWMON.withdraw, (0.1 ether)), AgentVault.CallOpts(address(0), 0, address(0), 0.1 ether));
        assertEq(address(v).balance, 1 ether); assertEq(w.balanceOf(address(v)), 0);
    }
    function test_swap_native_and_back_with_exact_approval_reset() public {
        _call("s1", address(r), 0.1 ether, abi.encodeCall(MockRouter.swap, (address(0), 0.1 ether, address(v), 0.2 ether)), AgentVault.CallOpts(address(0), 0, address(usd), 0.2 ether));
        assertEq(usd.balanceOf(address(v)), 0.2 ether);
        _call("s2", address(r), 0, abi.encodeCall(MockRouter.swap, (address(usd), 0.2 ether, address(v), 0)), AgentVault.CallOpts(address(usd), 0.2 ether, address(0), 0));
        assertEq(usd.allowance(address(v), address(r)), 0, "approval reset");
    }
    function test_recipient_must_be_vault() public {
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientMustBeVault.selector, eve));
        v.executeCall("x", address(r), 0.1 ether, abi.encodeCall(MockRouter.swap, (address(0), 0.1 ether, eve, 0)), none);
    }
    function test_not_allowlisted_target_or_selector() public {
        MockRouter other = new MockRouter(usd);
        bytes memory d = abi.encodeCall(MockRouter.swap, (address(0), 1, address(v), 0));
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.CallNotAllowed.selector, address(other), MockRouter.swap.selector)); v.executeCall("x", address(other), 1, d, none);
        bytes memory d2 = abi.encodeCall(MockRouter.pullMore, (address(usd), address(v), 1));
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.CallNotAllowed.selector, address(r), MockRouter.pullMore.selector)); v.executeCall("y", address(r), 0, d2, none);
    }
    function test_value_caps_and_budget() public {
        bytes memory d = abi.encodeCall(MockWMON.deposit, ());
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.PerPaymentCapExceeded.selector, 0.3 ether, 0.2 ether)); v.executeCall("a", address(w), 0.3 ether, d, none);
        _call("b", address(w), 0.2 ether, d, none); _call("c", address(w), 0.2 ether, d, none);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.BudgetExceeded.selector, 0.2 ether, 0.1 ether)); v.executeCall("d", address(w), 0.2 ether, d, none);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.RequestAlreadyExecuted.selector, bytes32("b"))); v.executeCall("b", address(w), 0, d, none);
    }
    function test_token_cap_and_unapproved_token() public {
        usd.mint(address(v), 200 ether);
        bytes memory d = abi.encodeCall(MockRouter.swap, (address(usd), 150 ether, address(v), 0));
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.TokenCapExceeded.selector, address(usd), 150 ether, 100 ether)); v.executeCall("t", address(r), 0, d, AgentVault.CallOpts(address(usd), 150 ether, address(0), 0));
        bytes memory d2 = abi.encodeCall(MockRouter.swap, (address(w), 1, address(v), 0));
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.TokenCapExceeded.selector, address(w), 1, 0)); v.executeCall("t2", address(r), 0, d2, AgentVault.CallOpts(address(w), 1, address(0), 0));
    }
    function test_min_out_enforced_by_vault() public {
        vm.prank(owner); r.setGreedy(true);
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.MinOutNotMet.selector, 0, 0.2 ether));
        v.executeCall("g", address(r), 0.1 ether, abi.encodeCall(MockRouter.swap, (address(0), 0.1 ether, address(v), 0)), AgentVault.CallOpts(address(0), 0, address(usd), 0.2 ether));
        assertEq(v.totalSpent(), 0); assertEq(address(v).balance, 1 ether);
    }
    function test_forbidden_selectors_and_targets() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenSelector.selector, IERC20.approve.selector)); v.setCallRule(address(usd), IERC20.approve.selector, true, 255);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenSelector.selector, IERC20.transfer.selector)); v.setCallRule(address(usd), IERC20.transfer.selector, true, 255);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenSelector.selector, IERC20.transferFrom.selector)); v.setCallRule(address(usd), IERC20.transferFrom.selector, true, 255);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenTarget.selector, address(v))); v.setCallRule(address(v), AgentVault.withdraw.selector, true, 255);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenTarget.selector, address(f))); v.setCallRule(address(f), bytes4(0x12345678), true, 255);
        vm.stopPrank();
        vm.prank(eve); vm.expectRevert(AgentVault.NotOwner.selector); v.setCallRule(address(w), MockWMON.deposit.selector, true, 255);
        vm.prank(eve); vm.expectRevert(AgentVault.NotOwner.selector); v.setTokenCap(address(usd), 1);
        vm.prank(eve); vm.expectRevert(AgentVault.NotOwner.selector); v.withdrawToken(address(usd), eve, 1);
    }
    function test_paused_and_non_executor() public {
        bytes memory d = abi.encodeCall(MockWMON.deposit, ());
        vm.prank(eve); vm.expectRevert(AgentVault.NotExecutor.selector); v.executeCall("e", address(w), 0.1 ether, d, none);
        vm.prank(owner); v.setPaused(true);
        vm.prank(agent); vm.expectRevert(AgentVault.Paused.selector); v.executeCall("p", address(w), 0.1 ether, d, none);
    }
    function test_owner_withdraw_tokens() public {
        _call("w1", address(w), 0.1 ether, abi.encodeCall(MockWMON.deposit, ()), none);
        vm.prank(owner); v.withdrawToken(address(w), owner, 0.1 ether); assertEq(w.balanceOf(owner), 0.1 ether);
    }
    function test_create_with_rules_one_tx() public {
        CallRuleInit[] memory rules = new CallRuleInit[](1); rules[0] = CallRuleInit(address(w), MockWMON.deposit.selector, 255);
        TokenCapInit[] memory caps = new TokenCapInit[](1); caps[0] = TokenCapInit(address(usd), 5);
        vm.prank(owner); AgentVault v2 = f.createVault{value: 0.1 ether}(agent, 0.05 ether, 0.1 ether, new address[](0), rules, caps);
        (bool ok,) = v2.callRule(address(w), MockWMON.deposit.selector); assertTrue(ok); assertEq(v2.tokenCap(address(usd)), 5);
        CallRuleInit[] memory bad = new CallRuleInit[](1); bad[0] = CallRuleInit(address(usd), IERC20.approve.selector, 255);
        vm.prank(owner); vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenSelector.selector, IERC20.approve.selector));
        f.createVault(agent, 1, 1, new address[](0), bad, new TokenCapInit[](0));
        CallRuleInit[] memory badT = new CallRuleInit[](1); badT[0] = CallRuleInit(agent, bytes4(0x12345678), 255);
        vm.prank(owner); vm.expectRevert(abi.encodeWithSelector(AgentVault.ForbiddenTarget.selector, agent));
        f.createVault(agent, 1, 1, new address[](0), badT, new TokenCapInit[](0));
    }
    function test_receive_works_with_2300_gas_stipend() public {
        vm.deal(address(this), 1 ether); payable(address(v)).transfer(1);
    }
    function testFuzz_call_value_bounded(uint256 val) public {
        val = bound(val, 0, 2 ether);
        bytes memory d = abi.encodeCall(MockWMON.deposit, ());
        vm.prank(agent);
        if (val > 0.2 ether) { vm.expectRevert(); v.executeCall("f", address(w), val, d, none); assertEq(v.totalSpent(), 0); }
        else { v.executeCall("f", address(w), val, d, none); assertEq(v.totalSpent(), val); assertEq(w.balanceOf(address(v)), val); }
    }
}

interface IWMON { function deposit() external payable; function withdraw(uint256) external; function balanceOf(address) external view returns (uint256); }
interface ISwapRouter02 {
    struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}
interface IKintsu { function deposit(uint96 minShares, address receiver) external payable returns (uint96); }

/// Fork tests against real Monad mainnet dapps. Run: forge test --fork-url https://rpc.monad.xyz --match-contract AgentVaultForkTest -vv
contract AgentVaultForkTest is Test {
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A; // docs.monad.xyz canonical
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603; // Circle docs
    address constant ROUTER = 0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900; // Uniswap docs: SwapRouter02 (Monad)
    address constant KINTSU = 0xA3227C5969757783154C60bF0bC1944180ed81B9; // Kintsu docs: StakedMonad vault / sMON
    AgentVaultFactory f; AgentVault v; address owner = address(0xA11CE); address agent = address(0xA6E7);
    bool on;

    function setUp() public {
        if (block.chainid != 143) return; // run with: forge test --fork-url https://rpc.monad.xyz --match-contract AgentVaultForkTest
        on = true;
        f = new AgentVaultFactory(1 ether, 5 ether);
        vm.deal(owner, 5 ether);
        vm.startPrank(owner);
        // one-transaction harness: limits + dapp rules + token caps + deposit
        CallRuleInit[] memory rules = new CallRuleInit[](4);
        rules[0] = CallRuleInit(WMON, IWMON.deposit.selector, 255);
        rules[1] = CallRuleInit(WMON, IWMON.withdraw.selector, 255);
        rules[2] = CallRuleInit(ROUTER, ISwapRouter02.exactInputSingle.selector, 3);
        rules[3] = CallRuleInit(KINTSU, IKintsu.deposit.selector, 1);
        TokenCapInit[] memory caps = new TokenCapInit[](1);
        caps[0] = TokenCapInit(USDC, 1_000_000); // 1 USDC (6 decimals)
        v = f.createVault{value: 1 ether}(agent, 0.3 ether, 1 ether, new address[](0), rules, caps);
        vm.stopPrank();
    }
    function _o(address at, uint256 aa, address out, uint256 m) internal pure returns (AgentVault.CallOpts memory) { return AgentVault.CallOpts(at, aa, out, m); }

    function test_fork_wmon_wrap_unwrap() public {
        if (!on) return;
        vm.prank(agent); v.executeCall("w1", WMON, 0.1 ether, abi.encodeCall(IWMON.deposit, ()), _o(address(0), 0, WMON, 0.1 ether));
        assertEq(IWMON(WMON).balanceOf(address(v)), 0.1 ether);
        vm.prank(agent); v.executeCall("w2", WMON, 0, abi.encodeCall(IWMON.withdraw, (0.1 ether)), _o(address(0), 0, address(0), 0.1 ether));
        assertEq(address(v).balance, 1 ether);
    }
    function test_fork_uniswap_mon_to_usdc_and_back() public {
        if (!on) return;
        ISwapRouter02.ExactInputSingleParams memory p = ISwapRouter02.ExactInputSingleParams(WMON, USDC, 3000, address(v), 0.2 ether, 1, 0);
        vm.prank(agent); v.executeCall("u1", ROUTER, 0.2 ether, abi.encodeCall(ISwapRouter02.exactInputSingle, (p)), _o(address(0), 0, USDC, 1));
        uint256 got = IERC20(USDC).balanceOf(address(v)); assertGt(got, 0); emit log_named_uint("USDC out (6dp) for 0.2 MON", got);
        ISwapRouter02.ExactInputSingleParams memory back = ISwapRouter02.ExactInputSingleParams(USDC, WMON, 3000, address(v), got, 1, 0);
        vm.prank(agent); v.executeCall("u2", ROUTER, 0, abi.encodeCall(ISwapRouter02.exactInputSingle, (back)), _o(USDC, got, WMON, 1));
        assertEq(IERC20(USDC).allowance(address(v), ROUTER), 0); assertGt(IWMON(WMON).balanceOf(address(v)), 0);
        emit log_named_uint("WMON back (wei)", IWMON(WMON).balanceOf(address(v)));
        // swap to a non-vault recipient is blocked
        p.recipient = agent;
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientMustBeVault.selector, agent));
        v.executeCall("u3", ROUTER, 0.1 ether, abi.encodeCall(ISwapRouter02.exactInputSingle, (p)), _o(address(0), 0, USDC, 1));
    }
    function test_fork_kintsu_stake() public {
        if (!on) return;
        vm.prank(agent); v.executeCall("k1", KINTSU, 0.1 ether, abi.encodeCall(IKintsu.deposit, (uint96(1), address(v))), _o(address(0), 0, KINTSU, 1));
        uint256 s = IERC20(KINTSU).balanceOf(address(v)); assertGt(s, 0); emit log_named_uint("sMON shares", s);
        vm.prank(owner); v.withdrawToken(KINTSU, owner, s); assertEq(IERC20(KINTSU).balanceOf(owner), s);
    }
    function test_fork_blocked_over_cap_and_unlisted() public {
        if (!on) return;
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.PerPaymentCapExceeded.selector, 0.5 ether, 0.3 ether));
        v.executeCall("c1", WMON, 0.5 ether, abi.encodeCall(IWMON.deposit, ()), _o(address(0), 0, address(0), 0));
        vm.prank(agent); vm.expectRevert(abi.encodeWithSelector(AgentVault.CallNotAllowed.selector, USDC, IERC20.transfer.selector));
        v.executeCall("c2", USDC, 0, abi.encodeCall(IERC20.transfer, (agent, 1)), _o(address(0), 0, address(0), 0));
    }
}
