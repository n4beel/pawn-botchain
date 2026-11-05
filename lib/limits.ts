// lib/limits.ts - Contract-level parameter bounds for Pawn (Spec §2.1)

export const MIN_PRINCIPAL = 10000000000000000n; // 0.01 ether
export const MAX_PRINCIPAL = 100000000000000000000000n; // 100,000 ether
export const MIN_TERM = 86400n; // 1 day
export const MAX_TERM = 15552000n; // 180 days
export const MIN_OFFER = 3600n; // 1 hour
export const MAX_OFFER = 2592000n; // 30 days
export const MAX_PAGE = 50;

export const LIMITS = {
  MIN_PRINCIPAL,
  MAX_PRINCIPAL,
  MIN_TERM,
  MAX_TERM,
  MIN_OFFER,
  MAX_OFFER,
  MAX_PAGE,
} as const;

export const CONTRACT_LIMITS = LIMITS;
