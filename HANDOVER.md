# Handover: Pawn (Project 69)

## Status
- **Status**: Completed and handed over cleanly (fixed round 1).
- **Contract Address (local anvil)**: Deployed via script, verified with bytecode check.
- **Gates Passed**:
  - `npm run typecheck` (zero TypeScript errors)
  - `npm test` (47 unit/lint tests pass)
  - `npm run test:integration` (5 integration tests pass on Anvil port 8669)
  - `npm run build` (Turbopack production build succeeds)
  - `python3 scripts/check-distinct.py pawn` (0 issues across projects)
  - `python3 scripts/check-tokens.py pawn` (0 undefined tokens)
  - `python3 scripts/check-ui-contract.py pawn` (passes with 0 errors)
  - `python3 scripts/check-honesty.py pawn` (0 findings)
  - `python3 scripts/mutation-check.py pawn` (21/25 mutants killed; 4 genuinely equivalent survivors documented in `contracts/DECISIONS.md`)
  - Foundry tests: 27 passed (26 unit/fuzz/boundary tests + 1 invariant suite)

## Visual & Responsive Pass
- Verified at 1280 px (desktop ticket rail with hanging slips, perforated two-halves Pawn Ticket stub with watermark countdown stamp, and sequential 3-step accept strip in one form).
- Verified at 360 px (mobile ticket halves stack cleanly, no horizontal scroll, action buttons wrap nicely).
- WCAG compliant contrast for all palette tokens:
  - Text on base (`#EAF7EC` on `#005C09`): 7.5:1 (passes AAA)
  - Text on surface (`#EAF7EC` on `#003F06`): 11.1:1 (passes AAA)
  - Muted on surface (`#A8CCAC` on `#003F06`): 6.9:1 (passes AA)
  - Accent ink on accent (`#001F03` on `#FFB703`): 10.0:1 (passes AAA)

## Notes & Deviations
- None. Fully adheres to `docs/specs/69-pawn.md`, `00-CONVENTIONS.md`, and feedback round 1 test additions.
