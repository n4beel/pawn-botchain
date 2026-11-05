// lib/errors.ts - Formats contract and execution errors for Pawn

export function formatPawnError(error: unknown): string {
  if (!error) return "Unknown error occurred.";

  const str = String(error);

  if (str.includes("BadPrincipal")) {
    return "Principal is out of range. Must be between 0.01 and 100,000 BOT.";
  }
  if (str.includes("NotAToken")) {
    return "Target address has no contract code. Must be a valid ERC-20 token.";
  }
  if (str.includes("ZeroCollateral")) {
    return "Collateral amount must be greater than zero.";
  }
  if (str.includes("BadInterest")) {
    return "Interest cannot exceed the principal amount.";
  }
  if (str.includes("BadTimes")) {
    return "Invalid term or offer duration. Terms must be 1 to 180 days; offer 1 hour to 30 days.";
  }
  if (str.includes("NoSuchLoan")) {
    return "This loan ticket does not exist.";
  }
  if (str.includes("NotLender")) {
    return "Action restricted to the loan's lender.";
  }
  if (str.includes("NotBorrower")) {
    return "Action restricted to the loan's borrower.";
  }
  if (str.includes("NotOffered")) {
    return "This loan offer is no longer open.";
  }
  if (str.includes("NotActive")) {
    return "This loan is not active.";
  }
  if (str.includes("OfferEnded")) {
    return "This offer has ended.";
  }
  if (str.includes("SelfLoan")) {
    return "You cannot borrow against your own offer.";
  }
  if (str.includes("WrongPayment")) {
    return "Incorrect repayment amount. You must pay exact principal plus interest.";
  }
  if (str.includes("NotDue")) {
    return "The loan is not yet due. Lender can only seize collateral after the due date.";
  }
  if (str.includes("UnsupportedToken")) {
    return "This token takes a fee on transfer. Pawn can't hold it.";
  }
  if (str.includes("TokenTransferFailed")) {
    return "ERC-20 token transfer failed. Verify your token balance and allowance.";
  }
  if (str.includes("NothingToWithdraw")) {
    return "You have no pending balance to withdraw.";
  }
  if (str.includes("TransferFailed")) {
    return "BOT transfer failed.";
  }
  if (str.includes("User rejected") || str.includes("User denied")) {
    return "Transaction was cancelled in wallet.";
  }

  return "Transaction failed. Please verify loan parameters and try again.";
}
