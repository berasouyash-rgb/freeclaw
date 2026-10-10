# Improvements Backlog (living — highest value first)

Ship-status: the P0 slice is DONE and verified (API 112/1256 · frontend 84/1367 ·
typecheck 0 · lint 0 · build ✅ · audit FAIL 0). Everything below is ordered so
the school gets value even if only the top items are ever done. Honest note:
this starts at ~120 concrete items, not 1000 — a real backlog beats a padded one.
Append, never rewrite; check off with evidence links.

## P0 — done this slice (evidence in docs/BUILD-PLAN-100.md)
- [x] 8s→15s default timeout; offline vs cold-start error copy
- [x] Publish path (pre-publish/posts/polls) on 28s budget
- [x] Voice studio premium rebuild (orbits, glow, 24-bar wave, shimmer, reduced-motion)
- [x] Nav: 7 core + More disclosure, routes untouched

## P1 — reliability (next)
- [ ] Supabase connection pooling check (Supavisor) + slow-query log review; add
      indexes for posts(status,created_at), poll_votes(poll_id), comments(post_id)
- [ ] Pre-publish LLM call: add 20s server-side cap with hold-for-review fallback
      (client already handles the hold path)
- [x] ~~Cache AI suggestions by text-hash 60s~~ DONE this slice: in-memory
      cache in `api/_assist.js` for suggest/suggest_poll/voice_complaint
      (AI wins only, `cached:true` flag, bounded 200 entries). Repeat
      keystroke pauses return instantly with zero LLM cost — and every hit
      is one less call on the shared NIM worker, which is what keeps the
      inbox fast too. Locked by cache-hit tests in assist-suggest/assist-voice.
- [ ] Transcribe: surface 413/503 distinctly in UI (too-long vs no-provider)
- [ ] Offline queue: show queued count + "will send on reconnect" on Submit
- [ ] Retry-once for idempotent POST /api/polls on 503 only (never on timeout)
- [ ] Vercel function regions: pin to nearest region to Supabase project
- [ ] Add `Cache-Control: public, max-age=30` to leaderboard/insights GETs
- [ ] Health endpoint: include Supabase round-trip ms so slowness is attributable
- [ ] Rate-limiter: per-route budgets visible in admin System Health

## P2 — voice studio (next)
- [ ] Waveform from real AnalyserNode FFT bins (currently level-driven)
- [ ] Playback waveform scrubber (seek by tapping the bars)
- [ ] Language auto-detect hint (en/hi/bn) before structuring
- [ ] "Try a sample" demo take for mic-shy users
- [ ] Record-only browsers: show capture-format note (mp4 vs webm)
- [ ] Transcript confidence highlight (low-confidence words underlined)
- [ ] One-tap re-record that preserves the previous take until the new one lands
- [ ] Voice shortcut: press-and-hold mic from the Feed (mobile)

## P3 — load-once feel
- [ ] Prefetch Submit chunk on nav hover (kills PageFallback flash)
- [ ] Feed: stale-while-revalidate — show cache instantly, refresh silently
- [ ] Image lazy-load + blur placeholder on PostCards
- [ ] Poll countdown: single shared 1s ticker via context (not per-card interval)
- [ ] Communities list: 60s poll (currently 30s)
- [ ] Admin Reports: 30s poll (currently 15s)
- [ ] Virtualize Feed beyond 100 items (currently full render)
- [ ] Bundle: split admin console further (AIQuality/ModelPerformance heavy)

## P4 — agents visible working (Automations trust)
- [ ] Automations panel: per-worker last-run + duration + items-touched (no
      "NEVER RAN" without a since-timestamp)
- [ ] Worker errors link to the exact failing query/table (schema-contract style)
- [ ] Weekly "what your agents did" digest in admin inbox
- [ ] Disable-test buttons already exist — add "run once now" per worker
- [ ] SLA worker: expose breach list with age, not just counts
- [ ] Poll closer: show next-expiring polls preview
- [ ] Case reopener: show candidate list before acting (dry-run mode)

## P5 — school-day polish
- [ ] Empty states with one clear action on every list page (audit: Polls, Saved)
- [ ] Announcement banner scheduling (start/end dates)
- [ ] Print-friendly complaint view for notice boards
- [ ] Hindi/Bengali UI toggle for key buttons (Submit flow first)
- [ ] Font-size toggle for accessibility (3 steps, persisted)
- [ ] Contrast audit at 200% zoom on Submit + PostDetail
- [ ] Keyboard: full Submit flow without a mouse (test + fix)
- [ ] Screen-reader pass on voice studio (live region wording)

## P6 — safety & privacy (school zero-tolerance stays)
- [ ] Spaced/dotted evasion gap ("s h i t") — boundary-tested detector upgrade
- [ ] Appeal SLA countdown visible to the filer
- [ ] Admin audit trail export (CSV) for the school office
- [ ] PII redaction preview before publish ("we held X — remove?")
- [ ] Rate-limit coaching copy ("3 posts/hour keeps the feed fair")

## P7 — remove/merge candidates (routes stay until evidence)
- [ ] Merge Solving Board into Suggestions with a status filter (one list, not two)
- [ ] Merge Insights into Leaderboard as a tab (both are read-only stats)
- [ ] Changelog/StatusPage: generate from git tags instead of hand-editing
- [ ] Confirm no inbound links before any route removal (log 404s for 2 weeks)

## P8 — measurement (prove "users happy")
- [ ] Real-user timing: submit-start→published p50/p95 in admin Performance
- [ ] Voice success rate: takes→transcripts→publishes funnel
- [ ] Timeout rate per endpoint per day (alert if >2%)
- [ ] Offline-queue flush success rate
- [ ] Poll vote completion rate
