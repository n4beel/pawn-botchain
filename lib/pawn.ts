// lib/pawn.ts - Reference implementation and helper functions for Pawn (Spec §2, §4)

export enum LoanState {
  Offered = 0,
  Active = 1,
  Repaid = 2,
  Seized = 3,
  Cancelled = 4,
}

export interface LoanData {
  id: bigint;
  lender: string;
  borrower: string;
  token: string;
  state: LoanState;
  offerEnds: bigint;
  termSecs: bigint;
  dueAt: bigint;
  principal: bigint;
  interest: bigint;
  collateral: bigint;
}

export interface TokenMeta {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Total BOT required to repay: principal + interest
 */
export function quoteRepay(principal: bigint, interest: bigint): bigint {
  return principal + interest;
}

/**
 * Checks if active loan is overdue (now > dueAt)
 */
export function isOverdue(loan: { state: LoanState; dueAt: bigint }, now: bigint): boolean {
  return loan.state === LoanState.Active && now > loan.dueAt;
}

/**
 * Formats a raw token amount with decimals into human-readable string.
 */
export function formatToken(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const divisor = 10n ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;

  if (fractionalPart === 0n) return integerPart.toString();

  let fracStr = fractionalPart.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, ""); // trim trailing zeros
  return `${integerPart}.${fracStr}`;
}

/**
 * Parses user input string into raw bigint token amount according to token decimals.
 * Rejects more decimals than the token has (Spec §4).
 */
export function tokenAmountFromInput(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "0") return 0n;

  const parts = trimmed.split(".");
  if (parts.length > 2) throw new Error("Invalid number format.");

  const intPart = parts[0] ? BigInt(parts[0]) : 0n;
  if (parts.length === 1) {
    return intPart * 10n ** BigInt(decimals);
  }

  const fracString = parts[1];
  if (fracString.length > decimals) {
    throw new Error(`Token only supports ${decimals} decimal places.`);
  }

  const paddedFrac = fracString.padEnd(decimals, "0");
  const fracPart = BigInt(paddedFrac);

  return intPart * 10n ** BigInt(decimals) + fracPart;
}

export type PawnStep = "approve" | "take" | "withdraw" | "ready";

/**
 * Evaluates the sequential 3-step pawn flow state (Spec §0, §3.1, §4):
 * 1. Approve (if allowance < collateral)
 * 2. Take (pawn your tokens)
 * 3. Withdraw (pull principal)
 */
export function nextPawnStep(
  allowance: bigint,
  userBalance: bigint,
  collateralRequired: bigint,
  borrowerPending: bigint
): { step: PawnStep; canAct: boolean; message: string } {
  if (userBalance < collateralRequired) {
    return {
      step: "approve",
      canAct: false,
      message: "Insufficient token collateral in your wallet.",
    };
  }
  if (allowance < collateralRequired) {
    return {
      step: "approve",
      canAct: true,
      message: "Step 1: Approve Pawn contract to hold token collateral.",
    };
  }
  if (borrowerPending > 0n) {
    return {
      step: "withdraw",
      canAct: true,
      message: "Step 3: Withdraw your borrowed BOT principal.",
    };
  }
  return {
    step: "take",
    canAct: true,
    message: "Step 2: Pawn your tokens and activate loan.",
  };
}

/**
 * Formats address into compact 0x1234…5678
 */
export function formatAddress(addr: string | undefined): string {
  if (!addr || addr.length < 10) return addr || "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
