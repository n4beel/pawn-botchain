"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { parseEther, isAddress } from "viem";
import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { assertActiveChain, waitSuccess } from "@/lib/useChainWrite";
import { PAWN_ABI, ERC20_ABI } from "@/lib/botchain/abi";
import { activeBotChain } from "@/lib/botchain/chain";
import { getDeployment } from "@/lib/botchain/deployment";
import { tokenAmountFromInput } from "@/lib/pawn";
import { formatPawnError } from "@/lib/errors";

export default function OfferPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const deployment = getDeployment(activeBotChain.id);
  const contractAddress = deployment.address;
  const isDeployed = contractAddress !== "0x0000000000000000000000000000000000000000";

  const publicClient = usePublicClient({ chainId: activeBotChain.id });

  // Form State
  const [tokenAddr, setTokenAddr] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [readingToken, setReadingToken] = useState(false);

  const [collateralInput, setCollateralInput] = useState("");
  const [principalInput, setPrincipalInput] = useState("1");
  const [interestInput, setInterestInput] = useState("0.05");
  const [termDaysInput, setTermDaysInput] = useState("14");
  const [offerDaysInput, setOfferDaysInput] = useState("7");

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Live Token Detection
  useEffect(() => {
    const cleanAddr = tokenAddr.trim();
    if (!cleanAddr) {
      setTokenSymbol(null);
      setTokenDecimals(null);
      setTokenError(null);
      return;
    }

    if (!isAddress(cleanAddr)) {
      setTokenSymbol(null);
      setTokenDecimals(null);
      setTokenError("Enter a valid EVM contract address.");
      return;
    }

    let isMounted = true;
    setReadingToken(true);
    setTokenError(null);

    async function probeToken() {
      if (!publicClient) return;
      try {
        const byteCode = await publicClient.getBytecode({
          address: cleanAddr as `0x${string}`,
        });
        if (!byteCode || byteCode === "0x") {
          if (isMounted) {
            setTokenError("Address has no contract code (not a token).");
            setTokenSymbol(null);
            setTokenDecimals(null);
            setReadingToken(false);
          }
          return;
        }

        let sym = cleanAddr;
        let dec = 18;

        try {
          sym = await publicClient.readContract({
            address: cleanAddr as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "symbol",
          });
        } catch {
          sym = cleanAddr;
        }

        try {
          dec = await publicClient.readContract({
            address: cleanAddr as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "decimals",
          });
        } catch {
          dec = 18;
        }

        if (isMounted) {
          setTokenSymbol(sym);
          setTokenDecimals(dec);
          setReadingToken(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setTokenError("Failed to read ERC-20 interface: " + (err.message || String(err)));
          setTokenSymbol(null);
          setTokenDecimals(null);
          setReadingToken(false);
        }
      }
    }

    probeToken();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddr]);

  // Validation
  useEffect(() => {
    setValidationError(null);

    if (!tokenSymbol || tokenDecimals === null) {
      return;
    }

    if (!collateralInput.trim() || Number(collateralInput) <= 0) {
      setValidationError("Collateral amount must be greater than zero.");
      return;
    }

    try {
      tokenAmountFromInput(collateralInput, tokenDecimals);
    } catch (e: any) {
      setValidationError(e.message);
      return;
    }

    const principalNum = Number(principalInput);
    if (isNaN(principalNum) || principalNum < 0.01 || principalNum > 100000) {
      setValidationError("Principal must be between 0.01 BOT and 100,000 BOT.");
      return;
    }

    const interestNum = Number(interestInput);
    if (isNaN(interestNum) || interestNum < 0 || interestNum > principalNum) {
      setValidationError("Interest must be between 0 and the principal amount.");
      return;
    }

    const termDays = Number(termDaysInput);
    if (isNaN(termDays) || termDays < 1 || termDays > 180) {
      setValidationError("Loan term must be between 1 day and 180 days.");
      return;
    }

    const offerDays = Number(offerDaysInput);
    if (isNaN(offerDays) || offerDays * 24 < 1 || offerDays > 30) {
      setValidationError("Offer window must be between 1 hour and 30 days.");
      return;
    }
  }, [
    tokenSymbol,
    tokenDecimals,
    collateralInput,
    principalInput,
    interestInput,
    termDaysInput,
    offerDaysInput,
  ]);

  async function handlePostOffer(e: React.FormEvent) {
    e.preventDefault();
    if (validationError || !tokenDecimals || !tokenSymbol || !walletClient || !publicClient) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await assertActiveChain(walletClient);

      const collateralRaw = tokenAmountFromInput(collateralInput, tokenDecimals);
      const principalWei = parseEther(principalInput);
      const interestWei = parseEther(interestInput);
      const termSecs = BigInt(Math.floor(Number(termDaysInput) * 86400));
      const offerSecs = BigInt(Math.floor(Number(offerDaysInput) * 86400));

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: PAWN_ABI,
        functionName: "offer",
        args: [
          tokenAddr.trim() as `0x${string}`,
          collateralRaw,
          interestWei,
          termSecs,
          offerSecs,
        ],
        value: principalWei,
      });

      await waitSuccess(publicClient, hash);
      router.push("/");
    } catch (err) {
      setSubmitError(formatPawnError(err));
      setIsSubmitting(false);
    }
  }

  const isFormValid =
    !validationError &&
    tokenSymbol !== null &&
    tokenDecimals !== null &&
    collateralInput.length > 0 &&
    principalInput.length > 0 &&
    interestInput.length > 0;

  return (
    <PageShell
      title="Post Lending Offer"
      subtitle="Lock BOT principal into an open pawn offer. Anyone who deposits the requested token collateral can borrow it."
    >
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-mono text-[var(--accent)] hover:underline flex items-center gap-1"
          >
            ← Back to Ticket Rail
          </Link>
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Principal is escrowed in BOT
          </span>
        </div>

        <BotChainGate>
          <form onSubmit={handlePostOffer} className="flex flex-col gap-5">
            {/* Token Collateral Section */}
            <Panel ticketHeader="1. Collateral Asset Details">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    ERC-20 Token Address
                  </label>
                  <input
                    type="text"
                    value={tokenAddr}
                    onChange={(e) => setTokenAddr(e.target.value)}
                    placeholder="0x…"
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] rounded-none focus:outline-none focus:border-[var(--accent)]"
                    required
                  />
                  {readingToken && (
                    <p className="text-xs font-mono text-[var(--text-muted)] mt-1 animate-pulse">
                      Inspecting token contract…
                    </p>
                  )}
                  {tokenError && (
                    <p className="text-xs font-mono text-[var(--danger)] mt-1">
                      {tokenError}
                    </p>
                  )}
                  {tokenSymbol && !readingToken && (
                    <div className="mt-2 p-2 bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-between text-xs font-mono">
                      <span className="text-[var(--text-muted)]">Recognised Token:</span>
                      <span className="text-[var(--accent)] font-bold">
                        {tokenSymbol} ({tokenDecimals} decimals)
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Collateral Amount Required ({tokenSymbol || "Tokens"})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={collateralInput}
                    onChange={(e) => setCollateralInput(e.target.value)}
                    placeholder="e.g. 50"
                    disabled={!tokenSymbol}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] rounded-none focus:outline-none focus:border-[var(--accent)] disabled:opacity-40"
                    required
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    Borrower must deposit this exact amount into escrow to take the loan.
                  </p>
                </div>
              </div>
            </Panel>

            {/* Principal & Interest Section */}
            <Panel ticketHeader="2. Loan Terms & Rates">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Principal to Lend (BOT)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={principalInput}
                    onChange={(e) => setPrincipalInput(e.target.value)}
                    placeholder="1.0"
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] rounded-none focus:outline-none focus:border-[var(--accent)]"
                    required
                  />
                  <span className="text-[10px] text-[var(--text-muted)] font-mono block mt-1">
                    Range: 0.01 – 100,000 BOT
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Interest Fee (BOT)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={interestInput}
                    onChange={(e) => setInterestInput(e.target.value)}
                    placeholder="0.05"
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] rounded-none focus:outline-none focus:border-[var(--accent)]"
                    required
                  />
                  <span className="text-[10px] text-[var(--text-muted)] font-mono block mt-1">
                    Max: equal to principal
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Loan Term (Days)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={termDaysInput}
                    onChange={(e) => setTermDaysInput(e.target.value)}
                    placeholder="14"
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] rounded-none focus:outline-none focus:border-[var(--accent)]"
                    required
                  />
                  <span className="text-[10px] text-[var(--text-muted)] font-mono block mt-1">
                    Term: 1 to 180 days
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    Offer Valid Window (Days)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={offerDaysInput}
                    onChange={(e) => setOfferDaysInput(e.target.value)}
                    placeholder="7"
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] rounded-none focus:outline-none focus:border-[var(--accent)]"
                    required
                  />
                  <span className="text-[10px] text-[var(--text-muted)] font-mono block mt-1">
                    Validity: 1 hour to 30 days
                  </span>
                </div>
              </div>
            </Panel>

            {/* Stub Summary Preview */}
            <div className="p-4 border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] text-xs font-mono space-y-1">
              <div className="text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                Draft Pawn Slip Terms
              </div>
              <p className="text-[var(--text-primary)] font-bold">
                Leave {collateralInput || "0"} {tokenSymbol || "Tokens"}. Receive {principalInput || "0"} BOT. Repay{" "}
                {(Number(principalInput || 0) + Number(interestInput || 0)).toFixed(4)} BOT within{" "}
                {termDaysInput || "0"} days.
              </p>
            </div>

            {validationError && (
              <div className="p-3 bg-[var(--danger)]/10 border border-[var(--danger)] text-[var(--danger)] text-xs font-mono">
                {validationError}
              </div>
            )}

            {submitError && (
              <div className="p-3 bg-[var(--danger)]/10 border border-[var(--danger)] text-[var(--danger)] text-xs font-mono">
                {submitError}
              </div>
            )}

            <Button
              look="ticket"
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="w-full py-3"
            >
              {isSubmitting
                ? "Confirming on BotChain…"
                : `Lock ${principalInput || "0"} BOT & Post Pawn Offer`}
            </Button>
          </form>
        </BotChainGate>
      </div>
    </PageShell>
  );
}
