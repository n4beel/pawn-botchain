"use client";

import { formatEther } from "viem";
import { formatAddress, formatToken, LoanState } from "@/lib/pawn";

interface PawnTicketProps {
  id: bigint;
  lender: string;
  borrower: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  collateral: bigint;
  principal: bigint;
  interest: bigint;
  termSecs: bigint;
  dueAt: bigint;
  offerEnds: bigint;
  state: LoanState;
  nowSec: bigint;
  isLender?: boolean;
  isBorrower?: boolean;
}

export default function PawnTicket({
  id,
  lender,
  borrower,
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  collateral,
  principal,
  interest,
  termSecs,
  dueAt,
  offerEnds,
  state,
  nowSec,
  isLender,
  isBorrower,
}: PawnTicketProps) {
  const isOverdue = state === LoanState.Active && nowSec > dueAt;
  const isOfferExpired = state === LoanState.Offered && nowSec > offerEnds;

  const totalRepay = principal + interest;
  const termDays = Number(termSecs / 86400n);

  const stateStamps: Record<number, { text: string; color: string }> = {
    [LoanState.Offered]: isOfferExpired
      ? { text: "OFFER EXPIRED", color: "text-[var(--danger)] border-[var(--danger)]" }
      : { text: "OFFER OPEN", color: "text-[var(--warning)] border-[var(--warning)]" },
    [LoanState.Active]: isOverdue
      ? { text: "OVERDUE — SEIZABLE", color: "text-[var(--danger)] border-[var(--danger)] animate-pulse" }
      : { text: "ACTIVE PAWN", color: "text-[var(--accent)] border-[var(--accent)]" },
    [LoanState.Repaid]: { text: "REDEEMED & REPAID", color: "text-[var(--success)] border-[var(--success)]" },
    [LoanState.Seized]: { text: "COLLATERAL SEIZED", color: "text-[var(--danger)] border-[var(--danger)]" },
    [LoanState.Cancelled]: { text: "CANCELLED", color: "text-[var(--text-muted)] border-[var(--border-default)]" },
  };

  const stamp = stateStamps[state] || stateStamps[LoanState.Offered];

  return (
    <div className="border-4 border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xl relative overflow-hidden">
      {/* Stamp watermark */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] pointer-events-none z-10 select-none opacity-20">
        <span
          className={`font-heading text-4xl sm:text-6xl font-black uppercase tracking-widest border-8 px-6 py-2 ${stamp.color}`}
        >
          {stamp.text}
        </span>
      </div>

      {/* Ticket Header & Number */}
      <div className="p-4 bg-[var(--bg-overlay)] border-b-2 border-dashed border-[var(--border-default)] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🏷️</span>
          <div>
            <span className="font-heading font-black text-xl text-[var(--accent)] tracking-tight">
              PAWN TICKET #{id.toString()}
            </span>
            <span className="block text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              Token Collateral Pawn Record
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`font-heading text-xs font-black uppercase tracking-wider px-3 py-1 border-2 ${stamp.color}`}
          >
            {stamp.text}
          </span>
        </div>
      </div>

      {/* Perforated Two Halves: Lender's Copy & Borrower's Copy (Spec §3.1) */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y-2 md:divide-y-0 md:divide-x-2 divide-dashed divide-[var(--border-default)]">
        {/* Left: Lender's Copy */}
        <div className="p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 mb-3">
              <span className="font-heading text-xs font-bold text-[var(--accent)] uppercase tracking-wider">
                Section A: Lender's Copy
              </span>
              {isLender && (
                <span className="text-[10px] font-mono uppercase bg-[var(--accent)] text-[var(--accent-ink)] font-bold px-1.5 py-0.5">
                  Your Offer
                </span>
              )}
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Lender:</span>
                <span className="font-bold text-[var(--text-primary)]">{formatAddress(lender)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Principal Escrowed:</span>
                <span className="font-bold text-[var(--accent)] text-sm">{formatEther(principal)} BOT</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Interest Fee:</span>
                <span className="font-bold text-[var(--text-primary)]">{formatEther(interest)} BOT</span>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-1">
                <span className="text-[var(--text-muted)]">Total Due on Return:</span>
                <span className="font-bold text-[var(--text-primary)]">{formatEther(totalRepay)} BOT</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-muted)]">
            Lender holds rights to seize the collateral if repayment is not made before the loan expires.
          </div>
        </div>

        {/* Right: Borrower's Copy */}
        <div className="p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 mb-3">
              <span className="font-heading text-xs font-bold text-[var(--accent)] uppercase tracking-wider">
                Section B: Borrower's Copy
              </span>
              {isBorrower && (
                <span className="text-[10px] font-mono uppercase bg-[var(--accent)] text-[var(--accent-ink)] font-bold px-1.5 py-0.5">
                  Your Loan
                </span>
              )}
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Borrower:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {borrower !== "0x0000000000000000000000000000000000000000"
                    ? formatAddress(borrower)
                    : "Awaiting borrower"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Collateral Required:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {formatToken(collateral, tokenDecimals)} {tokenSymbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Token Contract:</span>
                <span className="text-[11px] text-[var(--text-tertiary)]">{formatAddress(tokenAddress)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-1">
                <span className="text-[var(--text-muted)]">Term Duration:</span>
                <span className="font-bold text-[var(--text-primary)]">{termDays} Days</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-muted)]">
            {state === LoanState.Active ? (
              <span>
                Due by:{" "}
                <strong className="text-[var(--accent)]">
                  {new Date(Number(dueAt) * 1000).toLocaleString()}
                </strong>
              </span>
            ) : state === LoanState.Offered ? (
              <span>
                Offer valid until:{" "}
                {new Date(Number(offerEnds) * 1000).toLocaleString()}
              </span>
            ) : (
              <span>Loan completed.</span>
            )}
          </div>
        </div>
      </div>

      {/* Ticket Footer Line required by Spec §3.4 */}
      <div className="p-3.5 bg-[var(--bg-overlay)] border-t-2 border-dashed border-[var(--border-default)] font-mono text-xs text-center text-[var(--text-muted)]">
        Leave <strong>{formatToken(collateral, tokenDecimals)} {tokenSymbol}</strong>. Receive <strong>{formatEther(principal)} BOT</strong>. Repay <strong>{formatEther(totalRepay)} BOT</strong> by {dueAt > 0n ? new Date(Number(dueAt) * 1000).toLocaleDateString() : `${termDays} days after taking`}.
      </div>
    </div>
  );
}
