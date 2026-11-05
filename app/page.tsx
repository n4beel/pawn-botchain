"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { formatEther } from "viem";
import PageShell from "@/components/layout/PageShell";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { PAWN_ABI, ERC20_ABI } from "@/lib/botchain/abi";
import { activeBotChain } from "@/lib/botchain/chain";
import { getDeployment } from "@/lib/botchain/deployment";
import { formatAddress, formatToken, LoanState } from "@/lib/pawn";

interface OfferSummary {
  id: bigint;
  lender: string;
  token: string;
  symbol: string;
  decimals: number;
  principal: bigint;
  interest: bigint;
  collateral: bigint;
  termSecs: bigint;
  offerEnds: bigint;
  state: LoanState;
}

export default function HomePage() {
  const { address } = useAccount();
  const deployment = getDeployment(activeBotChain.id);
  const contractAddress = deployment.address;
  const isDeployed = contractAddress !== "0x0000000000000000000000000000000000000000";

  const publicClient = usePublicClient({ chainId: activeBotChain.id });

  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowSec, setNowSec] = useState<bigint>(
    BigInt(Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  async function loadOffers() {
    if (!publicClient || !isDeployed) {
      setLoading(false);
      return;
    }

    try {
      const count = await publicClient.readContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "loanCount",
      });

      const total = Number(count);
      if (total === 0) {
        setOffers([]);
        setLoading(false);
        return;
      }

      const list: OfferSummary[] = [];

      for (let i = total; i >= Math.max(1, total - 40); i--) {
        const lId = BigInt(i);
        const lData = await publicClient.readContract({
          address: contractAddress,
          abi: PAWN_ABI,
          functionName: "loanOf",
          args: [lId],
        });

        // Only display Offered loans on the main ticket rail (Spec §3.2)
        if (lData.state === LoanState.Offered) {
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
            // fallback stays formatAddress
          }

          list.push({
            id: lId,
            lender: lData.lender,
            token: lData.token,
            symbol: sym,
            decimals: dec,
            principal: lData.principal,
            interest: lData.interest,
            collateral: lData.collateral,
            termSecs: lData.termSecs,
            offerEnds: lData.offerEnds,
            state: lData.state as LoanState,
          });
        }
      }

      // Sort by best principal first (Spec §3.2)
      list.sort((a, b) => (b.principal > a.principal ? 1 : -1));

      setOffers(list);
      setLoading(false);
    } catch (err) {
      console.error("Failed to load pawn offers:", err);
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAddress, address]);

  return (
    <PageShell
      title="Pawn Ticket Wire Rail"
      subtitle="Borrow BOT against ERC-20 tokens. Repay principal + interest before due date, or the lender keeps the tokens."
    >
      <div className="flex flex-col gap-6">
        {/* Limits & Counter Disclaimers (Spec §1, §3.4) */}
        <Panel ticketHeader="What is not checked">
          <ul className="list-disc pl-5 space-y-1 text-xs text-[var(--text-muted)] font-sans">
            <li>Nobody checks what the collateral is worth, or whether its issuer can freeze it.</li>
            <li>Nothing happens early. After the due date the lender may seize; the borrower may still repay until they do.</li>
            <li>Only plain tokens work; tokens that take a fee are refused.</li>
          </ul>
        </Panel>

        {/* Counter Action Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-[var(--text-primary)] uppercase tracking-wider">
            Open Pawn Slips (Best Principal First)
          </h2>
          <Link href="/offer">
            <Button look="ticket">＋ Post Lending Offer</Button>
          </Link>
        </div>

        {/* The Rail of Tickets hung on a wire (Spec §3.1) */}
        {loading ? (
          <Panel>
            <div className="py-12 text-center text-sm font-mono text-[var(--text-muted)] animate-pulse">
              Reading tickets hanging on the counter rail…
            </div>
          </Panel>
        ) : !isDeployed ? (
          <Panel>
            <div className="py-12 text-center text-sm text-[var(--warning)]">
              Pawn contract is not yet deployed on this network.
            </div>
          </Panel>
        ) : offers.length === 0 ? (
          <Panel>
            <div className="py-12 text-center flex flex-col items-center gap-3">
              <p className="text-sm text-[var(--text-muted)]">
                The counter rail is clear. No active loan offers are currently posted.
              </p>
              <Link href="/offer">
                <Button look="ticket">Post the First Offer</Button>
              </Link>
            </div>
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            {offers.map((o) => {
              const isExpired = nowSec > o.offerEnds;
              const termDays = Number(o.termSecs / 86400n);

              return (
                <Link
                  key={o.id.toString()}
                  href={`/loan/${o.id.toString()}`}
                  className="no-underline block group"
                >
                  <div className="border-2 border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition-all p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
                    <div className="flex items-center gap-4">
                      <div className="border-r-2 border-dashed border-[var(--border-default)] pr-4 font-mono font-black text-lg text-[var(--accent)]">
                        #{o.id.toString()}
                      </div>

                      <div>
                        <div className="font-heading text-base font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                          Borrow {formatEther(o.principal)} BOT against {formatToken(o.collateral, o.decimals)} {o.symbol}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                          Lender: {formatAddress(o.lender)} • Repay: {formatEther(o.principal + o.interest)} BOT • Term: {termDays} Days
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono justify-end">
                      <div className="text-right">
                        <span className="text-[var(--text-muted)] block text-[10px]">
                          Offer valid until:
                        </span>
                        <span className="text-[var(--text-primary)]">
                          {new Date(Number(o.offerEnds) * 1000).toLocaleDateString()}
                        </span>
                      </div>

                      <span
                        className={`px-3 py-1 font-heading text-xs font-bold uppercase border ${
                          isExpired
                            ? "border-[var(--danger)] text-[var(--danger)] bg-[var(--danger)]/10"
                            : "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]"
                        }`}
                      >
                        {isExpired ? "Expired" : "Take Pawn Slip →"}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
