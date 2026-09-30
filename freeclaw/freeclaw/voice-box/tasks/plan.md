# Implementation Plan: Voice Box Master Spec

## Overview
Fix existing Voice Box UX first, then harden feed/polls/admin/moderation reliability. AI stays behind the product. No prod writes, no commits, no browser automation. Every slice is verified by unit/API tests, typecheck, lint, build.

## Architecture Decisions
- Record-first voice only: `src/pages/Submit.tsx` take is sole transcript source, server Whisper `api/_transcribe.js`, structurer `api/_assist.js:460`. No parallel live recognizer.
- Deterministic gates enforce; AI reasons only: `api/_moderation.js:178`, `api/_safety-pipeline.js`, `api/_providers.js:1156` hedging first-valid-wins.
- Feed: single bounded load, silent merge, no skeleton; polls canonical max-votes; realtime multiplexed per table-set.
- Admin: Command Center default `src/pages/admin/Overview.tsx`; Action Center secondary; 11 tabs in `src/lib/adminTabs.ts`.

## Task List (vertical slices, S/M only)

### Phase 1: Fix existing UX
- [ ] Task 1: Button audit §25 — dead/wrong/duplicate handlers, labels, permission, loading/success/error states.
- [ ] Task 2: Destructive actions §26 — justified confirms, bulk counts, undo where safe, no scroll reset.
- [ ] Task 3: Loading/error/empty §§22-24 — localized loading, preserved drafts, retry, intentional empties.

### Checkpoint: UX foundation
- [ ] Focused tests pass, typecheck 0, lint 0

### Phase 2: Core flows
- [ ] Task 4: Speak Up §§4-5 — 4-field submit, privacy gate with Remove/Edit/Cancel, optimistic post + draft preserve.
- [ ] Task 5: Feed §§6-7 + Detail §8 — optimistic reactions, targeted invalidation, scroll preserve, comment replies/pagination.
- [ ] Task 6: Polls §§9/43 + Ideas §10 — simple create, server-authoritative votes, idea lifecycle with decline reasons.
- [ ] Task 7: Notifications §§11/44 + Search §§12/39 — human-readable notes, deep-link, fast local-first search.

### Checkpoint: Core flows
- [ ] API + unit focused suites pass, no stale counts, no duplicate votes

### Phase 3: Admin work center
- [ ] Task 8: Work center §§13-15 `/admin/work` — URGENT/TODAY/IN PROGRESS/WAITING/COMPLETED/FAILED with cause/action/verification.
- [ ] Task 9: Moderation §§16-17 + Reports §40 — live/pending/appeals/offenders, detect→act→verify→audit, no fake confidence.
- [ ] Task 10: Security §18 + Audit §§37-38 — real events with evidence page, protected audit trail.

### Checkpoint: Admin
- [ ] Admin sweep suites pass, evidence links resolve, no decorative workers

### Phase 4: Reliability
- [ ] Task 11: Realtime §45 + Offline §46 + Integrity §47 — targeted updates, reconnect, draft preserve, transactional guards.
- [ ] Task 12: Jobs §48 + Third-party §49 + Perf §55 — idempotency, bounded retries, graceful degrade, p50/p95 measured.

### Phase 5: AI workforce §§32-36
- [ ] Task 13: Real-work + disable test per worker — BEFORE→ACTION→AFTER→VERIFICATION→EVIDENCE; remove/merge/determinize failures. No fake success §63.

### Checkpoint: Complete
- [ ] Full gates green, related flows checked, regression tests added §56

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| NIM congestion → offline fallbacks | Med | Hedged fast lane + chain + honest degraded states; never invent text |
| Scope creep to 67 sections at once | High | One S/M slice at a time, checkpoint reviews |
| Prod data merge needs writes | High | Blocked; code mechanisms verified only, no prod writes |

## Open Questions
- Reports UI: start Task 9 next, or finish Phase 1 button audit first?
- Voice input removal from Submit still open — confirm keep record-first?
