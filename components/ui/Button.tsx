"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

export interface PawnActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  look?: "ticket" | "standard" | "danger" | "ghost";
  density?: "compact" | "regular" | "prominent";
  inFlight?: boolean;
  // Aliases for compatibility
  variant?: "ticket" | "standard" | "danger" | "ghost" | "primary" | "secondary";
  size?: "compact" | "regular" | "prominent" | "sm" | "md" | "lg";
  loading?: boolean;
}

const PawnButton = forwardRef<HTMLButtonElement, PawnActionProps>(
  (
    {
      children,
      look = "ticket",
      density = "regular",
      disabled,
      inFlight = false,
      variant,
      size,
      loading,
      className = "",
      ...rest
    },
    ref
  ) => {
    let effectiveDensity = density;
    if (size === "sm" || size === "compact") effectiveDensity = "compact";
    else if (size === "lg" || size === "prominent") effectiveDensity = "prominent";
    else if (size === "md" || size === "regular") effectiveDensity = "regular";

    const isSpinning = loading !== undefined ? loading : inFlight;

    let effectiveLook = look;
    if (variant === "ghost" || variant === "secondary") effectiveLook = "ghost";
    else if (variant === "danger") effectiveLook = "danger";
    else if (variant === "primary") effectiveLook = "ticket";

    const densityStyles = {
      compact: "px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
      regular: "px-4 py-2 text-sm font-bold tracking-wide",
      prominent: "px-6 py-3 text-base font-bold tracking-wide shadow-md",
    }[effectiveDensity];

    const lookStyles = {
      ticket:
        "bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-105 active:scale-[0.98] border border-[var(--accent)] font-heading",
      standard:
        "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-elevated)] active:scale-[0.98]",
      danger:
        "bg-[var(--danger)] text-[var(--accent-ink)] hover:opacity-90 active:scale-[0.98] border border-transparent font-heading",
      ghost:
        "bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-[var(--border-default)]",
    }[effectiveLook];

    return (
      <button
        ref={ref}
        disabled={disabled || isSpinning}
        className={`inline-flex items-center justify-center rounded-none transition duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none uppercase font-heading ${densityStyles} ${lookStyles} ${className}`}
        {...rest}
      >
        {isSpinning ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
            <span>{children}</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

PawnButton.displayName = "PawnButton";

export default PawnButton;
