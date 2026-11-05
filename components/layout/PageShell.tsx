"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "@/components/ui/ConnectButton";
import NetworkBadge from "@/components/botchain/NetworkBadge";
import { footerLinks } from "@/lib/botchain/chain";
import BuiltOnBotChain from "@/components/botchain/BuiltOnBotChain";
import { app } from "@/lib/app-config";

interface PawnShellProperties {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export default function PageShell({ children, title, subtitle }: PawnShellProperties) {
  const activeRoute = usePathname();
  const explorerUrls = footerLinks();

  const pawnTicketTabs = [
    { text: "Ticket Rail", url: "/" },
    { text: "Lend & Offer", url: "/offer" },
    { text: "My Slips", url: "/me" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Brass and Green Velvet Pawn Counter Top */}
      <div className="border-b-4 border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-40 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" className="flex items-center gap-2 no-underline group">
              <span className="text-2xl filter drop-shadow-sm" aria-hidden="true">🏷️</span>
              <div>
                <span className="font-heading font-black text-xl text-[var(--accent)] tracking-normal block leading-tight group-hover:brightness-110">
                  {app.name}
                </span>
                <span className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] font-mono block">
                  Peer Pawn Ticket Rail
                </span>
              </div>
            </Link>

            <div className="hidden sm:flex items-center gap-1.5 ml-4">
              {pawnTicketTabs.map((tab) => (
                <Link
                  key={tab.url}
                  href={tab.url}
                  className={`px-3 py-1 text-xs uppercase font-heading font-bold tracking-wider rounded-none transition-all ${
                    activeRoute === tab.url
                      ? "bg-[var(--accent)] text-[var(--accent-ink)] shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {tab.text}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <NetworkBadge />
            <ConnectButton />
          </div>
        </div>
      </div>

      {/* Main Counter Stage */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-7">
        {(title || subtitle) && (
          <div className="mb-6 border-b-2 border-dashed border-[var(--border-default)] pb-4">
            {title && (
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[var(--text-primary)] uppercase tracking-tight">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)] font-sans">
                {subtitle}
              </p>
            )}
          </div>
        )}
        {children}
      </main>

      {/* Shared Footer Contract: exactly 3 links */}
      <footer className="mt-auto border-t-2 border-[var(--border-default)] bg-[var(--bg-surface)] py-5 text-xs text-[var(--text-muted)]">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <BuiltOnBotChain />

          <div className="flex items-center gap-6 font-mono text-xs">
            {explorerUrls.contract && (
              <a
                href={explorerUrls.contract}
                target="_blank"
                rel="noreferrer"
                className="hover:text-[var(--text-primary)] transition-colors underline"
              >
                Contract
              </a>
            )}
            <a
              href={explorerUrls.site}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors underline"
            >
              BOT Chain
            </a>
            <a
              href={explorerUrls.explorer}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors underline"
            >
              Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
