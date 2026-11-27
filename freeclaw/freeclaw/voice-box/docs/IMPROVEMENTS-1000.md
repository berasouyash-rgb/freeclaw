# Improvements Ledger — 1000+ specific items (living)

## IMPLEMENTED (evidence-linked; these stay checked)
- #4 voiceLang persists (speech.ts load/saveVoiceLang + Submit wiring + 3 tests).
- #22 appeal preview masks contacts, states moderators see full text (AppealPanel + test).
- #129 feed dedupeById on full loads (Home + unit tests).
- #137 timeAgo clamps future→"just now" (+ test).
- #167 zero-vote polls say "No votes yet" (PollCard + test).
- #193 inbox restores draft only when sync proves unsent (UserChat + 2 tests); also fixed stale timeout-copy detection broken by the 15s-budget change.
- #661 zero bare "unknown error" strings in src (verified by grep; errorText funnel + summarize reason-chain + formatRunError tests).
- #663 PageFallback has role=status + "Loading…" label.
- Extras in same pass: errorText unified in api.ts/Home/PollCard/Overview/OpsCenter/ErrorTracking; summarize() prefers reason/summary.
- Verified: API 112/1277 · frontend 84/1380 · typecheck 0 · lint 0.

Each item is one verifiable improvement, bug-risk, placement error, or fix —
not feature confetti. Format: `N. [area] What → done-criterion`.
Areas: SUBMIT/VOICE, FEED, POLLS, INBOX, COMMUNITIES, DISCOVER (search/insights/
leaderboard/board/saved), ADMIN-SHELL, ADMIN-TABS, COWORKER, WORKERS, SAFETY,
API, DB, AUTH, PERF, A11Y, MOBILE, OPS. Check off with evidence, never by feel.

## SUBMIT & VOICE STUDIO (`src/pages/Submit.tsx`, `src/lib/speech.ts`, `api/_assist.js`, `api/_transcribe.js`)
1. [SUBMIT] Voice take >90s keeps live transcript but never says why server copy was skipped → add exact-seconds notice.
2. [SUBMIT] `transcribeTake` 512-byte floor swallows whisper-quiet takes silently → toast "nothing usable captured, try again closer".
3. [SUBMIT] Record-only browsers get no format note (mp4 vs webm) → show capture format under playback.
4. [SUBMIT] Language pills reset to en-IN every visit → persist last `voiceLang` in localStorage.
5. [SUBMIT] Interim text truncates with CSS ellipsis and no expansion → tap interim to expand full partial.
6. [SUBMIT] Transcript textarea has no word count → add 500-char counter (desc cap is silent).
7. [SUBMIT] "Turn into complaint" disabled below 8 chars with no reason shown → inline hint "speak one full sentence".
8. [SUBMIT] Voice draft apply wipes hand-typed tags on conflict → merge, don't replace, and say so.
9. [SUBMIT] Draft restore jumps to type mode without telling the user → "Draft restored" toast already exists; also restore prior mode.
10. [SUBMIT] Autosave fires while recording → pause autosave during `dictating` to avoid half-transcript drafts.
11. [SUBMIT] Duplicate detector scans only same-category posts → include cross-category title matches above 0.7.
12. [SUBMIT] Duplicate check fetches ALL posts unbounded → cap at 200 most recent server-side.
13. [SUBMIT] Poll expiry quick-buttons compare ISO strings with fresh `Date.now()` → preselect highlight flickers; compute once per render.
14. [SUBMIT] `datetime-local` min uses UTC slice, confusing local users → set min in local timezone.
15. [SUBMIT] Link-poll dropdown shows only own posts with no explanation → helper "only your open complaints can link".
16. [SUBMIT] Image 3MB client check duplicates server MAX_INLINE 2MB → unify at one constant, one message.
17. [SUBMIT] Upload failure loses the whole form state → preserve title/desc/category across image errors (already draft-saved; verify).
18. [SUBMIT] Pre-publish "revision" queues for review but the button says nothing → inline "queued for review" chip.
19. [SUBMIT] holdForReview toast fires before publish attempt → move until after successful insert.
20. [SUBMIT] Cooldown 20s message shows raw seconds → humanize ("19s" fine; "wait 20s before posting again" twice worded).
21. [SUBMIT] Blocked-appeal panel loses poll options ordering → preserve option order in appeal context.
22. [SUBMIT] Appeal panel for PII blocks shows raw number back to the user → mask to last-2 in the appeal preview.
23. [SUBMIT] `moderateContent` runs on every keystroke with 200ms debounce but no cancellation → stale results can flash; use seq guard.
24. [SUBMIT] Profanity-block copy differs between client gate and server 403 → byte-parity test already exists; extend to polls surface.
25. [SUBMIT] Title/desc char counters missing on poll question → add 140 counter.
26. [SUBMIT] Poll options allow 60 chars but counter absent → per-option counter.
27. [SUBMIT] Yes/No polls send empty options array; server must not 400 on `[]` → contract test.
28. [SUBMIT] Expiry in the past submits without complaint → client-side "must be future" error.
29. [SUBMIT] Category emoji map misses new categories → fallback emoji + warn log.
30. [SUBMIT] Voice studio meter keeps animating 120ms after stop → clear meter synchronously in stop branch.
31. [SUBMIT] `recSecs` timer continues during transcribing phase → freeze at stop time, label "take length".
32. [SUBMIT] Playback audio has no playback-rate control → add 1x/1.5x toggle for review.
33. [SUBMIT] Take URL revoked on re-record but old blob retained in ref → null the ref together.
34. [SUBMIT] `descBeforeTakeRef` set at start, but user may type during recording → rebase live typing, don't overwrite (diff-merge).
35. [SUBMIT] Server transcript replaces live words even when shorter/emptier → keep longer of the two, flag the choice.
36. [SUBMIT] `transcriptSource` badge missing when text came from typing after take → third state "mixed".
37. [SUBMIT] asrDegraded notice shows once per visit but key may be added mid-visit → re-probe on each stop, clear flag on success.
38. [SUBMIT] Mic-denied path returns false but leaves mode on voice studio → offer "type instead" button inline in the error toast area.
39. [SUBMIT] `getUserMedia` constraints lack echoCancellation → enable `echoCancellation/noiseSuppression/autoGain` for classrooms.
40. [SUBMIT] Mime fallback picks "" (browser default) without logging → log chosen mime for diagnostics.
41. [SUBMIT] On Safari, MediaRecorder mime "" yields mp4; server EXT_BY_MIME must map mp4 → verify contract test for mp4 upload.
42. [SUBMIT] Blow-out protection: micLevel peak stuck at 1.0 on loud rooms → normalize meter to rolling max (already tracked; use it).
43. [SUBMIT] `heardAudioRef` never resets between takes in same session → reset at each start (already) — verify with test.
44. [SUBMIT] Double-tap stop spawns no guard on transcribeTake → `expectTakeRef` covers; add test for double-stop single-post.
45. [SUBMIT] Unmount during upload leaks object URL → revoke in cleanup effect.
46. [SUBMIT] `structureVoice` offline check uses `navigator.onLine` only → also catch postSlow failure into same copy.
47. [SUBMIT] Voice draft category may not exist in `useCategories` list → validate against live list, fallback "Other".
48. [SUBMIT] Applied draft doesn't scroll to review position → scroll to title field on apply.
49. [SUBMIT] Poll suggest note (💡) has no dismiss → dismiss per session.
50. [SUBMIT] Suggest card "use" buttons lack aria-labels → "Use improved question", "Add option X".
51. [SUBMIT] AI suggest overwrites user-edited category without consent → "Apply" button instead of auto-set (check current behavior; if auto, gate it).
52. [SUBMIT] Suggest fires while tab hidden → skip when `document.hidden`.
53. [SUBMIT] Suggest request lacks abort on unmount → AbortController per seq.
54. [SUBMIT] Title improvements in Hindi/Bengali scripts get mangled by 80-char slice → slice by grapheme, not UTF-16 units.
55. [SUBMIT] Tags from AI may contain spaces/specials → sanitize to kebab-case client-side before display.
56. [SUBMIT] Priority chip from AI has no explanation → tooltip "AI guessed urgency from wording".
57. [SUBMIT] Confidence below 0.5 shows same UI as 0.95 → dim the suggestion card under 0.6.
58. [SUBMIT] Moderation flags list uses raw category keys → human labels ("personal info", not "pii_phone").
59. [SUBMIT] Blocked-submit toast duration too short to read reason → sticky until dismissed for blocks.
60. [SUBMIT] Success confetti fires before navigation completes → fire after route change mounted.
61. [SUBMIT] After publish, draft key cleared but `linkablePosts` cache stale → invalidate on publish.
62. [SUBMIT] Poll publish navigates to /polls losing the new poll id → navigate to `#new-poll-id` anchor.
63. [SUBMIT] Private-post toggle has no explainer → "Only admins/moderators will see this".
64. [SUBMIT] isPrivate state lost when switching Problem/Suggestion/Poll tabs → preserve across tab switches.
65. [SUBMIT] Type tabs are buttons with role=tab but no arrow-key navigation → roving tabindex.
66. [SUBMIT] f-title-help character count not announced to screen readers → aria-live polite.
67. [SUBMIT] Voice/Pencil chooser cards lack heading semantics → real <h2> text.
68. [SUBMIT] "Recommended" badge on Speak-it biases without basis → A/B or remove; keep only if voice success rate > type (measure first).
69. [SUBMIT] Step 1/Step 2 numbering breaks when user goes back → derive step from state, not static labels.
70. [SUBMIT] Voice studio on small screens: 148px stage + wave overflows 320px → cap stage at 120px under 360px viewport.
71. [SUBMIT] Orbital rings animate even when tab hidden → pause via visibilitychange.
72. [SUBMIT] Wave bars use inline animationDelay per index; reduced-motion test must assert `animation: none` → add test.
73. [SUBMIT] Transcribing shimmer on the mic button indistinguishable from disabled opacity → distinct pattern + label.
74. [SUBMIT] Loader2 spin has no accessible "working" text → aria-label on transcribing state.
75. [SUBMIT] Stop button during transcribing is disabled with no recourse → "cancel transcription" escape.
76. [SUBMIT] Long-press mic to record (mobile expectation) unsupported → press-and-hold as alternative to tap-toggle.
77. [SUBMIT] Recording while on a phone call interrupts silently → listen to `interrupted` events, toast honestly.
78. [SUBMIT] Bluetooth mic routing ignored → note "using default microphone" with device name when available.
79. [SUBMIT] Transcript edit history lost (no undo) → single undo for server-replace.
80. [SUBMIT] Punctuation commands ("full stop") fail in Hindi/Bengali mode → localized command words ("purn viram", "dari").
81. [SUBMIT] cleanTranscript corrections list missing "principal/principle" context check → already mapped; add "canteen/cantin" variants.
82. [SUBMIT] Number words ("twenty five") not normalized → normalize to digits for room numbers.
83. [SUBMIT] Room/class codes ("2B", "XII-C") misrecognized → domain dictionary entries + test.
84. [SUBMIT] Teacher names never in dictionary → per-school custom words list in settings (admin-editable).
85. [SUBMIT] Speech rate too fast warning absent → if interim chunks arrive fragmented, hint "slower, please".
86. [SUBMIT] No-speech error copy identical for denied-mic vs silent-room → split the two cases (denied handled; silent-room needs "we hear nothing" state from meter).
87. [SUBMIT] Meter "silent" threshold 0.02 arbitrary → calibrate per device after 1s baseline.
88. [SUBMIT] `MAX_UPLOAD_BYTES` mismatch between client speech.ts and server _transcribe.js → single shared constant via API (`/api/transcribe?action=limits`).
89. [SUBMIT] Base64 inflates payload 33%; 90s opus may exceed JSON body cap → chunked upload or direct binary POST.
90. [SUBMIT] Transcribe POST lacks client timeout display → progress states "uploading → transcribing".
91. [SUBMIT] 413 response shows raw KB numbers → friendly "about 90 seconds max".
92. [SUBMIT] 503 degraded path in record-only mode leaves user with empty desc → fall back to "type what you said" prompt with the take attached.
93. [SUBMIT] Voice flow unusable with JS disabled → noscript explanation (low priority, note).
94. [SUBMIT] Poll type switch Yes/No→Single keeps stale options → clear with confirm when options non-empty.
95. [SUBMIT] Option removal shifts focus to body → move focus to next option input.
96. [SUBMIT] Add-option button disappears at 10 with no message → "10 options max" note.
97. [SUBMIT] Expiry presets ignore current expiry value → highlight active preset.
98. [SUBMIT] Linked-post select unsorted → sort by most recent.
99. [SUBMIT] Link selector empty state ("no open complaints") missing → explain + link to submit.
100. [SUBMIT] After linking, no preview of the complaint → inline mini-preview.
101. [SUBMIT] Title placeholder static per type → rotate realistic examples.
102. [SUBMIT] Description placeholder missing → add per-type example.
103. [SUBMIT] Category default "Academics" biases stats → require explicit pick (no default) with validation.
104. [SUBMIT] Tags input lacks format hint → "comma separated, max 6".
105. [SUBMIT] Tag chips preview missing → live chip preview under input.
106. [SUBMIT] Priority selector absent for users (AI-only) → allow manual override with reason.
107. [SUBMIT] Preview mode doesn't render markdown/line-breaks like PostDetail → shared renderer component.
108. [SUBMIT] Preview shows masked or raw text inconsistently with feed → render exactly as server returns.
109. [SUBMIT] Eye-preview toggle loses scroll position → preserve.
110. [SUBMIT] Restricted (banned/suspended) banner shows but form still editable → disable inputs + publish, keep appeal path.
111. [SUBMIT] Suspension end-date formatting ignores locale → Intl.DateTimeFormat.
112. [SUBMIT] Anonymous-ID explanation missing on Submit → one-line "only you know it's yours" already present; add "what admins see".
113. [SUBMIT] Post-submit pushNotif link for polls points to /post/:id → point to /polls#id.
114. [SUBMIT] Double-submit guard relies on `busy` only → disable button + ignore Enter re-submit.
115. [SUBMIT] Enter key in title submits form accidentally → Enter moves to description.
116. [SUBMIT] Cmd/Ctrl+Enter to publish absent → add + hint text.
117. [SUBMIT] Form dirty + navigation away loses state beyond draft (poll options!) → include poll fields in draft.
118. [SUBMIT] Draft saved indicator flickers every keystroke → show only on actual write.
119. [SUBMIT] Two tabs open overwrite drafts → per-tab draft merge by savedAt.
120. [SUBMIT] Voice transcript language tag missing → store lang with draft for admin context.

## FEED, POST DETAIL, REACTIONS, COMMENTS (`src/pages/Home.tsx`, `PostDetail.tsx`, `components/PostCard.tsx`, `Comments.tsx`)
121. [FEED] Skeleton flashes on every realtime refresh → skeleton first load only (verify Home silent path).
122. [FEED] New posts insert at top with layout jump → anchor scroll position on prepend.
123. [FEED] Reaction toggle waits for server round-trip → optimistic toggle with rollback (already? verify + test).
124. [FEED] Reaction counts differ between feed and detail → single source: recount from server after mutation.
125. [FEED] Toggling reaction offline queues then double-applies on flush → never queue toggles (already excluded; add regression test).
126. [FEED] Solved/archived filter chips reset on refresh → persist in URL params.
127. [FEED] Search-within-feed missing → add client filter box for loaded items.
128. [FEED] Infinite scroll retry on failure requires full reload → inline retry button at list end.
129. [FEED] Duplicate posts after realtime + pagination overlap → dedupe by id on merge.
130. [FEED] PostCard image without dimensions shifts layout → aspect-ratio box + blur placeholder.
131. [FEED] Long descriptions clamp without "read more" affordance → consistent 3-line clamp + expand.
132. [FEED] Status pill colors unexplained → legend row (open/in-progress/solved/archived).
133. [FEED] Priority flag visible to all but set by AI → tooltip "set by AI from wording".
134. [FEED] Pinned posts indistinguishable in sort order → "Pinned" ribbon.
135. [FEED] Featured vs pinned semantics overlap → define once in glossary doc + UI copy.
136. [FEED] Relative timestamps never refresh ("5m" stale after 10min) → minute ticker via shared context.
137. [FEED] `timeAgo` future-dates (clock skew) show "in -3m" → clamp to "just now".
138. [FEED] Author "you" badge missing on own posts → "Your post" chip via anonId match.
139. [FEED] Deleted-post tombstones inconsistent (sometimes vanish, sometimes 404) → uniform "removed by moderators" card.
140. [FEED] Hidden posts visible to author with no explanation → "Only you can see this (under review)" banner.
141. [DETAIL] PostDetail 404 conflates deleted vs never-existed vs timeout → distinct copy per case (isNotFound exists; audit all branches).
142. [DETAIL] Admin reply section hidden until reply exists → "no admin reply yet" placeholder with ETA when set.
143. [DETAIL] ETA shown as raw ISO → "expected by Friday" humanization.
144. [DETAIL] Progress bar absent for in-progress posts → progress % from `progress` column.
145. [DETAIL] Merged-into posts dead-end → link to the surviving post.
146. [DETAIL] Linked polls section loads all polls unfiltered → filter by post_id server-side.
147. [DETAIL] Comment box loses text on realtime refresh → controlled input already isolated; verify + test.
148. [DETAIL] Nested replies beyond 2 levels indent off-screen on mobile → collapse to "view thread".
149. [DETAIL] Comment edit window undisclosed → "edited" badge + 15-min window note.
150. [DETAIL] Deleted comments leave "deleted" stubs forever → prune stubs after 7 days (worker).
151. [DETAIL] Comment post button stays enabled during flight → disable + spinner, prevent doubles.
152. [DETAIL] Mention/admin-notify syntax absent → @admin flag for urgent comments (rate-limited).
153. [DETAIL] Report button on post vs comment inconsistent → one ReportDialog component.
154. [DETAIL] Report reasons free-text only → structured reasons + optional detail.
155. [DETAIL] Duplicate report by same user allowed → idempotent per (reporter,target).
156. [DETAIL] Share button copies URL without feedback → "Link copied" toast.
157. [DETAIL] Share uses numeric id exposing sequence → share tokens already? verify; else opaque slugs.
158. [DETAIL] Print stylesheet missing → clean print view for notice boards.
159. [DETAIL] Related posts ("similar complaints") absent → same-category recent 3, dedupe current.
160. [DETAIL] View count absent → anonymous view counter (privacy-safe, no identity).

## POLLS (`src/pages/Polls.tsx`, `PollCard.tsx`, `api/_polls.js`)
161. [POLLS] Countdown per-card 1s interval × N cards → single shared ticker context.
162. [POLLS] Expired polls accept votes during clock-skew window → server authoritative check + honest "just closed" copy.
163. [POLLS] Vote buttons lack optimistic update → instant fill + rollback on error.
164. [POLLS] Double-vote possible via fast double-tap → in-flight guard per poll.
165. [POLLS] Results hidden until vote with no "why" → "vote to see results" explainer.
166. [POLLS] Percentages without voter counts mislead → show both (n=…).
167. [POLLS] Zero-vote polls show 0% bars identically → "no votes yet" empty state per option.
168. [POLLS] Multi-choice max selections undisclosed → "pick up to N".
169. [POLLS] Poll author can vote on own poll → disclose or block per school policy (decide + document).
170. [POLLS] Anonymous vote receipt missing → "your vote is recorded" confirm state.
171. [POLLS] Changing a vote impossible → allow change until expiry, show "vote updated".
172. [POLLS] Closed-poll banner missing → "Closed · final results".
173. [POLLS] Linked complaint context absent on poll card → "linked to: <title>" chip.
174. [POLLS] Poll list has no filter (open/closed/mine) → filter chips + URL params.
175. [POLLS] Poll search missing → title search box.
176. [POLLS] Fraud-quarantined votes silently vanish → "N suspicious votes removed" transparency note.
177. [POLLS] Watch-alert polls show nothing to users → subtle "unusual activity under review" badge.
178. [POLLS] Poll close notifications never sent for linked-post followers → notify on close with results.
179. [POLLS] Expiry timezone confusion (server UTC vs local) → countdown is relative; show absolute local time too.
180. [POLLS] Poll cards in feed vs /polls render differently → one PollCard everywhere.

## INBOX & CHAT (`src/pages/UserChat.tsx`, `api/_inbox.js`, `api/_chat.js`)
181. [INBOX] AI reply wait shows static "typing…" for 30s → staged status ("thinking… → writing…") at 5s/15s marks.
182. [INBOX] No per-message timestamps → group headers by day + time on hover.
183. [INBOX] Long AI replies arrive as one wall → stream tokens (SSE path exists in providers; wire inbox to it).
184. [INBOX] Stream fallback when SSE unsupported → chunked append fallback (already non-stream; verify path).
185. [INBOX] Attachment upload lacks progress → percent bar (upload timeout 30s exists).
186. [INBOX] Image attachments render full-size → thumbnail + lightbox.
187. [INBOX] Attachment types unrestricted client-side → allowlist images only, honest reject.
188. [INBOX] Crisis messages get AI reply but no persistent banner → sticky crisis-resources card per session.
189. [INBOX] Triage note dismisses on next send → persist until read-acknowledged.
190. [INBOX] Handoff state ("admin took over") invisible → "An admin is now replying" banner, AI quiet (server already quiets; surface it).
191. [INBOX] Unread badge count desyncs after realtime → reconcile on focus + on load.
192. [INBOX] Message order inversion under realtime + post race → sort by created_at on merge, stable keys.
193. [INBOX] Failed send loses text → draft preserved already? verify + test the catch path.
194. [INBOX] Retry-send duplicates (non-replayable guard exists) → "check for reply first" copy instead of auto-retry.
195. [INBOX] Emotion agent label ("Support Agent activated") unexplained → tooltip what it means.
196. [INBOX] No conversation export for safeguarding hand-off → admin-side export (never client-side bulk).
197. [INBOX] Thread list (multiple threads?) confusing vs single thread_id=anonId → clarify one-thread-per-user model in UI.
198. [INBOX] Empty inbox has no starter prompts → 3 suggestion chips ("Report bullying", "Ask about…", "Give feedback").
199. [INBOX] Input maxlength silent truncation at 2000 → live counter.
200. [INBOX] Voice input inside chat absent → reuse studio component in chat (shared component extraction first).

## COMMUNITIES (`src/pages/Communities.tsx`, `CommunityDetail.tsx`, `api/_communities.js`)
201. [COMM] 30s/25s polls continue when tab hidden → already visibility-gated; extend to all pollers (audit each).
202. [COMM] Join/leave lacks confirm for large groups → confirm above 100 members.
203. [COMM] Member count stale after join → optimistic +1 with rollback.
204. [COMM] Community avatars emoji-only → allow uploaded icon (reuse upload pipeline).
205. [COMM] Description markdown unsupported → shared renderer.
206. [COMM] Hidden communities discoverable via slug guess → 404-identical response for non-members.
207. [COMM] Deleted community leaves orphan posts → reassign to "General" + audit log.
208. [COMM] Community-scoped post filter missing on detail → tabs All/Problems/Polls.
209. [COMM] Moderator role per community absent → owner + mods with scoped powers.
210. [COMM] Join requires no approval; spam risk → optional approval queue per community.
211. [COMM] No community rules display → rules field + join-time acknowledgment.
212. [COMM] Reporting a community impossible → report flow for groups.
213. [COMM] Community search is substring-only → rank by member count + activity.
214. [COMM] Empty communities list has no create CTA → "Start the first group".
215. [COMM] Slug collisions on similar names → suggest alternatives inline.
216. [COMM] Avatar/photo upload states in Communities lack progress → reuse Submit pattern.
217. [COMM] Admin hide/unhide needs reason → reason field + audit.
218. [COMM] Community detail header image absent → banner slot.
219. [COMM] Pinned community post missing → one pin per community.
220. [COMM] Cross-posting to community + feed duplicates → single post, multi-listing.

## DISCOVER: SEARCH, INSIGHTS, LEADERBOARD, BOARD, SAVED
221. [SEARCH] No typo tolerance ("canteen" vs "cantin") → trigram/pg_trgm or client suggestion.
222. [SEARCH] Empty query submits → disable + hint.
223. [SEARCH] Results lack type icons parity with feed → shared result card.
224. [SEARCH] No recent-searches (privacy-safe local only) → localStorage recents with clear-all.
225. [SEARCH] Search indexes deleted content → exclude deleted/hidden server-side.
226. [SEARCH] Slow search has no progress state → skeleton rows.
227. [SEARCH] No "no results" guidance → suggest related terms + submit CTA.
228. [INSIGHTS] `data.trend.map` crash class (wrong-shape guard exists) → extend guard to every chart dataset.
229. [INSIGHTS] Charts lack text alternatives → data tables toggle for screen readers.
230. [INSIGHTS] Date ranges fixed → 7d/30d/term presets.
231. [INSIGHTS] Numbers without methodology → "how we count" footnotes.
232. [INSIGHTS] Export absent → PNG/CSV export for staff meetings.
233. [INSIGHTS] Realtime refresh resets zoom/filter → preserve chart state across refresh.
234. [INSIGHTS] Slow endpoint lacks staged loading → per-widget skeletons (not one spinner).
235. [LEAD] Leaderboard scoring formula undisclosed → "how points work" page.
236. [LEAD] Gaming via junk posts → rate-limit scoring actions, anti-spam weights.
237. [LEAD] Anonymous leaderboard paradox (names vs anonymity) → display-name model documented + opt-out.
238. [LEAD] Ties share rank incorrectly → dense ranking.
239. [LEAD] Board pagination missing beyond N → cursor pagination.
240. [LEAD] Season reset never happens → term-based seasons with archive.
241. [BOARD] Solving Board vs Suggestions duplication → merge behind filter (backlog P7; decide with school).
242. [BOARD] Card drag (if any) lacks keyboard alternative → buttons for move.
243. [BOARD] Assignee shown as raw id → display name resolution.
244. [BOARD] SLA coloring absent → red/amber by age vs norm.
245. [BOARD] Bulk actions missing → multi-select assign/close.
246. [SAVED] Saved items lack folders/tags → tag filter.
247. [SAVED] Unsave without undo → undo toast 5s.
248. [SAVED] Saved deleted posts linger as dead links → prune with notice.
249. [SAVED] No offline access to saved → cache saved list for offline reading.
250. [SAVED] Export saved list absent → copy-summary for students.

## ADMIN SHELL (`src/pages/Admin.tsx`, login, nav, search)
251. [ADM] 20 tabs overwhelm → group + collapse (groups exist; add counts per group).
252. [ADM] Tab search (⌘K) exists? verify discoverability → hint chip in sidebar.
253. [ADM] Session expiry announces once then drops auth silently → re-login modal preserving tab.
254. [ADM] Login rate-limit copy missing → "N attempts left".
255. [ADM] Password field lacks show/hide → toggle.
256. [ADM] No session list (which devices) → active sessions + revoke.
257. [ADM] Audit trail of admin actions lacks actor identity beyond "admin" → per-admin ids.
258. [ADM] Every tab fetches on mount even when backgrounded → fetch on first visible.
259. [ADM] Tab switch loses scroll/filter state → per-tab state cache.
260. [ADM] Mobile admin nearly unusable (tables overflow) → card layout under 768px for PostsTable/UserManager.
261. [ADM] Dark/light toggle flashes on load → persisted class before paint.
262. [ADM] Toast stack overlaps critical dialogs → priority queue, max 3.
263. [ADM] ErrorTracking vs Logs vs AIFailures overlap → define each tab's question in header copy.
264. [ADM] "Activity Stream" realtime flood → pause + filter controls.
265. [ADM] Settings page lacks unsaved-changes guard → dirty prompt.
266. [ADM] ProviderSettings key paste shows plaintext → password field + masked verify.
267. [ADM] Test-provider button lacks timeout display → show ms + model.
268. [ADM] set_default provider needs confirm → confirm + audit.
269. [ADM] EmailTemplates lack test-send → send-to-self verifier.
270. [ADM] EmailTemplates variable reference missing → {{variables}} cheat-sheet.

## ADMIN TABS: REPORTS, FEED TABLE, USERS, POLLS, INBOX, CATEGORIES
271. [ADM] Reports review queue lacks bulk resolve → multi-select + reason.
272. [ADM] Resolve toast already verified-detail (good) → extend same pattern to dismiss/escalate.
273. [ADM] Report detail hides reporter context from non-admins correctly? verify negative test.
274. [ADM] Reporter notified of outcome never → "your report was actioned" notice.
275. [ADM] False-report abuse unhandled → reporter reputation + admin flag.
276. [ADM] Review tab heavy posts scan unthrottled on entry → throttle + cache 30s.
277. [ADM] LoadFast silent flag exists; verify every realtime tick passes true → audit.
278. [ADM] PostsTable search scans loaded page only → server-side query passthrough.
279. [ADM] Status change lacks optimistic UI → instant pill + rollback.
280. [ADM] Pin/feature/lock toggles need confirm for destructive → confirm on hide/delete only (verify matrix).
281. [ADM] UserManager anon IDs unsearchable → search by display name + partial id.
282. [ADM] Ban/suspend lacks duration presets → 1d/7d/term/permanent + reason required.
283. [ADM] Ban evasion (new anonId) unaddressed → device-fingerprint signal for admins (privacy-reviewed).
284. [ADM] Suspended users see no end date → show until-date (Submit banner exists; mirror in chat).
285. [ADM] PollManager lacks close-now button → immediate close + notify.
286. [ADM] Poll results export missing → CSV for staff.
287. [ADM] UnifiedInbox admin reply lacks canned responses → 5 templates (bullying, facilities, thanks…).
288. [ADM] Inbox SLA per thread invisible → age badge + breach highlight.
289. [ADM] Handoff accept/return flow missing → "take over / release" buttons.
290. [ADM] Categories admin lacks usage counts → posts-per-category + merge tool.

## ADMIN TABS: OPS CENTER, HEALTH, PERFORMANCE, SECURITY, QUALITY, FAILURES, INTEL
291. [ADM] OpsCenter automation rows lack per-run duration history → sparkline of last 8.
292. [ADM] "Run now" lacks confirm for destructive workers (storage reclaim!) → confirm with impact preview.
293. [ADM] Patrol trigger gives no progress → staged status (queued → running → done).
294. [ADM] Verification badges unexplained → tooltip per badge meaning.
295. [ADM] SystemHealth subsystem cards lack last-change timestamps → "as of HH:MM".
296. [ADM] Health score formula undisclosed → breakdown tooltip.
297. [ADM] Degraded subsystem lacks runbook link → per-subsystem "what to do".
298. [ADM] PerformanceCenter lacks endpoint-level p95 table → per-route latency (ties to P1 dashboard item).
299. [ADM] No bundle-size trend → record build KB per deploy, alert +10%.
300. [ADM] SecurityCenter findings lack severity ordering → CVSS-style rank + owner.
301. [ADM] Dependency audit cadence manual → weekly scheduled worker + alert.
302. [ADM] AIQuality unscored-workers section reads as failure → "not yet measured" framing + CTA to run evaluation.
303. [ADM] Scorecard history absent → trend arrows (up/down/flat) per worker.
304. [ADM] Red-team run lacks per-case drill-down → expandable case rows.
305. [ADM] Golden regression failures lack diff view → expected-vs-actual step diff.
306. [ADM] AIFailures lacks grouping (by worker, by error class) → group + counts.
307. [ADM] Failure detail lacks request id correlation → propagate request ids end-to-end.
308. [ADM] Retry-from-failure button missing → one-click rerun with same inputs.
309. [ADM] SafetyIntel lacks time-window selector → 24h/7d/30d.
310. [ADM] Intel export for safeguarding audits → PDF/CSV with redaction.

## COWORKER AGENT-CHAT (`api/_agent-chat.js`, `src/pages/admin/AgentChat.tsx`, `agent-chat/*`)
311. [COW] Natural-language requests fall to intent regex before LLM → reorder: LLM-first always, intents as fallback (verify current order).
312. [COW] Intent misses produce "unknown error" → always a helpful "I didn't get that, try…" with examples.
313. [COW] No conversation memory beyond session → thread-scoped memory with summary compaction.
314. [COW] Long tasks (bulk hide) lack progress → staged updates via polling.
315. [COW] execute_sql allows SELECT only (good) → also cap rows + denylist `pg_*` system tables.
316. [COW] Destructive tools need approval (good) → add dry-run preview ("will hide 3 posts").
317. [COW] Approval cards lack expiry → 10-min expiry with re-propose.
318. [COW] Rejected actions vanish → rejected log with reason.
319. [COW] No undo for executed actions → inverse-action undo for hide/pin/lock (24h window).
320. [COW] Tool catalog rail static → live availability (key present? table exists?) per tool.
321. [COW] Coworker can't see images → attach-image-to-ask with vision model path.
322. [COW] Multi-step goals ("clean up spam + report") lack plan display → plan-then-execute with step checklist.
323. [COW] No voice input in coworker → reuse studio component.
324. [COW] Response streaming absent → SSE tokens for long analyses (provider stream exists; wire it).
325. [COW] Citations missing ("which posts?") → link every claim to post ids.
326. [COW] Hallucinated post ids possible → validate ids against DB before display, drop invalid with note.
327. [COW] Analytics answers lack charts → inline mini-charts for counts/trends.
328. [COW] Scheduled coworker tasks ("remind me daily") absent → cron-note integration.
329. [COW] Coworker accuracy regression vs "PI days" → eval harness: 50 golden admin tasks, weekly score (ties to ai-regression worker).
330. [COW] System prompt versioning absent → version + changelog + rollback.

## WORKERS & AUTOMATIONS (`api/agent-cron.js`, `_automation-registry.js`, worker modules)
331. [WRK] Tick budget deferrals invisible except row text → tick-level "deferred N workers (budget)" banner.
332. [WRK] Deferred workers starve if budget always short → priority rotation, never same worker twice in a row.
333. [WRK] `worker_last_runs` write failure silent → tick-level warning when persist fails.
334. [WRK] Cron overlap (two ticks concurrent) → distributed lock via settings KV with TTL.
335. [WRK] Worker runtime unbounded → per-worker timeout + kill with failed-run record.
336. [WRK] Poll-sweeper notifies authors with no digest → daily digest option per user.
337. [WRK] Notifier double-send on retry → idempotency key per (worker, item, day).
338. [WRK] SLA thresholds hardcoded → admin-editable with audit.
339. [WRK] SLA breach list lacks links → deep-link each item.
340. [WRK] Reopener triggers on any new comment including admin's → exclude admin/system comments.
341. [WRK] Followup pings lack template variety → 3 rotating templates.
342. [WRK] Storage reclaim lacks preview → "would delete N (M MB)" dry-run in UI.
343. [WRK] Orphan detection false-positives on slow uploads → grace period 24h before orphan.
344. [WRK] Trends spike thresholds static → adaptive baseline (4-week median).
345. [WRK] Trend alerts lack "mute topic" → per-topic mute with expiry.
346. [WRK] Anonymity scanner false-positives on common words → allowlist + admin review queue.
347. [WRK] Comment-watch hides without admin review at scale → quarantine queue instead of auto-hide above threshold.
348. [WRK] Upload-intel bucket stats lack trend → week-over-week delta.
349. [WRK] AI-quality snapshot lacks model version dimension → track per (worker, model).
350. [WRK] Drift watch baseline never refreshes → rolling 30-day baseline job.
351. [WRK] Golden workflows hit live DB in prod cron → run against read-only snapshot where possible.
352. [WRK] Red-team suite size hardcoded in tests (already derived; verify all suites derive counts).
353. [WRK] Disable-tests cover consequence per worker (good) → add recovery test (re-enable resumes).
354. [WRK] Workforce patrol 20-45s blocks tick → split patrol into subtask queue with progress.
355. [WRK] Agent spawn requests lack approval → human approve for new-agent creation.
356. [WRK] Spawned agents lack capability sandbox → least-privilege tool subsets.
357. [WRK] Learning-engine weight updates lack bounds → clamp + audit trail.
358. [WRK] Knowledge decay may erase rare-but-critical patterns → pin-list exempt from decay.
359. [WRK] Admin feedback loop lacks "disagree with AI" path → explicit correction records.
360. [WRK] Workforce alerts acknowledge without note → require note for accountability.
361. [WRK] Alert fatigue (too many low-sev) → digest + severity tuning UI.
362. [WRK] Overnight briefing lacks "nothing happened" quiet mode → skip-empty option.
363. [WRK] Briefing timezone fixed → school timezone setting.
364. [WRK] Worker errors lack request correlation → propagate tick id into logs.
365. [WRK] Cron secret rotation unsupported → dual-secret grace window.
366. [WRK] Vercel cron 5-min limit vs 60s function cap → tick must checkpoint/resume (verify + test).
367. [WRK] Missed ticks (deploy downtime) never backfill → catch-up run with bounded scope.
368. [WRK] Worker registry lacks owner + docs link per worker → metadata fields.
369. [WRK] New worker onboarding checklist absent → scaffold + disable-test + audit-entry template.
370. [WRK] `summarize()` default branch for unknown ids → explicit "unmapped worker" text (audit switch coverage).

## SAFETY, MODERATION, APPEALS (`api/_safety-pipeline.js`, `_moderation.js`, `_appeals.js`, `appeal-sla`)
371. [SAF] Spaced/dotted evasion ("s h i t") known gap → boundary-tested detector (precision-guarded; victim text never blocked).
372. [SAF] Mixed-script homoglyphs (сyrillic а) unhandled → confusable mapping pass with tests.
373. [SAF] Zero-width joiners beyond ZWSP family → full Cf-category strip.
374. [SAF] Leet map version drift client/server → single shared map artifact + parity test (exists; verify generation).
375. [SAF] POLICY table edits need redeploy → DB-backed overrides with audit.
376. [SAF] Learned-passthrough poisoning risk → confidence thresholds + admin review of learned allows.
377. [SAF] Fingerprint-idempotent appeals lack collision analysis → document hash + salt scheme.
378. [SAF] 3-open-appeals cap undisclosed to user → "2 of 3 appeal slots used".
379. [SAF] Appeal SLA countdown invisible to filer → show "decision due by <date>".
380. [SAF] Overturn publish path skips pre-publish recheck → re-verify at overturn time.
381. [SAF] Uphold lacks explanation template → reason codes + free text.
382. [SAF] Victim help-channels must never auto-block (policy) → negative test per channel (verify coverage).
383. [SAF] Private inbox masking differs from public feed → parity matrix test.
384. [SAF] Masked text stored vs raw stored ambiguous → document + enforce one rule (raw at insert per _posts.js comment; verify).
385. [SAF] Admins see raw blocked text — access logged? → view-audit for blocked content.
386. [SAF] Profanity list lacks Hindi/Bengali slang → school-specific lexicon with admin UI.
387. [SAF] Slang evolves; list static → quarterly review worker proposing additions (human approves).
388. [SAF] Threat/self-harm detection keyword-only → dedicated classifier lane with crisis resources.
389. [SAF] Crisis response lacks counselor escalation path → fill-in contacts (handover §5) wired into UI.
390. [SAF] Image uploads unmoderated (nudity/violence) → vision moderation lane with hold-for-review.
391. [SAF] Alt-text on images absent → require or auto-suggest.
392. [SAF] Rate-limit bypass via anonId reset → bind limits to device fingerprint + IP composite.
393. [SAF] Cooldown copy identical for spam vs safety → distinct guidance.
394. [SAF] Pre-publish PII hold lacks inline editor → "remove phone" one-tap fix.
395. [SAF] PII detector misses international formats → libphonenumber-grade validation for IN numbers.
396. [SAF] Address detection weak → locality/street-pattern rules + test corpus.
397. [SAF] School-name + class disclosure by minors → minor-safety rule review with school.
398. [SAF] Report-to-takedown latency unmeasured → track report→action hours, alert on breach.
399. [SAF] Repeat-offender (same target bullied) pattern undetected → cross-report linkage worker.
400. [SAF] Evidence preservation for serious reports → immutable snapshot on report.

## API, OFFLINE, TIMEOUTS (`src/lib/api.ts`, `api/index.js`, `_auth.js`, `_error.js`)
401. [API] 15s default still arbitrary per endpoint → per-endpoint budgets table + test.
402. [API] Retry only on GET; idempotent POSTs (poll create with client uuid) could retry safely → idempotency keys.
403. [API] Offline queue flush order LIFO/FIFO undisclosed → FIFO + UI queue viewer.
404. [API] Queue unbounded → cap 50 withEvict-oldest + warning.
405. [API] Queue survives logout? → scope per anonId, purge on reset.
406. [API] 429 auto-retry ≤3s may surprise → "retrying…" indicator on long GETs.
407. [API] Concurrency cap 6 global starves admin + user tabs → per-surface pools.
408. [API] GET cache 5s key ignores admin token → cross-role leak review (verify key includes token).
409. [API] `getSlowFresh` naming confuses → rename to documented tiers (interactive/background).
410. [API] Error parser assumes JSON; HTML error pages throw generic → detect <html> + "server misconfigured" copy.
411. [API] Request IDs absent client→server → `x-request-id` + log correlation.
412. [API] Slow-upload progress missing for images → XHR progress or chunked.
413. [API] `uploadImage` 2MB vs form 3MB mismatch (see #16) → single source of truth.
414. [API] Health endpoint lacks per-dependency timings → supabase/db/llm ms breakdown.
415. [API] Version endpoint absent → client warns on deploy skew ("new version, refresh").
416. [API] API index route table lacks method matrix test → 405 coverage per route.
417. [API] CORS overly permissive? → audit allowed origins for school domain lockdown.
418. [API] Rate-limit headers missing (`X-RateLimit-Remaining`) → expose for smart clients.
419. [API] Body-size 500KB cap returns cryptic error → friendly "too large" with limit.
420. [API] JSON parse errors return 500 → 400 with path hint.

## DATABASE, SCHEMA, MIGRATIONS (`api/migrations/*`, `_db-client.js`)
421. [DB] 001 baseline drift from live (new tables since) → regenerate quarterly + diff CI check.
422. [DB] Legacy cricket/fitness tables still live → drop plan with backup + school sign-off.
423. [DB] Missing 012/015 live → apply-or-document decision with dates (handover blocker).
424. [DB] Migration runner lacks checksum verification → verify-before-apply.
425. [DB] No down-migrations → backward plan per migration.
426. [DB] RLS policies untested → policy test matrix (anon vs admin vs owner).
427. [DB] Service-role key client-side exposure risk → grep + test that anon key only ships.
428. [DB] Connection storms from cron + users → Supavisor pooling verify.
429. [DB] Slow-query log unwatched → weekly review worker.
430. [DB] Unbounded `select("*")` in hot paths → explicit column lists (audit each).
431. [DB] Pagination missing on admin lists → cursor everywhere.
432. [DB] Soft-delete vs hard-delete policy undocumented → per-table rule + purge worker.
433. [DB] `updated_at` triggers absent on some tables → uniform trigger.
434. [DB] Timezone storage mixed (UTC vs local) → UTC everywhere, format at edge.
435. [DB] Settings KV grows unbounded (histories) → trim policies per key (golden history capped; audit rest).
436. [DB] Backup restore never tested → quarterly restore drill + evidence.
437. [DB] Seed data for school pilot missing → anonymized seed script.
438. [DB] Index audit per slow endpoint (see perf skill) → EXPLAIN before/after ledger.
439. [DB] Foreign keys missing on some joins → constraint audit.
440. [DB] Realtime publications include private tables? → publication allowlist review.

## AUTH, SESSIONS, SECURITY
441. [AUTH] Admin token in sessionStorage (XSS-readable) → httpOnly cookie migration plan.
442. [AUTH] No brute-force lockout on admin login → progressive delay + alert.
443. [AUTH] Session expiry 60s-check polling → event-driven refresh.
444. [AUTH] anonId regenerable = ban evasion → noted (#283); decide policy with school.
445. [AUTH] CRON_SECRET in .env committed? → verify git history clean (secrets scan).
446. [AUTH] Service-role key rotation unsupported → rotation runbook.
447. [AUTH] Supabase anon key leaked in repo history? → scan + rotate if ever committed.
448. [AUTH] Admin actions lack MFA → TOTP for admin login.
449. [AUTH] Password policy for admin (env secret) weak → length/complexity rule.
450. [AUTH] Audit log tamper-evident? → append-only + hash chain.
451. [AUTH] XSS: user content rendered as HTML anywhere? → audit dangerouslySetInnerHTML (must be zero).
452. [AUTH] Markdown renderer XSS review → allowlist tags/attrs.
453. [AUTH] Open redirects on login `next` param → allowlist paths.
454. [AUTH] File upload MIME sniffing → verify magic bytes server-side.
455. [AUTH] SVG uploads (XSS vector) → block or sanitize.
456. [AUTH] CSRF on cookie-authed mutations (if migrated) → tokens.
457. [AUTH] Security headers missing (CSP/HSTS) → vercel.json headers + test.
458. [AUTH] Dependency vuln scan manual → CI `audit:security` gate on PR.
459. [AUTH] Secrets in client bundle (grep VITE_) → allowlist VITE_* keys test.
460. [AUTH] Error messages leak internals (table names) → sanitize production errors (sanitizeError coverage).

## PERFORMANCE, BUNDLE, LOADING (frontend-wide)
461. [PERF] Chunk-size warning in build → budget per route + CI gate.
462. [PERF] lucide-react full import per file → verify tree-shaking; central icon module.
463. [PERF] Realtime subscriptions leak on unmount → audit unsubscribe in every useRealtime.
464. [PERF] Realtime 150ms chat debounce + 400ms reports: fine; document the tier table.
465. [PERF] Poll countdown per-card → shared ticker (#161; duplicate intentional cross-ref).
466. [PERF] Feed images unoptimized → Supabase image transform (resize/compress) URLs.
467. [PERF] No `loading=lazy` below fold → audit all <img>.
468. [PERF] Font loading blocks render → font-display:swap + preload.
469. [PERF] Theme flash (see #261) → inline theme script in index.html.
470. [PERF] Confetti library heavy for one effect → lazy-load on first success only.
471. [PERF] Date-fns/lodash-style deps if any → replace with natives (audit bundle).
472. [PERF] Source maps in production → disable for size + security.
473. [PERF] Service worker absent → offline read cache for feed/saved.
474. [PERF] Prefetch on hover for Submit/Polls (see backlog) → implement + measure.
475. [PERF] API waterfall on Home (posts→comments→reactions) → single aggregated endpoint.
476. [PERF] Admin mount fetches all tabs (see #258) → lazy per tab.
477. [PERF] Virtualize long lists (feed/admin tables) → windowing beyond 100 rows.
478. [PERF] Memoize PostCard list (re-renders on typing elsewhere) → React.memo + stable props.
479. [PERF] Context fan-out (AppContext re-renders all) → split contexts by domain.
480. [PERF] Animation jank on low-end Android → reduced-motion default on slow devices (detect via hardwareConcurrency).

## ACCESSIBILITY, I18N, MOBILE
481. [A11Y] Full axe audit per route → ledger with violations + fixes.
482. [A11Y] Focus trap in modals (useFocusTrap exists) → verify every dialog uses it.
483. [A11Y] Skip-link target `#main-content` missing on some pages → audit.
484. [A11Y] Color-contrast failures in dark mode → automated contrast test on tokens.
485. [A11Y] Status conveyed by color alone (pills/dots) → icon + text everywhere.
486. [A11Y] Form errors lack aria-describedby linkage → audit all inputs.
487. [A11Y] Toasts unannounced to screen readers → role=status/alert regions.
488. [A11Y] Countdown timers aria-live spam → aria-live off, manual refresh button.
489. [A11Y] Tables lack captions/scope → admin tables audit.
490. [A11Y] Keyboard trap in mobile drawer → escape + focus return (useFocusTrap covers; verify).
491. [A11Y] Touch targets under 44px (chips, icon buttons) → audit + enlarge.
492. [A11Y] 200% zoom breaks admin tables → card fallback (see #260).
493. [A11Y] Motion sensitivity: global reduce-motion toggle (beyond media query).
494. [A11Y] Language toggle HI/BN for chrome UI (Submit first) → dictionary + persist.
495. [A11Y] Numerals/dates localized (Intl) → audit hardcoded formats.
496. [A11Y] Screen-reader walkthrough of voice studio (live regions) → scripted test with NVDA/VoiceOver notes.
497. [A11Y] alt text for community avatars/emoji → meaningful labels.
498. [A11Y] CAPTCHA absent (good for UX) → ensure rate limits compensate (document).
499. [A11Y] Seizure safety: no >3 flashes/sec animations → audit pulse/shimmer rates.
500. [MOB] Bottom nav missing on mobile (sidebar hidden) → thumb-reach bar with 5 core destinations.
501. [MOB] Pull-to-refresh absent on feed → add with haptic.
502. [MOB] Safe-area insets ignored (notch/gesture bar) → env() padding audit.
503. [MOB] 100vh bug on iOS Safari → dvh units.
504. [MOB] Input zoom on focus (font-size <16px) → 16px minimum on inputs.
505. [MOB] Tap highlight flashes → -webkit-tap-highlight transparent + custom feedback.
506. [MOB] Sticky hover states on touch → hover-gated styles (pattern exists; audit).
507. [MOB] Long-press selects button text → user-select none on controls.
508. [MOB] Horizontal overflow on 320px (tables, code, URLs) → overflow audit per route.
509. [MOB] Chat keyboard covers input → visualViewport resize handling.
510. [MOB] Camera capture for evidence photos → <input capture> option with consent copy.
511. [MOB] PWA installability → manifest + icons + install prompt.
512. [MOB] Offline page (no connection route) → friendly offline shell.
513. [MOB] Data-saver mode → low-res images + no autoplay (no autoplay exists; verify).
514. [MOB] Battery: realtime + intervals drain → backoff when battery saver (navigator.getBattery).
515. [MOB] Share-sheet integration (Web Share API) → native share on post detail.
516. [MOB] Haptics on vote/publish success → navigator.vibrate gated.
517. [MOB] Orientation: admin tables unusable landscape → responsive card rule applies.
518. [MOB] Font scaling (system large text) breaks layouts → rem-based audit.
519. [MOB] Touch drag vs scroll conflicts on board → touch-action rules.
520. [MOB] iOS audio playback requires gesture (take playback ok?) → verify + test.

## NOTIFICATIONS, SETTINGS, PROFILE, ONBOARDING
521. [NOT] Push permission requested too early → request after first publish.
522. [NOT] Notification prefs lack granularity → per-event toggles (reply, status, poll close).
523. [NOT] Quiet hours absent → school-night mute schedule.
524. [NOT] Duplicate notifs after realtime + fetch → dedupe by id on merge.
525. [NOT] Deep links from notifs land on wrong tab → route map test.
526. [NOT] Email notifications absent → opt-in digest (privacy-reviewed).
527. [NOT] In-app notif center pagination missing → cursor paging.
528. [NOT] Mark-all-read lacks undo → undo 5s.
529. [NOT] Notif icons inconsistent → per-kind icon map.
530. [NOT] Sound/haptic toggles absent → settings with defaults off.
531. [SET] Display-name change lacks profanity check → run safety pipeline on names.
532. [SET] Display-name history enables ban evasion tracking → keep hashed history (privacy-reviewed).
533. [SET] Profile photo moderation missing → vision lane (see #390).
534. [SET] Data export (my posts/votes) absent → GDPR-style export.
535. [SET] Delete-my-data absent → anonymize flow with confirm.
536. [SET] Account status (suspended until) shown in one place only → surface everywhere publish is blocked.
537. [SET] Theme setting lacks system-follow → system/light/dark tri-state.
538. [SET] Language setting missing (see #494) → persist + apply to chrome.
539. [SET] Reduce-motion setting missing (see #493) → implement.
540. [SET] Settings lack reset-to-defaults → one-tap reset with confirm.
541. [ONB] First-run tutorial gaps (tour hooks exist) → complete tour for submit/vote/appeal.
542. [ONB] Tutorial skippable but not resumable → resume from help menu.
543. [ONB] Empty-feed first impression bleak → seed welcome post + sample poll (school-approved copy).
544. [ONB] Permissions (mic/notif) asked in context (good) → audit every prompt has a why-string.
545. [ONB] FAQ lacks search → in-page filter.
546. [ONB] Privacy page legalese → student-readable summary + full text.
547. [ONB] Terms acceptance untracked → versioned acceptance for school compliance.
548. [ONB] Accessibility statement page exists? verify + link in footer.
549. [ONB] Status page manual → auto from health checks.
550. [ONB] Changelog manual (see backlog P7) → generate from releases.

## REALTIME, ERRORS, RESILIENCE
551. [RT] Channel names hardcoded per page → central channel registry + test.
552. [RT] Silent-channel recovery exists for chat; verify for posts/polls/comments → matrix test.
553. [RT] Reconnect storm after outage → jittered backoff.
554. [RT] Stale snapshot applied over fresher state → version/timestamp guard on merge.
555. [RT] Realtime auth (private threads) leaks? → channel authz audit.
556. [RT] Presence (who's online) absent → typing indicators in chat.
557. [RT] Admin presence for handoff already server-side; surface staleness ("online 2m ago").
558. [ERR] ErrorBoundary per route exists; fallback lacks retry + report-id → add both.
559. [ERR] Chunk-load failure recovery (retryLazy good) → verify 3-failure terminal UI.
560. [ERR] Fatal boot screen lacks diagnostics copy → build id + timestamp for reports.
561. [ERR] Console.error noise in prod → error reporting pipeline (Sentry-style, privacy-reviewed).
562. [ERR] Unhandled rejection handler absent → global guard + report.
563. [ERR] API 500s lack request ids (see #411) → required for support.
564. [ERR] "Something went wrong" copy everywhere → per-surface honest copy audit.
565. [ERR] Crash loops (same route crashes twice) → safe-mode with minimal UI.
566. [ERR] Corrupt localStorage draft crashes parse → try/catch + quarantine key.
567. [ERR] IndexedDB (if used) version migration → upgrade path test.
568. [ERR] Clock-skew handling (see #137) → central time-guard utils.
569. [ERR] Share-link with invalid id crashes → validated param + friendly 404.
570. [ERR] Deep-link to deleted content → tombstone route (see #139).

## COMMENTS, MODERATION QUEUE, REPORTS PIPELINE
571. [COM] Comment sorting (new/top) missing → toggle with persist.
572. [COM] Pinned comment by admin missing → one pin per post.
573. [COM] Comment character limit undisclosed → counter + cap.
574. [COM] Comment drafts lost on navigation → per-post draft autosave.
575. [COM] @mentions absent (see #152) → decide + implement or close.
576. [COM] Emoji picker absent on desktop → lightweight picker (no heavy dep).
577. [COM] Emoji render inconsistently cross-platform → Twemoji-style? weigh bundle first.
578. [COM] Comment reporting (see #153) → unify dialog.
579. [COM] Auto-moderation of comments mirrors posts? verify pipeline wiring.
580. [COM] Flood control per thread → 3/min with honest wait message.
581. [MODQ] Moderation queue lacks assignment → claim/assign with SLA.
582. [MODQ] Queue lacks filters (type/severity/age) → filter bar + URL state.
583. [MODQ] Bulk actions missing (see #271) → same component as reports.
584. [MODQ] Decision templates (warn/hide/ban + reason) → one-click with audit.
585. [MODQ] Second-eyes rule for bans → dual approval for permanent bans.
586. [MODQ] Action history per item → timeline view.
587. [MODQ] SLA per queue item → breach highlighting.
588. [MODQ] Workload stats per moderator → fairness dashboard.
589. [MODQ] Appeals linked to original decision → two-way navigation.
590. [MODQ] Overturn rate per moderator → calibration review.
591. [REP] Report thresholds auto-escalate? → N reports in 1h auto-flags for review (never auto-hide).
592. [REP] Report spam (mass false reports) → reporter throttling.
593. [REP] Report status visible to reporter → "under review / actioned / dismissed".
594. [REP] Dismissed reports lack reason → reason required, shown to reporter.
595. [REP] Evidence attachments on reports → optional screenshot upload.
596. [REP] Anonymous reporter follow-up impossible → one-time reply token (privacy-designed).
597. [REP] Report categories drift from policy → sync with POLICY table.
598. [REP] School counselor routing for bullying reports → priority lane + contacts.
599. [REP] Mandatory-reporting (abuse) legal path → documented procedure + UI flag.
600. [REP] Report data retention policy → auto-purge resolved after term + audit.

## ANALYTICS, PRIVACY, COMPLIANCE, CONTENT LIFECYCLE
601. [ANL] No privacy-safe analytics → event schema (no identities) + opt-out.
602. [ANL] Funnel tracking absent (submit→publish, speak→transcribe→publish) → voice funnel first.
603. [ANL] Feature usage unknown → per-surface counters to justify More-vs-Core nav.
604. [ANL] Performance RUM absent → web-vitals reporting + dashboard.
605. [ANL] Error counts per surface absent → tie to AIFailures taxonomy.
606. [ANL] School reports (weekly activity) manual → auto-generated staff digest.
607. [ANL] Data retention for analytics → 90-day rollup, raw purge.
608. [PRI] Privacy model documented for staff (handover) → student-facing version.
609. [PRI] Third-party calls (NVIDIA/OpenAI) disclose PII scrub → public note + masking proof.
610. [PRI] Data-processing register for school → table of processors/purposes.
611. [PRI] Consent for AI processing → in-context notice at first AI use.
612. [PRI] Minor-data handling review → legal sign-off checklist.
613. [PRI] Photo EXIF leaks location → strip EXIF on upload server-side.
614. [PRI] Yearbook-style re-identification via writing style → stylometry warning? (opinion; discuss).
615. [PRI] Admin data access logged (see #385) → quarterly access review.
616. [PRI] Export includes other users' data? → scope test.
617. [PRI] Backup encryption at rest → verify provider settings.
618. [PRI] Log retention (server logs with IPs) → 30-day purge policy.
619. [PRI] Cookie audit (none beyond auth?) → publish cookie list.
620. [PRI] Do-not-track honored → respect DNT for analytics.
621. [LIFE] Solved-post verification ("really fixed?") → asker confirms fix, else reopens.
622. [LIFE] Stale open posts (>term) auto-nudge → author confirm-still-relevant.
623. [LIFE] Archive policy undisclosed → "posts archive after X" note.
624. [LIFE] Archived content searchable? → decide + implement consistently.
625. [LIFE] Pinned content expiry → auto-unpin dates.
626. [LIFE] Announcement expiry → auto-retire + history.
627. [LIFE] Poll data retained post-close → retention rule + export-then-purge.
628. [LIFE] Graduating-student data → cohort purge flow.
629. [LIFE] Content backup before purge → export snapshots.
630. [LIFE] Legal hold override → hold flag beats auto-purge with audit.

## TESTS, CI, DOCS, HANDOVER
631. [TST] E2E admin password gate skips 2 tests without env → document + CI secret.
632. [TST] Flaky-timer tests (60s-boundary class) → margin audit across suite.
633. [TST] Module-cache order dependence (getOpsSummary) → isolate or document first.
634. [TST] Mock drift (chain shapes) → contract tests per provider (assist has; extend to inbox/coworker).
635. [TST] Visual regression absent → screenshot baselines for Submit/Admin login.
636. [TST] Performance budgets in CI absent → bundle + timing gates.
637. [TST] A11y tests absent → axe CI on 5 core routes.
638. [TST] Mutation testing for safety pipeline → verify tests actually kill mutants.
639. [TST] Fuzz safety pipeline with generated evasions → nightly fuzz + corpus growth.
640. [TST] Load test for 100+ concurrent users → scripted scenario (feed+vote+poll).
641. [TST] Chaos tests (provider down, DB slow) → scheduled chaos suite.
642. [TST] Migration up/down tested on copy → CI migration round-trip.
643. [TST] Seed + demo script for school pilot → one-command demo data.
644. [TST] Test data factories drift → central factories.
645. [TST] Coverage thresholds unenforced → 80% gate on changed files.
646. [CI] No PR template → checklist (tests, a11y, perf, docs).
647. [CI] No preview deploys for stakeholder review → Vercel preview + seed.
648. [CI] Long frontend suite (170s) → shard or affected-only runs.
649. [CI] Docs drift (counts like "99 tests") → generated numbers in docs via script.
650. [CI] Handover checklist evidence links rot → link-check CI.
651. [DOC] ADRs missing for key decisions (publish-hold, never-queue-timeouts) → write 5 core ADRs.
652. [DOC] Glossary (pinned/featured, solved/archived) → single source.
653. [DOC] Runbooks per worker (see #297) → link from OpsCenter rows.
654. [DOC] Incident postmortem template → docs + first drill.
655. [DOC] School admin manual (non-technical) → illustrated SOPs.
656. [DOC] Parent/student guide → one-page each.
657. [DOC] API reference for future integrators → OpenAPI export.
658. [DOC] Contributing guide for school IT → setup + deploy + rotate keys.
659. [DOC] This ledger: triage cadence → weekly review, promote P1s.
660. [DOC] Changelog discipline (see #550) → release notes per deploy.

## CROSS-CUTTING HONESTY & COPY
661. [COPY] Audit every "unknown error" string → must be impossible (test: grep + allowlist).
662. [COPY] Audit every "failed" without reason → reason-required lint rule.
663. [COPY] Loading states say what's loading ("Loading your inbox…", not spinner).
664. [COPY] Empty states have one action (audit all lists).
665. [COPY] Success toasts say what happened + where to see it.
666. [COPY] Destructive buttons say the consequence ("Hide (reversible)" vs "Delete (permanent)").
667. [COPY] AI-labeled content discloses AI involvement ("suggested by AI", "transcribed by AI").
668. [COPY] Confidence shown where AI guesses (priority, category) → "AI guess" chip.
669. [COPY] Time wording consistent ("just now" <60s everywhere).
670. [COPY] Error copy reading level ≤ grade 8 → audit with students.
671. [COPY] Hindi/Bengali fallback copy for critical errors → translate top-20 strings.
672. [COPY] No blame copy ("you did X wrong") → neutral guidance pass.
673. [COPY] Legal copy reviewed by school → sign-off ledger.
674. [COPY] Emoji in admin professional surfaces → reduce to status icons only.
675. [COPY] Title-case consistency across nav/buttons → style rule.
676. [COPY] "AI" used for rules-based features → label honestly (keyword vs model).
677. [COPY] Deprecation notices 2 weeks before removal → policy + template.
678. [COPY] Maintenance-mode page copy + schedule display → build the page before needed.
679. [COPY] Version footer ("v… · report issues") → feedback loop entry point.
680. [COPY] Offline copy consistent across surfaces → single offline dictionary.

## PROVIDERS, MODELS, COST, LLM OPS (`api/_providers.js`, `ProviderSettings.tsx`)
681. [LLM] Default model choice undocumented rationale → ADR (accuracy vs latency vs cost).
682. [LLM] Reasoning-model budgets (16k tokens) costly → tier by task size (classify small, reply large).
683. [LLM] Temperature/top_p per task untuned → eval sweep on golden tasks.
684. [LLM] PII scrub (maskPII) coverage gaps → adversarial test corpus for scrubber.
685. [LLM] Scrubbed placeholders confuse model → measure quality delta with/without.
686. [LLM] Provider latency leaderboard absent → per-provider p50/p95 + auto-prefer fastest healthy.
687. [LLM] Cost tracking per provider absent → spend dashboard + budget alerts.
688. [LLM] Free-tier congestion forecast absent → time-of-day routing (prefer paid in peak).
689. [LLM] Key rotation without downtime → dual-key overlap support.
690. [LLM] Per-surface model override (inbox=quality, suggest=speed) → config matrix.
691. [LLM] Prompt versioning (see #330) → extend to all prompts, diff view.
692. [LLM] Prompt-injection tests per surface → red-team prompts in CI.
693. [LLM] Jailbreak via transcript text → injection-hardening on voice_complaint path.
694. [LLM] Output validators (JSON schema) per task → strict parse + one retry with correction prompt.
695. [LLM] Max-token truncation mid-JSON → ask-for-shorter retry automatically.
696. [LLM] Language of reply forced English for drafts; chat replies multilingual? → policy per surface.
697. [LLM] Tone controls (formal/friendly) absent → school-approved tone setting.
698. [LLM] Admin canary: route 5% traffic to new model → compare quality before cutover.
699. [LLM] Model sunset watch (llama-3.1-8b 410 lesson) → deprecation probe worker.
700. [LLM] Streaming everywhere (inbox #183, coworker #324) → shared SSE hook + tests.

## ASR & AUDIO PIPELINE
701. [ASR] Whisper-large-v3 only option → fallback model config (distilled for speed).
702. [ASR] Language hint from voiceLang unused server-side? verify mapLanguage coverage (hi-IN/bn-IN ok; add others gracefully).
703. [ASR] Long-audio chunking absent (90s cap) → 30s chunks + stitch for longer takes.
704. [ASR] Speaker diarization absent → "one speaker expected" note; flag multi-speaker.
705. [ASR] Background-noise failure mode silent → SNR check + "move somewhere quieter" hint.
706. [ASR] Profanity in transcript unmasked pre-display? → pipeline parity (spoken abuse still gated at publish).
707. [ASR] Transcript PII (spoken phone numbers) → pre-publish catches; add inline warn earlier.
708. [ASR] Audio retained? retention policy + purge (privacy).
709. [ASR] Take playback speed (see #32) → implement.
710. [ASR] Download-my-take option → user data right.
711. [ASR] Server logs audio bytes? → forbid content logging, log sizes only.
712. [ASR] Provider outage drill → quarterly degraded-mode test.
713. [ASR] Word-timestamps unused → highlight-as-it-plays review mode.
714. [ASR] Confidence scores unused (see #8) → implement when provider returns them.
715. [ASR] Accent bias audit (EN/HI/BN accuracy) → sampled human review.
716. [ASR] Child-voice accuracy (higher pitch) → test with age-diverse samples.
717. [ASR] Low-bandwidth audio degradation → adaptive bitrate hint.
718. [ASR] Duplicate transcription on double-stop (see #44) → idempotency via take hash.
719. [ASR] Cost per minute tracked → budget alert.
720. [ASR] Self-hosted Whisper option for data sovereignty → evaluate + ADR.

## PRE-PUBLISH, MODERATION OPS, TRUST
721. [MOD] Pre-publish adds latency to every submit → move after optimistic accept? (No: safety first — instead show staged progress "checking… → publishing".)
722. [MOD] Staged publish progress UI missing → 3-step indicator.
723. [MOD] Pre-publish result cache for identical resubmits → 5-min cache by content hash.
724. [MOD] False-positive appeal rate tracked → tune thresholds when >5%.
725. [MOD] Borderline content routed to human faster → uncertainty-score fast lane to mod queue.
726. [MOD] Moderator agreement rate (two reviewers sample) → calibration metric.
727. [MOD] Shadow-test new rules (log-only mode) → measure before enforce.
728. [MOD] Rule change audit (who/when/why) → POLICY history.
729. [MOD] Emergency kill-switch per rule → one-click disable with alert.
730. [MOD] School-specific allowlist (event names, teacher names) → admin-managed to cut false positives.
731. [MOD] Context-aware allowances (e.g., "bullying" discussed as topic vs attack) → topic-vs-target classifier.
732. [MOD] Sarcasm/venting vs abuse distinction → guidance + examples for moderators.
733. [MOD] Repeat borderline author coaching → guidance message instead of repeated holds.
734. [MOD] Transparency report (holds/overturns per month) → public school dashboard.
735. [MOD] External audit of safety pipeline → annual third-party review.
736. [MOD] Bias audit (dialects flagged more?) → sampled review by language.
737. [MOD] Minor-safety escalation SLAs → 1h review for bullying/self-harm flags.
738. [MOD] Law-enforcement request procedure → documented + access-controlled.
739. [MOD] Data-subject complaint channel → privacy inbox + SLA.
740. [MOD] Trust score for the platform (public) → publish moderation accuracy quarterly.

## EMAIL, ANNOUNCEMENTS, STATUS, CHANGELOG, TUTORIAL, PALETTE
741. [EML] No transactional email at all → welcome + report-outcome mails (opt-in).
742. [EML] Deliverability (SPF/DKIM) unchecked → verify before first send.
743. [EML] Unsubscribe honored per topic → one-click + audit.
744. [EML] Announcement targeting (all vs admins) → audience selector.
745. [EML] Announcement preview across themes → preview pane.
746. [EML] Scheduled announcements (see #524) → implement.
747. [EML] Emergency broadcast path → tested drill per term.
748. [STA] Status page auto (see #549) → implement from health checks.
749. [STA] Incident history public → log with resolutions.
750. [STA] Subscribe-to-updates → email/RSS for status.
751. [CHG] Changelog generated (see #550/#660) → implement generator.
752. [CHG] Release notes written for humans → student-impact framing.
753. [TUT] Tutorial analytics (drop-off steps) → simplify worst step.
754. [TUT] Contextual help (?) per complex surface → inline coach marks.
755. [TUT] Video walkthrough (2 min) → student-made, subtitled.
756. [PAL] Command palette (Ctrl+K) scope limited → add cross-surface actions (go, do).
757. [PAL] Palette fuzzy matching quality → rank recents first.
758. [PAL] Palette accessibility (aria-activedescendant) → audit.
759. [PAL] Palette discovers coworker tools → unified "ask/do" entry.
760. [PAL] Mobile palette entry point → floating action.

## ENGAGEMENT, STREAKS, EVENTS, CALENDAR
761. [ENG] Streaks reward volume over value → streak counts only published (not held) posts.
762. [ENG] Streak repair (missed day) absent → one repair per month via quality action.
763. [ENG] Badges lack criteria display → criteria per badge.
764. [ENG] Badge spam devalues → cap 1 badge/day.
765. [ENG] Helpful-vote on comments missing → "helpful" reaction with weight.
766. [ENG] Thank-you notes (asker→solver) absent → one-tap thanks with notice.
767. [ENG] Solver leaderboard gaming (see #236) → helpful-votes weight more than posts.
768. [ENG] Weekly highlights digest → top solved + upcoming polls.
769. [ENG] Digest unsubscribe → one-click.
770. [ENG] Event announcements as posts clog feed → event type with date/location.
771. [ENG] Event RSVP missing → yes/maybe/no counts.
772. [ENG] Event reminders → 24h + 1h notices.
773. [ENG] Past events linger → auto-archive + outcomes post.
774. [ENG] Calendar view absent → month view of events/poll expiries.
775. [ENG] Exam timetable integration → read-only dates feed (school provides).
776. [ENG] Holiday calendar awareness → posting prompts pause on holidays.
777. [ENG] Club directory (communities extension) → meeting times + join.
778. [ENG] Lost-and-found board → item type with claim flow.
779. [ENG] Timetable-change notices → pinned + push.
780. [ENG] Transport-delay alerts → route-tagged posts with priority.
781. [ENG] Canteen menu posts → weekly menu type with voting (likes per dish).
782. [ENG] Menu allergen flags → structured allergen tags.
783. [ENG] Library new-arrivals → librarian post type.
784. [ENG] Sports tryout signups → capped RSVP with waitlist.
785. [ENG] Volunteer drives → signup + hours tracking.
786. [ENG] Fundraiser transparency → goal bar + expense log.
787. [ENG] Suggestion-to-project pipeline → accepted suggestions become tracked projects.
788. [ENG] Project status board (extends solving board) → milestones + owners.
789. [ENG] Alumni view (read-only inspiration) → graduated-cohort showcase.
790. [ENG] Parent view (summaries only, no identities) → weekly digest.
791. [ENG] Teacher view (their classes' themes) → aggregated, never per-student.
792. [ENG] Counselor view (flagged wellbeing only) → strict access + audit.
793. [ENG] Principal dashboard (school health) → trends + SLA + counts.
794. [ENG] Class-rep toolkit (poll templates, meeting notes) → template library.
795. [ENG] Meeting-notes post type → decisions + action items.
796. [ENG] Decision log (what changed + why) → public accountability list.
797. [ENG] Petition mode (signatures toward threshold) → threshold + admin response SLA.
798. [ENG] Petition signature privacy → counts only, no name list.
799. [ENG] Duplicate petition detection → similarity check at creation.
800. [ENG] Petition delivery tracking → "presented to X on <date>".

## INTEGRATIONS, IMPORT/EXPORT, INTEROP
801. [INT] Google Classroom share → share-to-classroom button.
802. [INT] School website embed (latest solved) → oEmbed widget.
803. [INT] RSS feeds per category → public read-only feeds.
804. [INT] Email-to-post gateway (moderated) → post-by-email with token.
805. [INT] SMS alerts for critical (opt-in) → gateway + budget.
806. [INT] WhatsApp channel (school uses it) → broadcast + reply mapping; privacy review.
807. [INT] UPI-style simple identity for events? out of scope → note as rejected with reason.
808. [INT] Calendar export (ICS) for events → per-event download.
809. [INT] SIS roster import (classes/sections) → CSV import with dry-run.
810. [INT] Timetable import → structured schedule ingestion.
811. [INT] Library catalog link-out → deep links per book post.
812. [INT] Transport GPS link-out → live bus link field.
813. [INT] Fee-portal link-out (no data sharing) → plain link slot.
814. [INT] Grievance-portal escalation handoff → export pack with consent.
815. [INT] State-board compliance reports → formatted export.
816. [INT] Data warehouse export (anonymized) → term snapshots for research.
817. [INT] API for school IT (read-only keys) → scoped tokens + rate limits.
818. [INT] Webhooks for new urgent reports → signed delivery + retry.
819. [INT] SSO (Google Workspace for Education) → admin/staff login option.
820. [INT] Student SSO excluded by design (anonymity) → document the decision.

## DATA MODEL, ANTI-ABUSE, TRUST GRAPH
821. [DAT] Post types fixed (problem/suggestion/poll) → extensible type registry.
822. [DAT] Custom fields per type (event date, item photo) → schema extension plan.
823. [DAT] Tag taxonomy unmanaged → admin tag garden (merge/rename/blacklist).
824. [DAT] Category sprawl → usage-based prune suggestions.
825. [DAT] Duplicate detection thresholds untuned → precision/recall review on labeled set.
826. [DAT] Similarity index (pg_trgm) missing → add + measure.
827. [DAT] Full-text search dictionary (english + custom) → stopwords + synonyms (canteen/mess).
828. [DAT] Vote uniqueness constraint (one vote per user per poll) → DB constraint, not just app logic.
829. [DAT] Reaction uniqueness per user/post/kind → constraint.
830. [DAT] Report uniqueness (see #155) → constraint.
831. [DAT] Bookmark uniqueness → constraint.
832. [DAT] Membership uniqueness → constraint.
833. [DAT] Counter caches (votes/comments counts) drift → reconcile worker.
834. [DAT] Hot-post ranking formula absent → time-decayed score + transparency note.
835. [DAT] Controversial-sort (many votes, split) → flag for mod attention, not promotion.
836. [ABU] Brigading detection (coordinated votes) → velocity + account-age signals.
837. [ABU] Sockpuppet signals (same device, many ids) → privacy-reviewed risk score.
838. [ABU] Vote-buying ("vote for me" posts) → solicitation rule + detection.
839. [ABU] Harassment-by-poll (targeted options) → pre-publish poll-target check.
840. [ABU] Doxxing via jigsaw (pieces across posts) → cross-post linkage review queue.
841. [ABU] Image-based abuse (memes targeting student) → image report fast lane.
842. [ABU] Impersonation (staff names as display names) → reserved-name list + verification badge.
843. [ABU] Verification badges for staff → admin-issued, visible, revocable.
844. [ABU] Scam links in posts → URL reputation check + warning interstitial.
845. [ABU] URL preview cards fetch SSRF risk → fetcher sandbox + timeout + allowlist.
846. [ABU] Shortened-URL hiding → expand + show destination domain.
847. [ABU] Mass-mention spam (if mentions built) → mention rate limits.
848. [ABU] API scraping (enumeration of ids) → rate limits + gapless-id review.
849. [ABU] Timing attacks on anonId matching → constant-time compare where needed.
850. [ABU] Re-identification via timestamps → fuzz displayed times to 5-min buckets.
851. [ABU] Small-community anonymity (5 members) → minimum-group-size warnings.
852. [ABU] Writing-style fingerprinting awareness → optional paraphrase assist.
853. [ABU] Metadata in exports (author ids) → scrub rules per export type.
854. [ABU] Admin stalking (repeated views of one user) → access-pattern alerts.
855. [ABU] Staff misuse reporting channel → independent review path.
856. [ABU] Appeal-bombing (3-cap exists) → cap tuning by abuse signals.
857. [ABU] Report-then-delete evidence loss (see #630) → snapshot holds.
858. [ABU] Edited-post evasion (post clean, edit in abuse) → re-moderate on edit + version diff.
859. [ABU] Edit-window abuse (see #149) → re-check after window closes for high-risk.
860. [ABU] Comment flooding (see #580) → thread-level limits verified.

## SCALING, COST, OBSERVABILITY, DR, PILOT
861. [SCL] Single-region deployment → multi-region read plan (costed).
862. [SCL] Realtime fan-out costs at 1000+ concurrent → load test + budget.
863. [SCL] Cron tick serializes all workers → parallel lanes with locks (see #334).
864. [SCL] LLM spend ceiling → monthly cap + graceful degradation order.
865. [SCL] ASR spend ceiling (see #719) → cap + local-backbone notice.
866. [SCL] Storage growth (images/audio) → lifecycle rules + quotas per school.
867. [SCL] Bandwidth (image serving) → CDN + transforms (see #466).
868. [SCL] DB connection ceiling (serverless × Supabase) → pooler verify (see #428).
869. [SCL] Rate-limit tuning per endpoint from traffic data → quarterly review.
870. [SCL] Abuse-cost attacks (forcing LLM spend) → per-user AI quotas.
871. [SCL] Cache-hit ratio dashboard → target >40% on suggest endpoints.
872. [SCL] Edge caching for public feed → CDN with 30s TTL + purge on write.
873. [SCL] Read replicas for analytics → separate insights queries.
874. [SCL] Tenant model for multi-school → schema plan before second school.
875. [SCL] Feature flags per school → flag service + admin UI.
876. [OBS] Structured logs everywhere (console.log audit) → logger + levels.
877. [OBS] Log sampling for high-volume paths → sample + keep errors full.
878. [OBS] Trace ids end-to-end (see #307/#411) → verify propagation in 3 flows.
879. [OBS] Alert routing (who gets paged) → roster + escalation delays.
880. [OBS] Alert fatigue guard → alert only on symptoms, not causes.
881. [OBS] Uptime SLO published (99.5%?) → measure + status page (see #548).
882. [OBS] Error budget policy → freeze features when burned.
883. [OBS] Deploy markers in metrics → correlate regressions to releases.
884. [OBS] Synthetic monitoring (login→submit→vote script) → 5-min probe + alert.
885. [OBS] Real-user monitoring (see #604) → implement + dashboard.
886. [OBS] LLM quality monitoring (golden tasks weekly) → coworker eval (see #329).
887. [OBS] Moderation quality monitoring (see #724) → implement.
888. [OBS] Cost anomaly alerts → daily spend delta pages.
889. [OBS] Security event alerting (ban waves, key failures) → SIEM-lite rules.
890. [OBS] Quarterly observability review → prune noisy alerts.
891. [DR] Backup tested (see #436) → implement drill now.
892. [DR] Point-in-time recovery RTO/RPO defined → document + test.
893. [DR] Provider outage playbook (LLM down) → local-backbone mode announcement.
894. [DR] DB outage playbook → read-only degraded mode.
895. [DR] Auth outage playbook → admin break-glass procedure.
896. [DR] Hosting outage playbook → status comms template.
897. [DR] Data-export for migration away → no-lock-in guarantee + tested export.
898. [DR] Key-compromise playbook → rotate-in-minutes runbook (NVIDIA, Supabase, cron).
899. [DR] Incident commander roster → named humans per term.
900. [DR] Blameless postmortem culture → template + first drill (see #654).
901. [PIL] Pilot success criteria defined → activation, publish-rate, resolution-rate targets.
902. [PIL] Pilot cohort (2 classes) → onboarding sessions + champions.
903. [PIL] Feedback channel during pilot → in-app + weekly review.
904. [PIL] Go/no-go decision date → calendar + criteria.
905. [PIL] Rollback plan for pilot → disable + communicate template.
906. [PIL] Training for moderators → workshop + handbook (see #655).
907. [PIL] Training for counselors (wellbeing lane) → protocol + contacts.
908. [PIL] Parent information evening → deck + FAQ.
909. [PIL] Student launch assembly → demo + code-of-conduct.
910. [PIL] Launch-day war room → roster + triage board.
911. [FDB] In-app feedback widget (see #679) → build + triage SLA.
912. [FDB] Feedback taxonomy (bug/idea/abuse-report) → route correctly.
913. [FDB] Public roadmap (planned/building/done) → trust through visibility.
914. [FDB] Changelog-linked roadmap items → auto-update on release.
915. [FDB] Voter (poll) on feature priorities → termly prioritization poll.
916. [FDB] Beta-tester group (student volunteers) → early access + recognition.
917. [FDB] Usability testing per term (5 users, 3 tasks) → findings ledger.
918. [FDB] Accessibility testing with disabled students → include in panel.
919. [FDB] Moderator feedback loop (tool pain) → monthly review.
920. [FDB] Teacher feedback loop (classroom impact) → termly survey.
921. [FDB] This ledger's own review cadence (see #659) → first review date set.

## COWORKER AUTONOMY & TRUST (Jarvis-grade, phased honestly)
922. [JAR] Phase 1 (now): coworker proposes, human approves — already built; measure approval rate.
923. [JAR] Phase 2: auto-execute allowlisted safe tools (get_*, search, summarize) without approval → explicit allowlist + audit.
924. [JAR] Phase 3: auto-execute reversible tools (hide/pin/lock) with instant undo → undo window + alert.
925. [JAR] Phase 4 (never without school sign-off): irreversible tools stay approval-only forever → policy doc.
926. [JAR] Autonomy level indicator in UI ("assisted" vs "supervised") → always visible.
927. [JAR] Per-tool autonomy setting → admin configures which tools auto-run.
928. [JAR] Time-boxed autonomy ("act alone during night patrol") → schedule + scope limits.
929. [JAR] Spending limits for agent actions (LLM calls per task) → budget + cutoff.
930. [JAR] Blast-radius limits (max items per auto-action) → e.g., hide ≤5 without approval.
931. [JAR] Anomaly halt (auto-actions spike) → circuit breaker + human review.
932. [JAR] Full action journal (who/what/why/reversible) → exportable.
933. [JAR] Weekly autonomy report ("I did X alone, Y with you") → digest.
934. [JAR] Mistake bounty (report wrong auto-action) → one-tap flag + fast undo.
935. [JAR] Simulated autonomy (dry-run log of what it WOULD do) → review before enabling.
936. [JAR] Red-team the coworker (malicious instructions in posts) → prompt-injection suite.
937. [JAR] Instruction hierarchy (system > admin > post content) → enforcement tests.
938. [JAR] Data exfiltration guard (coworker pasting PII) → output scrubber.
939. [JAR] Session hijack guard (another admin's pending approvals) → owner binding.
940. [JAR] Approval delegation (cover my leave) → time-bound delegate with scope.

## FINAL SWEEP: SMALL, SHARP, OFTEN-MISSED
941. [FIN] Favicon + PWA icons missing variants → full set.
942. [FIN] Title tags per route ("Submit · Voice Flow") → SEO + tab clarity.
943. [FIN] Meta descriptions per public route → sharing previews.
944. [FIN] OG images for shared posts → generated cards.
945. [FIN] 404 page helpful (search + home links) → audit.
946. [FIN] 500 page with report id (see #558) → verify.
947. [FIN] Maintenance page (see #678) → build now, not during outage.
948. [FIN] Browser support list published → test oldest supported.
949. [FIN] Console warnings to zero in prod → CI check.
950. [FIN] Dead-code sweep quarterly (knip-style) → ledger entry.
951. [FIN] TODO/FIXME comment triage → convert or delete monthly.
952. [FIN] Commented-out code removal → delete unconditionally.
953. [FIN] Duplicate utilities (timeAgo × N) → single module audit.
954. [FIN] Magic numbers to named constants → audit (timeouts, limits, thresholds).
955. [FIN] Env var documentation complete → table in DEPLOY-SCHOOL (verify each).
956. [FIN] Default values safe when env missing → fail-closed for secrets, fail-open never.
957. [FIN] Log redaction of keys (maskKey pattern) → audit every logger call.
958. [FIN] Test runtime (170s frontend) → shard (see #648).
959. [FIN] Flaky-test quarantine process → label + fix SLA.
960. [FIN] Docs screenshots current → refresh per term.
961. [FIN] README quickstart works from zero → test on fresh machine yearly.
962. [FIN] License + contribution terms for school IT → add.
963. [FIN] Third-party attributions → credits page.
964. [FIN] Cookie banner only if cookies used (see #619) → implement conditionally.
965. [FIN] "Report a bug" footer link → prefilled template with build id.
966. [FIN] "Suggest a feature" footer link → routes to suggestions with tag.
967. [FIN] Keyboard shortcuts help modal (press ?) → shortcut map.
968. [FIN] Onboarding checklist per new admin → interactive guide.
969. [FIN] Admin profile (name for audit) → display identity in journal.
970. [FIN] Staff directory (who moderates what) → internal page.
971. [FIN] Shift handover notes (mod to mod) → shared log.
972. [FIN] Escalation matrix printable → one-page PDF.
973. [FIN] Term rollover checklist → archive, reset seasons, rotate champions.
974. [FIN] Year-end impact report (resolved X, polls Y, SLA Z) → auto-generated.
975. [FIN] Celebration of solvers (assembly slide) → export top helpers (opt-in).
976. [FIN] New-term seeding (fresh categories?) → review taxonomy yearly.
977. [FIN] Archival ceremony (old year, read-only) → yearbooks of change.
978. [FIN] Sunset policy for dead features (see #677) → apply to first candidate.
979. [FIN] Competitive review yearly → 3-school benchmark.
980. [FIN] Tech radar (framework upgrades React/Vite) → upgrade cadence.
981. [FIN] Node version pinning + upgrade test → CI matrix.
982. [FIN] Lockfile hygiene → audit unused deps quarterly.
983. [FIN] Container image scanning (if docker used) → add to pipeline.
984. [FIN] Supply-chain (Socket-style) review for new deps → policy.
985. [FIN] Reproducible builds → lock + verify.
986. [FIN] Feature-flag cleanup (expired flags) → quarterly purge.
987. [FIN] Dark-mode token audit (new UI must tokenize) → lint rule.
988. [FIN] Motion-token audit (no raw durations) → lint rule.
989. [FIN] Spacing-token audit (no raw px) → lint rule.
990. [FIN] Copy-style lint (sentence case, grade-8) → review checklist.
991. [FIN] Analytics event naming convention → schema doc + test.
992. [FIN] Error-code catalog (VB-1001…) → stable codes for support.
993. [FIN] Support macros for common issues → 10 canned answers.
994. [FIN] Status-history hygiene (bounded arrays) → cap everywhere.
995. [FIN] Notification text length caps → truncate + test.
996. [FIN] Pagination default/limit caps → uniform 20/100.
997. [FIN] Sort-order defaults documented per list → newest first unless stated.
998. [FIN] Empty-search-query behavior uniform → all surfaces same rule.
999. [FIN] "All caught up" states (inbox/notifs empty) → celebratory copy.
1000. [FIN] Ledger hits 1000 → triage party: promote top-20 to P1 with owners and dates.

---
*Count: 1000 numbered items. Ledger is append-only — new items continue at 1001 with the same one-line format. Triage weekly; promoting an item means owner + date + evidence, never just a checkmark.*
- **LEDGER BATCH 1 (user: implement the recommended fixes).** Shipped 12 ledger items with tests: #4 voiceLang persistence, #22 masked appeal preview, #129 feed dedupe, #137 timeAgo future-clamp, #167 zero-vote state, #193 inbox draft-restore-only-if-unsent (+ fixed my own regression: send-failure detection still matched the old 8s timeout copy), #661 bare-"unknown error" purge across 7 client sites + summarize() reason-chain, #663 PageFallback accessible label, plus errorText unification (api/Home/PollCard/Overview/OpsCenter/ErrorTracking). Caught and repaired two self-inflicted test-header clobbers during editing (verified by re-read + green runs, not assumed). Full battery: API 112/1277 · frontend 84/1380 · typecheck 0 · lint 0.

