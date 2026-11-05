# Pawn (Project 69)

Borrow BOT against a token. Repay, or the lender keeps it.

## Overview
Pawn provides peer-to-peer collateralized lending with no oracles, liquidations, or margin calls.
Lenders lock principal in BOT, specifying the required ERC-20 collateral, collateral amount, fixed interest, term duration, and offer validity.
Borrowers accept offers by depositing their token collateral in full, activating the loan.
Borrowers can redeem their collateral by repaying principal + interest at any time before the lender seizes. Late repayments are permitted until the lender explicitly calls `seize()`. If overdue, lenders can seize the collateral asset.

## Archetype
- **Layout Archetype**: **BA · Ticket stub**
- **Ground / Ink / Accent**: `#005C09` / `#EAF7EC` / `#FFB703`
- **Typography**: Arvo (headings) · Roboto Condensed (UI and body)

## WCAG Contrast Verification
- Text Primary (`#EAF7EC`) on Ground (`#005C09`): **7.5:1** (Passes AAA)
- Text Primary (`#EAF7EC`) on Surface (`#003F06`): **11.1:1** (Passes AAA)
- Text Muted (`#A8CCAC`) on Surface (`#003F06`): **6.9:1** (Passes AA)
- Accent Ink (`#001F03`) on Accent (`#FFB703`): **10.0:1** (Passes AAA)
- Menu Text (`#EAF7EC`) on Menu BG (`#003F06`): **11.1:1** (Passes AAA)
- Menu Muted (`#A8CCAC`) on Menu BG (`#003F06`): **6.9:1** (Passes AA)

## Test Coverage
- **Foundry Unit & Fuzz**: 21 unit & fuzz tests pass (with 4 distinct mock token behaviors)
- **Invariant Test**: 1 invariant suite (128,000 calls across actors, 0 reverts, balance conserved)
- **Vitest Unit**: 47 unit & lint tests pass
- **Integration**: 5 tests pass against local Anvil node (port 8669)
- **Mutation Kill Rate**: 11 / 25 killed (14 equivalent/defensive documented in `contracts/DECISIONS.md`)
