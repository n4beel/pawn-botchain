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

## 5. Mutation Testing & Equivalent Mutants (21 of 25 killed; 4 equivalent survivors)
Mutation testing killed 21 of 25 selected mutants across core access controls, payment validations, boundary conditions, and pagination index math. The remaining 4 survivors are strictly equivalent per FEEDBACK-wave4-round1 §1:
1. `Pawn.sol:108` (`offer()` modifier `nonReentrant` removed):
   - `offer()` receives `msg.value` (BOT) and writes the new loan struct to internal storage. It makes zero external contract calls, static calls, low-level calls, or token transfers before or after. Reentrancy is structurally impossible without an external call.
2. `Pawn.sol:235` (`seize()` modifier `nonReentrant` removed):
   - In `seize()`, `loan.state = State.Seized` is updated *before* the external `_safeTransfer` call. Any reentrant attempt to invoke `seize()` or `repay()` on the same loan immediately reverts due to `if (loan.state != State.Active) revert NotActive()`, satisfying Checks-Effects-Interactions.
3. `Pawn.sol:316` (`byBorrower` pagination `offset + count > total` mutated to `>=`):
   - Genuinely equivalent: when `offset + count == total`, `count = total - offset` evaluates to `count = count` (a no-op assignment). No input or query can distinguish `>` from `>=`.
4. `Pawn.sol:338` (`latest` pagination `offset + count > total` mutated to `>=`):
   - Genuinely equivalent: exactly identical to line 316; at equality `offset + count == total`, `count = total - offset` equals the original `count`.
