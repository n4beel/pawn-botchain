"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { formatEther } from "viem";
import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { assertActiveChain, waitSuccess } from "@/lib/useChainWrite";
import { PAWN_ABI, ERC20_ABI } from "@/lib/botchain/abi";
import { activeBotChain } from "@/lib/botchain/chain";
import { getDeployment } from "@/lib/botchain/deployment";
import { LoanState, formatAddress, formatToken } from "@/lib/pawn";
import { formatPawnError } from "@/lib/errors";

interface UserLoan {
  id: bigint;
  role: "lender" | "borrower";
  token: string;
  symbol: string;
  decimals: number;
  principal: bigint;
  interest: bigint;
  collateral: bigint;
  state: LoanState;
  dueAt: bigint;
  offerEnds: bigint;
}

export default function MePage() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const deployment = getDeployment(activeBotChain.id);
  const contractAddress = deployment.address;
  const isDeployed = contractAddress !== "0x0000000000000000000000000000000000000000";

  const publicClient = usePublicClient({ chainId: activeBotChain.id });

  const [pendingBalance, setPendingBalance] = useState<bigint>(0n);
  const [loans, setLoans] = useState<UserLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadUserData() {
    if (!publicClient || !isDeployed || !address) {
      setLoading(false);
      return;
    }

    try {
      // 1. Pending balance
      const pend = await publicClient.readContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "pending",
        args: [address],
      });
      setPendingBalance(pend);

      // 2. Loans by Lender
      const [lenderIds, lenderLoans] = await publicClient.readContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "byLender",
        args: [address, 0n, 50n],
      });

      // 3. Loans by Borrower
      const [borrowerIds, borrowerLoans] = await publicClient.readContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "byBorrower",
        args: [address, 0n, 50n],
      });

      const userLoansList: UserLoan[] = [];

      for (let i = 0; i < lenderIds.length; i++) {
        const id = lenderIds[i];
        const lData = lenderLoans[i];

        let sym = formatAddress(lData.token);
        let dec = 18;
        try {
          const [s, d] = await Promise.all([
            publicClient.readContract({
              address: lData.token,
              abi: ERC20_ABI,
              functionName: "symbol",
            }),
            publicClient.readContract({
              address: lData.token,
              abi: ERC20_ABI,
              functionName: "decimals",
            }),
          ]);
          sym = s;
          dec = d;
        } catch {
          // fallback
        }

        userLoansList.push({
          id,
          role: "lender",
          token: lData.token,
          symbol: sym,
          decimals: dec,
          principal: lData.principal,
          interest: lData.interest,
          collateral: lData.collateral,
          state: lData.state as LoanState,
          dueAt: lData.dueAt,
          offerEnds: lData.offerEnds,
        });
      }

      for (let i = 0; i < borrowerIds.length; i++) {
        const id = borrowerIds[i];
        const lData = borrowerLoans[i];

        let sym = formatAddress(lData.token);
        let dec = 18;
        try {
          const [s, d] = await Promise.all([
            publicClient.readContract({
              address: lData.token,
              abi: ERC20_ABI,
              functionName: "symbol",
            }),
            publicClient.readContract({
              address: lData.token,
              abi: ERC20_ABI,
              functionName: "decimals",
            }),
          ]);
          sym = s;
          dec = d;
        } catch {
          // fallback
        }

        userLoansList.push({
          id,
          role: "borrower",
          token: lData.token,
          symbol: sym,
          decimals: dec,
          principal: lData.principal,
          interest: lData.interest,
          collateral: lData.collateral,
          state: lData.state as LoanState,
          dueAt: lData.dueAt,
          offerEnds: lData.offerEnds,
        });
      }

      setLoans(userLoansList);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load user pawn loans:", err);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAddress, address]);

  async function handleWithdrawPending() {
    if (!walletClient || !publicClient) return;
    setIsWithdrawing(true);
    setActionError(null);
    try {
      await assertActiveChain(walletClient);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "withdraw",
      });
      await waitSuccess(publicClient, hash);
      await loadUserData();
    } catch (err) {
      setActionError(formatPawnError(err));
    } finally {
      setIsWithdrawing(false);
    }
  }

  const stateLabels: Record<number, { text: string; color: string }> = {
    [LoanState.Offered]: { text: "Offered", color: "text-[var(--warning)]" },
    [LoanState.Active]: { text: "Active", color: "text-[var(--accent)]" },
    [LoanState.Repaid]: { text: "Repaid", color: "text-[var(--success)]" },
    [LoanState.Seized]: { text: "Seized", color: "text-[var(--danger)]" },
    [LoanState.Cancelled]: { text: "Cancelled", color: "text-[var(--text-muted)]" },
  };

  return (
    <PageShell
      title="My Pawn Slips & Escrow"
      subtitle="View loans where you are the lender or borrower, and withdraw settled BOT balances."
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <BotChainGate>
          {/* Pending Withdrawal Panel */}
          <Panel ticketHeader="Pending Balance (Pull Payment)">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-2xl font-mono font-black text-[var(--accent)]">
                  {formatEther(pendingBalance)} BOT
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Settled proceeds from pawn loans, repayments, or cancelled offers awaiting withdrawal.
                </p>
              </div>

              <Button
                look="ticket"
                onClick={handleWithdrawPending}
                disabled={pendingBalance === 0n || isWithdrawing}
              >
                {isWithdrawing
                  ? "Confirming Withdrawal…"
                  : pendingBalance === 0n
                  ? "Nothing to Withdraw"
                  : `Withdraw ${formatEther(pendingBalance)} BOT`}
              </Button>
            </div>

            {actionError && (
              <div className="p-3 bg-[var(--danger)]/10 border border-[var(--danger)] text-[var(--danger)] text-xs font-mono mt-3">
                Withdrawal error: {actionError}
              </div>
            )}
          </Panel>

          {/* User Loans List */}
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Your Pawn Slips ({loans.length})
            </h2>
            <Link href="/offer">
              <Button look="ticket">＋ New Offer</Button>
            </Link>
          </div>

          {loading ? (
            <Panel>
              <div className="py-10 text-center text-sm font-mono text-[var(--text-muted)] animate-pulse">
                Loading your loan stubs…
              </div>
            </Panel>
          ) : loans.length === 0 ? (
            <Panel>
              <div className="py-12 text-center flex flex-col items-center gap-3">
                <p className="text-sm text-[var(--text-muted)]">
                  You have not created or taken any pawn slips yet.
                </p>
                <Link href="/">
                  <Button look="ticket">Browse Open Rail</Button>
                </Link>
              </div>
            </Panel>
          ) : (
            <div className="flex flex-col gap-3">
              {loans.map((l) => {
                const badge = stateLabels[l.state] || stateLabels[LoanState.Offered];
                return (
                  <Link
                    key={`${l.role}-${l.id.toString()}`}
                    href={`/loan/${l.id.toString()}`}
                    className="no-underline block group"
                  >
                    <div className="border-2 border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-black text-sm text-[var(--accent)] border-r-2 border-dashed border-[var(--border-default)] pr-3">
                          #{l.id.toString()}
                        </span>
                        <div>
                          <div className="font-heading font-bold text-sm text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                            {formatEther(l.principal)} BOT against{" "}
                            {formatToken(l.collateral, l.decimals)} {l.symbol}
                          </div>
                          <div className="text-xs font-mono text-[var(--text-muted)] mt-0.5">
                            Role:{" "}
                            <span className="text-[var(--text-primary)] uppercase font-bold">
                              {l.role}
                            </span>{" "}
                            • Repay: {formatEther(l.principal + l.interest)} BOT
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 justify-end text-xs font-mono">
                        <span className={`font-bold uppercase ${badge.color}`}>
                          {badge.text}
                        </span>
                        <span className="text-[var(--accent)]">Open Ticket →</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </BotChainGate>
      </div>
    </PageShell>
  );
}
