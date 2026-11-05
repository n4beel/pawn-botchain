"use client";

import { ReactNode } from "react";

interface PawnSlipCardProps {
  children: ReactNode;
  ticketHeader?: string;
  perforationTag?: string;
  className?: string;
  framed?: boolean;
}

export default function Panel({
  children,
  ticketHeader,
  perforationTag,
  className = "",
  framed = false,
}: PawnSlipCardProps) {
  return (
    <div
      className={`border-2 p-5 bg-[var(--bg-surface)] relative ${
        framed
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/30"
          : "border-[var(--border-default)] shadow-xs"
      } ${className}`}
    >
      {(ticketHeader || perforationTag) && (
        <div className="flex items-center justify-between pb-3 mb-4 border-b-2 border-dashed border-[var(--border-subtle)]">
          {ticketHeader && (
            <h3 className="font-heading text-sm font-black text-[var(--accent)] uppercase tracking-widest">
              {ticketHeader}
            </h3>
          )}
          {perforationTag && (
            <span className="font-mono text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 border border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--text-primary)]">
              {perforationTag}
            </span>
          )}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}
