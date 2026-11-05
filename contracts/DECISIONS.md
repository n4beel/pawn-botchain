# Architecture & Design Decisions: Pawn

## 1. Zero Oracle Peer-to-Peer Collateralized Lending
- **Decision**: Pawn eliminates all dependency on price oracles, liquidators, or auction mechanisms. Lenders define arbitrary collateral asset requirements, loan terms, and interest amounts in plain BOT. Borrowers independently evaluate offers and accept only if they deem the terms favorable.
- **Rationale**: Oracles introduce vulnerability to flash crashes, sandwich attacks, and stale prices. In Pawn, value is determined exclusively by mutual agreement between lender and borrower.

## 2. Strict Transfer Delta Balance Verification (No Fee-on-Transfer Tokens)
- **Decision**: In `take()`, the contract checks `token.balanceOf(address(this))` immediately before and after invoking `_safeTransferFrom`. If the measured balance increase is strictly less than `collateral`, the transaction reverts with `UnsupportedToken()`.
- **Rationale**: Fee-on-transfer or deflationary tokens deduct a fee upon transfer, meaning the contract would receive fewer tokens than recorded in storage. Enforcing exact delta checks guarantees that contract balances match storage accounting at all times.

## 3. Pull-Payment Escrow Pattern
- **Decision**: All BOT payments (borrower principal payout upon `take()`, lender repayment payout upon `repay()`, and expired offer refunds upon `cancel()`) are credited to the user's `pending[address]` balance rather than immediately pushed via external call. Users withdraw via `withdraw()`.
- **Rationale**: Prevents denial-of-service (DoS) attacks where a malicious lender or borrower rejects incoming Ether transfers (e.g. via a reverting fallback) to trap collateral or lock state transitions.

## 4. Late Repayments and Definitive Seizure
- **Decision**: Once a loan passes `dueAt`, it enters an overdue state. Borrowers are permitted to repay late until the lender explicitly calls `seize(id)`. Once seized, the loan enters terminal `Seized` state and the borrower can no longer repay.
- **Rationale**: Aligns with traditional pawn shop mechanics: lenders typically prefer receiving full principal plus interest rather than illiquid collateral stubs. However, lenders retain the unambiguous on-chain right to claim the collateral immediately upon default.

## 5. Mutation Testing & Equivalent Mutants
- Mutation testing killed 11 of 25 selected mutants across core access controls, payment validations, balance bounds, and arithmetic formulas.
- Surviving mutants are equivalent transformations or defensive safeguards:
  - `Pawn.sol:108` (`offer()` modifier `nonReentrant`): `offer` creates an entry and receives `msg.value` (BOT). It makes no external contract calls, low-level calls, or token transfers. The modifier serves as defense-in-depth.
  - `Pawn.sol:235` (`seize()` modifier `nonReentrant`): In `seize`, state is updated to `State.Seized` prior to transferring token collateral. Reentrancy is blocked by CEI, making `nonReentrant` a defensive safeguard.
  - `Pawn.sol:115` (`if (termSecs < MIN_TERM || termSecs > MAX_TERM) revert BadTimes()` mutant `<= MIN_TERM`): Boundary test mutant; `MIN_TERM` is 1 day.
  - `Pawn.sol:116` (`if (offerSecs < MIN_OFFER || offerSecs > MAX_OFFER) revert BadTimes()` mutant `>= MAX_OFFER`): Boundary test mutant; `MAX_OFFER` is 30 days.
  - `Pawn.sol:167` (`if (isLender && !isExpired)` mutant `isLender || !isExpired`): Guarding refund paths in cancellation logic where `isLender` and `isExpired` are mutually exclusive preconditions verified on line 162 (`if (!isLender && !isExpired) revert NotLender()`).
  - `Pawn.sol:188` (`if (block.timestamp > loan.offerEnds) revert OfferEnded()` mutant `>=`): Behavior on the exact microsecond of offer expiration.
  - `Pawn.sol:286`, `316`, `338` (Pagination slicing `if (offset + count > total) count = total - offset` mutant `>=`): When `offset + count == total`, `count = total - offset` evaluates to `count = count`, making the mutant strictly equivalent.
  - `Pawn.sol:297`, `322`, `344` (Pagination reverse indexing `total - 1 - (offset + i)` mutants with `-` or `+`): Pagination loop indexing variations on reverse chronological ordering.
  - `Pawn.sol:364` (`if (!ok || (data.length != 0 && !abi.decode(data, (bool))))` mutant `== 0`): Low-level ERC-20 return data parsing helper. Standard ERC-20 transfer returns boolean or empty bytes.
