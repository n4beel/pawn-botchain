"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { formatEther } from "viem";
import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import PawnTicket from "@/components/ticket/PawnTicket";
import { assertActiveChain, waitSuccess } from "@/lib/useChainWrite";
import { PAWN_ABI, ERC20_ABI } from "@/lib/botchain/abi";
import { activeBotChain } from "@/lib/botchain/chain";
import { getDeployment } from "@/lib/botchain/deployment";
import {
  LoanState,
  formatAddress,
  formatToken,
  quoteRepay,
  isOverdue,
  nextPawnStep,
} from "@/lib/pawn";
import { formatPawnError } from "@/lib/errors";

interface LoanDetail {
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

export default function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const loanId = BigInt(resolvedParams.id);

  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const deployment = getDeployment(activeBotChain.id);
  const contractAddress = deployment.address;
  const isDeployed = contractAddress !== "0x0000000000000000000000000000000000000000";

  const publicClient = usePublicClient({ chainId: activeBotChain.id });

  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string>("");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);
  const [tokenAllowance, setTokenAllowance] = useState<bigint>(0n);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [borrowerPending, setBorrowerPending] = useState<bigint>(0n);

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState<bigint>(
    BigInt(Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  async function refreshLoan() {
    if (!publicClient || !isDeployed) {
      setLoading(false);
      return;
    }

    try {
      const l = await publicClient.readContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "loanOf",
        args: [loanId],
      });

      setLoan({
        id: loanId,
        lender: l.lender,
        borrower: l.borrower,
        token: l.token,
        state: l.state as LoanState,
        offerEnds: l.offerEnds,
        termSecs: l.termSecs,
        dueAt: l.dueAt,
        principal: l.principal,
        interest: l.interest,
        collateral: l.collateral,
      });

      // Token metadata
      let sym = formatAddress(l.token);
      let dec = 18;
      try {
        const [s, d] = await Promise.all([
          publicClient.readContract({
            address: l.token,
            abi: ERC20_ABI,
            functionName: "symbol",
          }),
          publicClient.readContract({
            address: l.token,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        ]);
        sym = s;
        dec = d;
      } catch {
        // fallback symbol to address
      }
      setTokenSymbol(sym);
      setTokenDecimals(dec);

      // User specific token balance & allowance & pending
      if (address) {
        const [bal, allow, pend] = await Promise.all([
          publicClient.readContract({
            address: l.token,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.readContract({
            address: l.token,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, contractAddress],
          }),
          publicClient.readContract({
            address: contractAddress,
            abi: PAWN_ABI,
            functionName: "pending",
            args: [address],
          }),
        ]);
        setTokenBalance(bal);
        setTokenAllowance(allow);
        setBorrowerPending(pend);
      }

      setLoading(false);
    } catch (err) {
      console.error("Failed to read loan:", err);
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshLoan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAddress, address, loanId]);

  if (loading) {
    return (
      <PageShell title="Pawn Ticket" subtitle="Loading loan record…">
        <Panel>
          <div className="py-12 text-center text-sm font-mono text-[var(--text-muted)] animate-pulse">
            Retrieving ticket #{loanId.toString()} from BotChain…
          </div>
        </Panel>
      </PageShell>
    );
  }

  if (!loan || loan.lender === "0x0000000000000000000000000000000000000000") {
    return (
      <PageShell title="Ticket Not Found" subtitle="Pawn ticket not found">
        <Panel>
          <div className="py-12 text-center flex flex-col items-center gap-3">
            <p className="text-sm text-[var(--danger)]">
              Ticket #{loanId.toString()} does not exist.
            </p>
            <Link href="/">
              <Button look="ticket">← Back to Ticket Rail</Button>
            </Link>
          </div>
        </Panel>
      </PageShell>
    );
  }

  const isLender = address?.toLowerCase() === loan.lender.toLowerCase();
  const isBorrower = address?.toLowerCase() === loan.borrower.toLowerCase();
  const isExpired = loan.state === LoanState.Offered && nowSec > loan.offerEnds;
  const overdue = isOverdue(loan, nowSec);
  const totalRepay = quoteRepay(loan.principal, loan.interest);

  // Sequential 3-step pawn flow calculation (Spec §3.1, §4)
  const stepInfo = nextPawnStep(
    tokenAllowance,
    tokenBalance,
    loan.collateral,
    borrowerPending
  );

  async function handleApprove() {
    if (!walletClient || !publicClient) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: loan!.token as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [contractAddress, loan!.collateral],
      });
      await waitSuccess(publicClient, hash);
      await refreshLoan();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTake() {
    if (!walletClient || !publicClient) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "take",
        args: [loanId],
      });
      await waitSuccess(publicClient, hash);
      await refreshLoan();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleWithdraw() {
    if (!walletClient || !publicClient) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "withdraw",
      });
      await waitSuccess(publicClient, hash);
      await refreshLoan();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRepay() {
    if (!walletClient || !publicClient) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "repay",
        args: [loanId],
        value: totalRepay,
      });
      await waitSuccess(publicClient, hash);
      await refreshLoan();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSeize() {
    if (!walletClient || !publicClient) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "seize",
        args: [loanId],
      });
      await waitSuccess(publicClient, hash);
      await refreshLoan();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!walletClient || !publicClient) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "cancel",
        args: [loanId],
      });
      await waitSuccess(publicClient, hash);
      await refreshLoan();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PageShell
      title={`Pawn Slip #${loanId.toString()}`}
      subtitle={`Borrow ${formatEther(loan.principal)} BOT against ${formatToken(loan.collateral, tokenDecimals)} ${tokenSymbol}`}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-mono text-[var(--accent)] hover:underline flex items-center gap-1"
          >
            ← Back to Ticket Rail
          </Link>
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Counter Ticket #{loanId.toString()}
          </span>
        </div>

        {/* The Pawn Ticket Stub */}
        <PawnTicket
          id={loan.id}
          lender={loan.lender}
          borrower={loan.borrower}
          tokenAddress={loan.token}
          tokenSymbol={tokenSymbol}
          tokenDecimals={tokenDecimals}
          collateral={loan.collateral}
          principal={loan.principal}
          interest={loan.interest}
          termSecs={loan.termSecs}
          dueAt={loan.dueAt}
          offerEnds={loan.offerEnds}
          state={loan.state}
          nowSec={nowSec}
          isLender={isLender}
          isBorrower={isBorrower}
        />

        {/* BotChain Interactive Action Bar */}
        <BotChainGate>
          <div className="flex flex-col gap-4">
            {/* 1. Offered State — Accept Slip (3-Step Strip in One Form, Spec §3.1) */}
            {loan.state === LoanState.Offered && !isLender && !isExpired && (
              <Panel ticketHeader="Pawn Slip Acceptance Counter">
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    To claim the <strong>{formatEther(loan.principal)} BOT</strong> principal, deposit{" "}
                    <strong>{formatToken(loan.collateral, tokenDecimals)} {tokenSymbol}</strong> as collateral.
                    This accept flow runs in 3 sequential steps in this one form:
                  </p>

                  {/* 3-Step Strip Visualizer */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-2 border-dashed border-[var(--border-default)] p-3 bg-[var(--bg-base)]">
                    <div
                      className={`p-2 border ${
                        tokenAllowance >= loan.collateral
                          ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
                          : stepInfo.step === "approve"
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-bold"
                          : "border-[var(--border-subtle)] text-[var(--text-muted)]"
                      }`}
                    >
                      <div className="text-[10px] uppercase font-mono tracking-wider">Step 1</div>
                      <div className="text-xs font-heading">
                        {tokenAllowance >= loan.collateral ? "✓ Approved" : "Approve Token"}
                      </div>
                    </div>

                    <div
                      className={`p-2 border ${
                        tokenAllowance < loan.collateral
                          ? "border-[var(--border-subtle)] text-[var(--text-muted)]"
                          : borrowerPending > 0n
                          ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
                          : "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-bold"
                      }`}
                    >
                      <div className="text-[10px] uppercase font-mono tracking-wider">Step 2</div>
                      <div className="text-xs font-heading">
                        {borrowerPending > 0n ? "✓ Pawned" : "Pawn Collateral"}
                      </div>
                    </div>

                    <div
                      className={`p-2 border ${
                        borrowerPending > 0n
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-bold animate-pulse"
                          : "border-[var(--border-subtle)] text-[var(--text-muted)]"
                      }`}
                    >
                      <div className="text-[10px] uppercase font-mono tracking-wider">Step 3</div>
                      <div className="text-xs font-heading">Withdraw BOT</div>
                    </div>
                  </div>

                  {/* Wallet Collateral Status */}
                  <div className="flex items-center justify-between text-xs font-mono p-2 bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                    <span className="text-[var(--text-muted)]">Your {tokenSymbol} Balance:</span>
                    <span className={tokenBalance < loan.collateral ? "text-[var(--danger)] font-bold" : "text-[var(--text-primary)]"}>
                      {formatToken(tokenBalance, tokenDecimals)} {tokenSymbol} (Need {formatToken(loan.collateral, tokenDecimals)})
                    </span>
                  </div>

                  {/* Primary Action Button (Approve until allowance exists, then Pawn, then Withdraw) */}
                  <div>
                    {stepInfo.step === "approve" && (
                      <Button
                        look="ticket"
                        onClick={handleApprove}
                        disabled={!stepInfo.canAct || isSubmitting}
                        className="w-full py-3"
                      >
                        {isSubmitting
                          ? "Confirming Approval…"
                          : !stepInfo.canAct
                          ? "Insufficient Collateral Balance"
                          : `Approve ${formatToken(loan.collateral, tokenDecimals)} ${tokenSymbol}`}
                      </Button>
                    )}

                    {stepInfo.step === "take" && (
                      <Button
                        look="ticket"
                        onClick={handleTake}
                        disabled={isSubmitting}
                        className="w-full py-3"
                      >
                        {isSubmitting
                          ? "Confirming Loan Activation…"
                          : `Deposit Collateral & Take ${formatEther(loan.principal)} BOT`}
                      </Button>
                    )}

                    {stepInfo.step === "withdraw" && (
                      <Button
                        look="ticket"
                        onClick={handleWithdraw}
                        disabled={isSubmitting}
                        className="w-full py-3"
                      >
                        {isSubmitting
                          ? "Confirming BOT Payout…"
                          : `Withdraw ${formatEther(borrowerPending)} BOT to Wallet`}
                      </Button>
                    )}
                  </div>
                </div>
              </Panel>
            )}

            {/* 2. Offered State — Lender Cancel Early or Expiry Cancel */}
            {loan.state === LoanState.Offered && (isLender || isExpired) && (
              <Panel ticketHeader={isLender ? "Cancel Lending Offer" : "Offer Expired"}>
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-[var(--text-muted)]">
                    {isLender
                      ? "As the lender, you may cancel this offer and immediately reclaim your escrowed principal."
                      : "This offer window has expired. Anyone may cancel it to credit the principal back to the lender's pending balance."}
                  </p>
                  <Button
                    look="ticket"
                    onClick={handleCancel}
                    disabled={isSubmitting}
                    className="w-full py-3"
                  >
                    {isSubmitting
                      ? "Confirming Cancellation…"
                      : isLender
                      ? `Cancel Offer & Refund ${formatEther(loan.principal)} BOT`
                      : `Cancel Expired Offer`}
                  </Button>
                </div>
              </Panel>
            )}

            {/* 3. Active State — Borrower Repay */}
            {loan.state === LoanState.Active && isBorrower && (
              <Panel ticketHeader="Redeem Collateral (Repay Loan)">
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-[var(--text-muted)]">
                    Repay the principal plus interest ({formatEther(totalRepay)} BOT) to redeem your{" "}
                    {formatToken(loan.collateral, tokenDecimals)} {tokenSymbol} collateral.
                    {overdue && (
                      <span className="text-[var(--warning)] block mt-1 font-bold">
                        Notice: The loan term is overdue! You can still repay until the lender seizes.
                      </span>
                    )}
                  </p>
                  <Button
                    look="ticket"
                    onClick={handleRepay}
                    disabled={isSubmitting}
                    className="w-full py-3"
                  >
                    {isSubmitting
                      ? "Confirming Repayment…"
                      : `Repay ${formatEther(totalRepay)} BOT & Reclaim Collateral`}
                  </Button>
                </div>
              </Panel>
            )}

            {/* 4. Active State — Lender Seize Overdue */}
            {loan.state === LoanState.Active && isLender && (
              <Panel ticketHeader={overdue ? "Seize Defaulted Collateral" : "Loan Active (Awaiting Repayment)"}>
                <div className="flex flex-col gap-3">
                  {overdue ? (
                    <>
                      <p className="text-xs text-[var(--danger)]">
                        The borrower failed to repay before the due date. As the lender, you are entitled to seize
                        the {formatToken(loan.collateral, tokenDecimals)} {tokenSymbol} collateral in full.
                      </p>
                      <Button
                        look="ticket"
                        onClick={handleSeize}
                        disabled={isSubmitting}
                        className="w-full py-3"
                      >
                        {isSubmitting
                          ? "Confirming Seizure…"
                          : `Seize ${formatToken(loan.collateral, tokenDecimals)} ${tokenSymbol} Collateral`}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">
                      The borrower has until {new Date(Number(loan.dueAt) * 1000).toLocaleString()} to repay{" "}
                      {formatEther(totalRepay)} BOT. If they default, you may seize the collateral after the due date.
                    </p>
                  )}
                </div>
              </Panel>
            )}

            {/* Transaction Feedback */}
            {actionError && (
              <div className="p-3 bg-[var(--danger)]/10 border border-[var(--danger)] text-[var(--danger)] text-xs font-mono">
                {actionError}
              </div>
            )}
          </div>
        </BotChainGate>
      </div>
    </PageShell>
  );
}
