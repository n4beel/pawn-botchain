// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Test.sol";
import "../src/Pawn.sol";

// --- Mock Tokens for Spec §2.3 ---

contract MockToken {
  string public name = "Mock Collateral";
  string public symbol = "MOCK";
  uint8 public decimals = 18;

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
    require(balanceOf[msg.sender] >= amount, "ERC20: balance");
    balanceOf[msg.sender] -= amount;
    balanceOf[to] += amount;
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: allowance");
    require(balanceOf[from] >= amount, "ERC20: balance");

    allowance[from][msg.sender] = currentAllowance - amount;
    balanceOf[from] -= amount;
    balanceOf[to] += amount;
    return true;
  }
}

contract FeeOnTransferMockToken is MockToken {
  function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: allowance");
    require(balanceOf[from] >= amount, "ERC20: balance");

    allowance[from][msg.sender] = currentAllowance - amount;
    balanceOf[from] -= amount;

    // Takes a 10% fee
    uint256 fee = amount / 10;
    uint256 net = amount - fee;
    balanceOf[to] += net;
    return true;
  }
}

contract FalseReturningMockToken is MockToken {
  function transferFrom(address, address, uint256) external override returns (bool) {
    return false;
  }
}

contract RevertingMockToken is MockToken {
  function transferFrom(address, address, uint256) external override returns (bool) {
    revert("MOCK_REVERT");
  }
}

contract ReentrantToken is MockToken {
  Pawn public target;
  uint256 public attackLoanId;

  function setAttack(Pawn _target, uint256 _id) external {
    target = _target;
    attackLoanId = _id;
  }

  function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: allowance");
    require(balanceOf[from] >= amount, "ERC20: balance");

    allowance[from][msg.sender] = currentAllowance - amount;
    balanceOf[from] -= amount;
    balanceOf[to] += amount;

    if (address(target) != address(0)) {
      // Reentrant attack: attempt to cancel while taking
      target.cancel(attackLoanId);
    }
    return true;
  }
}

contract PawnTest is Test {
  Pawn public pawn;
  MockToken public token;

  address public lender = address(0x101);
  address public borrower = address(0x102);
  address public outsider = address(0x999);

  uint128 public constant PRINCIPAL = 5 ether;
  uint128 public constant INTEREST = 0.5 ether;
  uint256 public constant COLLATERAL = 10_000 * 1e18;
  uint64 public constant TERM = 30 days;
  uint64 public constant OFFER_SECS = 7 days;

  function setUp() public {
    pawn = new Pawn();
    token = new MockToken();

    vm.deal(lender, 100 ether);
    vm.deal(borrower, 100 ether);
    vm.deal(outsider, 100 ether);

    token.mint(borrower, 1_000_000 * 1e18);
  }

  function test_OfferEscrowsPrincipal() public {
    vm.prank(lender);
    uint256 id = pawn.offer{value: PRINCIPAL}(
      address(token),
      COLLATERAL,
      INTEREST,
      TERM,
      OFFER_SECS
    );

    assertEq(id, 1);
    assertEq(pawn.loanCount(), 1);
    assertEq(address(pawn).balance, PRINCIPAL);

    Pawn.Loan memory loan = pawn.loanOf(1);
    assertEq(loan.lender, lender);
    assertEq(loan.principal, PRINCIPAL);
    assertEq(loan.interest, INTEREST);
    assertEq(loan.collateral, COLLATERAL);
    assertEq(uint256(loan.state), uint256(Pawn.State.Offered));
  }

  function test_TakePullsCollateralAndCreditsPrincipal() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);

    vm.prank(borrower);
    pawn.take(1);

    Pawn.Loan memory loan = pawn.loanOf(1);
    assertEq(uint256(loan.state), uint256(Pawn.State.Active));
    assertEq(loan.borrower, borrower);
    assertEq(loan.dueAt, block.timestamp + TERM);

    assertEq(token.balanceOf(address(pawn)), COLLATERAL);
    assertEq(pawn.pending(borrower), PRINCIPAL);
  }

  function test_TakeWithoutApprovalReverts() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    vm.expectRevert();
    pawn.take(1);
  }

  function test_FeeOnTransferTokenRejected_UnsupportedToken() public {
    FeeOnTransferMockToken feeToken = new FeeOnTransferMockToken();
    feeToken.mint(borrower, COLLATERAL * 2);

    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(feeToken), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    feeToken.approve(address(pawn), COLLATERAL);

    vm.prank(borrower);
    vm.expectRevert(Pawn.UnsupportedToken.selector);
    pawn.take(1);
  }

  function test_FalseReturningTokenReverts() public {
    FalseReturningMockToken falseToken = new FalseReturningMockToken();

    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(falseToken), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    vm.expectRevert(Pawn.TokenTransferFailed.selector);
    pawn.take(1);
  }

  function test_SelfLoanReverts() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    token.mint(lender, COLLATERAL);
    vm.prank(lender);
    token.approve(address(pawn), COLLATERAL);

    vm.prank(lender);
    vm.expectRevert(Pawn.SelfLoan.selector);
    pawn.take(1);
  }

  function test_OfferEndedReverts() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.warp(block.timestamp + OFFER_SECS + 1);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);

    vm.prank(borrower);
    vm.expectRevert(Pawn.OfferEnded.selector);
    pawn.take(1);
  }

  function test_RepayReturnsCollateralAndPaysLender() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    uint256 bBalBefore = token.balanceOf(borrower);

    vm.prank(borrower);
    pawn.repay{value: PRINCIPAL + INTEREST}(1);

    Pawn.Loan memory loan = pawn.loanOf(1);
    assertEq(uint256(loan.state), uint256(Pawn.State.Repaid));
    assertEq(pawn.pending(lender), PRINCIPAL + INTEREST);
    assertEq(token.balanceOf(borrower), bBalBefore + COLLATERAL);
    assertEq(token.balanceOf(address(pawn)), 0);
  }

  function test_RepayWrongAmountReverts_ArgsExpected() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    uint256 expected = uint256(PRINCIPAL) + uint256(INTEREST);
    vm.prank(borrower);
    vm.expectRevert(abi.encodeWithSelector(Pawn.WrongPayment.selector, expected));
    pawn.repay{value: PRINCIPAL}(1);
  }

  function test_LateRepayStillWorksUntilSeized() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    // Fast-forward past dueAt
    vm.warp(block.timestamp + TERM + 10 days);

    // Borrower repays late before seizure
    vm.prank(borrower);
    pawn.repay{value: PRINCIPAL + INTEREST}(1);

    Pawn.Loan memory loan = pawn.loanOf(1);
    assertEq(uint256(loan.state), uint256(Pawn.State.Repaid));
  }

  function test_SeizeBeforeDueReverts_ArgsDueAt() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    Pawn.Loan memory loan = pawn.loanOf(1);
    vm.prank(lender);
    vm.expectRevert(abi.encodeWithSelector(Pawn.NotDue.selector, loan.dueAt));
    pawn.seize(1);
  }

  function test_SeizeGivesCollateralToLender() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    vm.warp(block.timestamp + TERM + 1);

    vm.prank(lender);
    pawn.seize(1);

    Pawn.Loan memory loan = pawn.loanOf(1);
    assertEq(uint256(loan.state), uint256(Pawn.State.Seized));
    assertEq(token.balanceOf(lender), COLLATERAL);
    assertEq(token.balanceOf(address(pawn)), 0);
  }

  function test_RepayAfterSeizeReverts() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    vm.warp(block.timestamp + TERM + 1);
    vm.prank(lender);
    pawn.seize(1);

    vm.prank(borrower);
    vm.expectRevert(Pawn.NotActive.selector);
    pawn.repay{value: PRINCIPAL + INTEREST}(1);
  }

  function test_CancelByLenderRefundsPrincipal() public {
    uint256 lenderBalBefore = lender.balance;

    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.prank(lender);
    pawn.cancel(1);

    assertEq(lender.balance, lenderBalBefore);
    Pawn.Loan memory loan = pawn.loanOf(1);
    assertEq(uint256(loan.state), uint256(Pawn.State.Cancelled));
  }

  function test_ExpiredOfferCancelCreditsPending() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    vm.warp(block.timestamp + OFFER_SECS + 1);

    // Outsider cancels expired offer
    vm.prank(outsider);
    pawn.cancel(1);

    assertEq(pawn.pending(lender), PRINCIPAL);
  }

  function test_OnlyLenderCanSeizeOrCancelEarly() public {
    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    // Outsider cannot cancel early
    vm.prank(outsider);
    vm.expectRevert(Pawn.NotLender.selector);
    pawn.cancel(1);

    // Borrower takes loan
    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(1);

    vm.warp(block.timestamp + TERM + 1);

    // Outsider cannot seize
    vm.prank(outsider);
    vm.expectRevert(Pawn.NotLender.selector);
    pawn.seize(1);
  }

  function test_BadParamsRevert() public {
    // Bad principal
    vm.expectRevert(abi.encodeWithSelector(Pawn.BadPrincipal.selector, pawn.MIN_PRINCIPAL(), pawn.MAX_PRINCIPAL()));
    pawn.offer{value: 0.001 ether}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    // Zero collateral
    vm.expectRevert(Pawn.ZeroCollateral.selector);
    pawn.offer{value: PRINCIPAL}(address(token), 0, INTEREST, TERM, OFFER_SECS);

    // Bad interest (> principal)
    vm.expectRevert(Pawn.BadInterest.selector);
    pawn.offer{value: PRINCIPAL}(address(token), COLLATERAL, PRINCIPAL + 1, TERM, OFFER_SECS);
  }

  function test_NonTokenRejected() public {
    vm.expectRevert(Pawn.NotAToken.selector);
    pawn.offer{value: PRINCIPAL}(address(0x123), COLLATERAL, INTEREST, TERM, OFFER_SECS);
  }

  function test_ReentrantRepayBlocked() public {
    ReentrantToken rToken = new ReentrantToken();
    rToken.mint(borrower, COLLATERAL);

    vm.prank(lender);
    pawn.offer{value: PRINCIPAL}(address(rToken), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    rToken.setAttack(pawn, 1);

    vm.prank(borrower);
    rToken.approve(address(pawn), COLLATERAL);

    // Reentrant call to cancel will fail with REENTRANCY
    vm.prank(borrower);
    vm.expectRevert();
    pawn.take(1);
  }

  function testFuzz_LoanLifecycleConserves(uint128 pr, uint128 intr, bool doRepay) public {
    pr = uint128(bound(pr, 0.01 ether, 1000 ether));
    intr = uint128(bound(intr, 0, pr));

    vm.deal(lender, uint256(pr) * 2);
    vm.deal(borrower, uint256(pr) * 2 + uint256(intr));

    vm.prank(lender);
    uint256 id = pawn.offer{value: pr}(address(token), COLLATERAL, intr, TERM, OFFER_SECS);

    vm.prank(borrower);
    token.approve(address(pawn), COLLATERAL);
    vm.prank(borrower);
    pawn.take(id);

    if (doRepay) {
      vm.prank(borrower);
      pawn.repay{value: uint256(pr) + uint256(intr)}(id);
      assertEq(pawn.pending(lender), uint256(pr) + uint256(intr));
      assertEq(token.balanceOf(address(pawn)), 0);
    } else {
      vm.warp(block.timestamp + TERM + 1);
      vm.prank(lender);
      pawn.seize(id);
      assertEq(token.balanceOf(address(pawn)), 0);
    }
  }

  function test_SpecificMutantKillers() public {
    assertEq(pawn.MIN_PRINCIPAL(), 0.01 ether);
    assertEq(pawn.MAX_PRINCIPAL(), 100_000 ether);
    assertEq(pawn.MIN_TERM(), 1 days);
    assertEq(pawn.MAX_TERM(), 180 days);
    assertEq(pawn.MIN_OFFER(), 1 hours);
    assertEq(pawn.MAX_OFFER(), 30 days);
    assertEq(pawn.MAX_PAGE(), 50);

    // Test exact MAX_PRINCIPAL
    vm.deal(lender, 200_000 ether);
    vm.prank(lender);
    pawn.offer{value: 100_000 ether}(address(token), COLLATERAL, INTEREST, TERM, OFFER_SECS);

    // quoteRepay view
    assertEq(pawn.quoteRepay(1), 100_000 ether + INTEREST);

    // latest view pagination
    (uint256[] memory ids, ) = pawn.latest(0, 10);
    assertEq(ids.length, 1);
  }
}
