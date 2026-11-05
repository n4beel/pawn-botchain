// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Test.sol";
import "../src/Pawn.sol";
import "./Pawn.t.sol";

contract PawnHandler is Test {
  Pawn public pawn;
  MockToken public token;

  address public lender = address(0xAA1);
  address public borrower = address(0xAA2);

  uint256 public activeLoanId;
  uint128 public principal;
  uint128 public interest;

  constructor(Pawn _pawn, MockToken _token) {
    pawn = _pawn;
    token = _token;

    vm.deal(lender, 10_000 ether);
    vm.deal(borrower, 10_000 ether);
    token.mint(borrower, 1_000_000 * 1e18);
  }

  function offerLoan(uint128 pr, uint128 intr, uint64 term, uint64 offerS) public {
    if (activeLoanId != 0) return;

    principal = uint128(bound(pr, 0.01 ether, 50 ether));
    interest = uint128(bound(intr, 0, principal));
    uint64 termSecs = uint64(bound(term, 1 days, 30 days));
    uint64 offerSecs = uint64(bound(offerS, 1 hours, 7 days));

    vm.prank(lender);
    activeLoanId = pawn.offer{value: principal}(
      address(token),
      1000 * 1e18,
      interest,
      termSecs,
      offerSecs
    );
  }

  function takeLoan() public {
    if (activeLoanId == 0) return;
    Pawn.Loan memory loan = pawn.loanOf(activeLoanId);
    if (loan.state != Pawn.State.Offered) return;
    if (block.timestamp > loan.offerEnds) return;

    vm.prank(borrower);
    token.approve(address(pawn), loan.collateral);

    vm.prank(borrower);
    try pawn.take(activeLoanId) {} catch {}
  }

  function repayLoan() public {
    if (activeLoanId == 0) return;
    Pawn.Loan memory loan = pawn.loanOf(activeLoanId);
    if (loan.state != Pawn.State.Active) return;

    vm.prank(borrower);
    try pawn.repay{value: uint256(loan.principal) + uint256(loan.interest)}(activeLoanId) {} catch {}
  }

  function seizeLoan() public {
    if (activeLoanId == 0) return;
    Pawn.Loan memory loan = pawn.loanOf(activeLoanId);
    if (loan.state != Pawn.State.Active) return;
    if (block.timestamp <= loan.dueAt) return;

    vm.prank(lender);
    try pawn.seize(activeLoanId) {} catch {}
  }

  function cancelLoan() public {
    if (activeLoanId == 0) return;
    Pawn.Loan memory loan = pawn.loanOf(activeLoanId);
    if (loan.state != Pawn.State.Offered) return;

    vm.prank(lender);
    try pawn.cancel(activeLoanId) {} catch {}
  }

  function advanceTime(uint32 secs) public {
    vm.warp(block.timestamp + bound(secs, 1 hours, 40 days));
  }

  function withdrawPending(bool asLender) public {
    address who = asLender ? lender : borrower;
    vm.prank(who);
    try pawn.withdraw() {} catch {}
  }
}

contract PawnInvariantTest is Test {
  Pawn public pawn;
  MockToken public token;
  PawnHandler public handler;

  function setUp() public {
    pawn = new Pawn();
    token = new MockToken();
    handler = new PawnHandler(pawn, token);
    targetContract(address(handler));
  }

  function invariant_BalancesCoverLoans() public view {
    // BOT Balance invariant
    uint256 expectedBOT = pawn.pending(handler.lender()) + pawn.pending(handler.borrower());
    uint256 id = handler.activeLoanId();
    if (id != 0) {
      Pawn.Loan memory l = pawn.loanOf(id);
      if (l.state == Pawn.State.Offered) {
        expectedBOT += l.principal;
      }
    }
    assertEq(address(pawn).balance, expectedBOT);

    // Token Balance invariant
    if (id != 0) {
      Pawn.Loan memory l = pawn.loanOf(id);
      if (l.state == Pawn.State.Active) {
        assertGe(token.balanceOf(address(pawn)), l.collateral);
      } else {
        assertEq(token.balanceOf(address(pawn)), 0);
      }
    }
  }
}
