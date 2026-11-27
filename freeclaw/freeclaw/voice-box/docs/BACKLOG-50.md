# Improvement backlog — 50 scoped candidates (UNBUILT)

Rule: nothing here is promised or half-built. Each item is sized so one
turn can spec → implement → test it. Pick by number and work starts.
Shipped-and-verified work is never re-listed here.

## Voice + chat (6)
1. TTS provider voice (human-like readback) — needs provider key.
2. Voice studio: resume/pause recording instead of restart.
3. Chat: quote-reply to a specific message.
4. Chat: unread divider line on reopen.
5. Voice orb "speaking" state wired to read-aloud start/stop.
6. Transcribe retry button on failure (keeps the take).

## Safety + moderation (6)
7. Reporter-reliability score on Reports rows (past upheld rate).
8. Slang trend sparkline per thread (counts over 7 days).
9. Slang digest: weekly top terms for admins.
10. Accusation-pattern coverage for transliterated verbs.
11.Victim-report fast lane: one-tap private post from coercion flags.
12. Blocked-appeal SLA timer visible to the reporter.

## Inbox + triage (5)
13. SMS/email counselor escalation (needs provider + school sign-off).
14. Thread auto-close after resolution + reporter confirm.
15. Canned macro replies per category for admins.
16. Inbox full-text search across a thread.
17. Handoff warm-transfer note (AI briefs the admin on takeover).

## Posts + feed (5)
18. Duplicate-cluster view (group near-identical titles).
19. Scheduled publish (embargo until an hour).
20. Post templates per category.
21. Anonymous follow (notify on status change, no account).
22. Related-posts strip on PostDetail.

## Polls + insights (4)
23. Ranked-choice polls.
24. Poll close date + auto-tally post.
25. Insights export (CSV of category breakdown).
26. Category health score (solved-rate per category).

## Presence + users (4)
27. Presence "as of" timestamp next to counts.
28. Suspended users hidden from Now counts.
29. New-user welcome checklist (first-run coach marks).
30. Test-account purge tool (explicit, audited, doubly confirmed).

## Storage + perf (5)
31. Per-class janitor toggles in Settings.
32. Weekly storage summary card on dashboard.
33. Fingerprint-blocklist age pruning (single-attempt, 180d+).
34. Image recompress on upload (WebP, capped dimensions).
35. Cold-start probe endpoint for uptime monitors.

## Admin UX (5)
36. Bulk triage (multi-select Start/Solve on queues).
37. Saved admin views (filter presets per tab).
38. Keyboard shortcuts overlay (?) for admin console.
39. Dashboard card: reports-awaiting-review count.
40. Announcement scheduling (publish at an hour).

## Trust + transparency (5)
41. Public moderation log (action counts, no identities).
42. Appeal status tracker for reporters.
43. Privacy page: data-lifecycle diagram in plain words.
44. "Why was this held?" explainer on pending posts.
45. Annual transparency export (counts only).

## Platform (5)
46. Status page history (90d uptime from health probe).
47. Feature flags surface for gradual rollouts.
48. Dark/light theme per-device memory (exists globally — scope it).
49. Offline outbox UI (queued actions visible + cancel).
50. PWA install prompt + offline shell.

## Round 2 — surfaced while building (unbuilt)
51. Slang trend sparkline per thread.
52. Reporter-reliability score on Reports rows.
53. Thread auto-close after resolution + reporter confirm.
54. Canned macro replies per category.
55. Scheduled publish (embargo hour).
56. Ranked-choice polls.
57. Presence "as of" on admin digest cards.
58. Transcribe language auto-detect (vs manual picker).
59. Voice-error analytics (failure reasons counted, no audio stored).
60. Per-thread AI on/off override for admins.
