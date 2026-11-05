import { describe, it, expect } from "vitest";
import {
  quoteRepay,
  isOverdue,
  formatToken,
  tokenAmountFromInput,
  nextPawnStep,
  LoanState,
} from "../pawn";

describe("Pawn library utilities & math (Spec §2, §4, §8.2)", () => {
  it("computes quoteRepay accurately", () => {
    expect(quoteRepay(100n, 10n)).toBe(110n);
    expect(quoteRepay(5000000000000000000n, 500000000000000000n)).toBe(5500000000000000000n);
  });

  it("checks isOverdue accurately", () => {
    const loan = { state: LoanState.Active, dueAt: 1000n };
    expect(isOverdue(loan, 999n)).toBe(false);
    expect(isOverdue(loan, 1000n)).toBe(false);
    expect(isOverdue(loan, 1001n)).toBe(true);

    const offeredLoan = { state: LoanState.Offered, dueAt: 1000n };
    expect(isOverdue(offeredLoan, 1001n)).toBe(false);
  });

  it("formats tokens with various decimals", () => {
    // 18 decimals
    expect(formatToken(1000000000000000000n, 18)).toBe("1");
    expect(formatToken(1500000000000000000n, 18)).toBe("1.5");
    expect(formatToken(1234567890000000000n, 18)).toBe("1.23456789");

    // 6 decimals (like USDC)
    expect(formatToken(1000000n, 6)).toBe("1");
    expect(formatToken(1500000n, 6)).toBe("1.5");
    expect(formatToken(250000n, 6)).toBe("0.25");

    // 0 decimals
    expect(formatToken(42n, 0)).toBe("42");
  });

  it("parses user token amount inputs and validates decimal precision", () => {
    // 18 decimals
    expect(tokenAmountFromInput("1", 18)).toBe(1000000000000000000n);
    expect(tokenAmountFromInput("1.5", 18)).toBe(1500000000000000000n);
    expect(tokenAmountFromInput("0.0001", 18)).toBe(100000000000000n);

    // 6 decimals
    expect(tokenAmountFromInput("10.5", 6)).toBe(10500000n);
    expect(tokenAmountFromInput("0.123456", 6)).toBe(123456n);

    // Rejecting excess decimals
    expect(() => tokenAmountFromInput("1.1234567", 6)).toThrow(
      "Token only supports 6 decimal places."
    );
  });

  it("determines sequential 3-step pawn progress correctly", () => {
    const collateral = 1000n;

    // 1. User has insufficient balance
    const s1 = nextPawnStep(0n, 500n, collateral, 0n);
    expect(s1.step).toBe("approve");
    expect(s1.canAct).toBe(false);

    // 2. User has balance, but needs approval
    const s2 = nextPawnStep(0n, 1500n, collateral, 0n);
    expect(s2.step).toBe("approve");
    expect(s2.canAct).toBe(true);

    // 3. User has approved, ready to take loan
    const s3 = nextPawnStep(1000n, 1500n, collateral, 0n);
    expect(s3.step).toBe("take");
    expect(s3.canAct).toBe(true);

    // 4. Loan taken, borrower has pending balance to withdraw
    const s4 = nextPawnStep(1000n, 1500n, collateral, 500n);
    expect(s4.step).toBe("withdraw");
    expect(s4.canAct).toBe(true);
  });
});
