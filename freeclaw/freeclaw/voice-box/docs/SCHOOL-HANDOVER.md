# School operator guide (handover)

Who this is for: the 1–3 staff members who own Voice Box day to day
(school counselor, IT coordinator, discipline head). No coding needed.

## 1. Roles

| Role | Powers | Who holds it |
|---|---|---|
| Admin | review queues, appeals decisions, strikes/bans, ops center, kill switches | named staff only (keep the list in §6) |
| Anonymous user | post, comment, vote, poll, appeal a block | every student (no accounts exist by design) |
| System | automated sweeps every 5 min (moderation, SLA, integrity) | nobody — runs itself, admins supervise |

Admin login: `/admin` with the school passphrase (in the password
manager). Sessions expire; `revoke_all_sessions` in Admin → Settings
signs every admin device out instantly (use when staff changes).

## 2. Daily routine (5 minutes)

1. Open **Ops Center** → "What needs attention": only act on red items;
   everything routine resolved itself overnight.
2. Open **Reports → AI Review**: clear the appeals queue (uphold or
   overturn with a note — the author is notified either way) and the
   pre-publish queue.
3. Skim **Safety / Security** desks for overnight incidents.

## 3. Weekly routine (20 minutes)

1. **Reports → Reports tab**: resolve or escalate anything older than 7
   days (the report-sla worker already escalated breaches — don't let
   them sit).
2. **AI Quality**: check pass rate and drift; a sudden dip means new
   slang or a new abuse pattern — add it to the evaluation notes.
3. **My Board / PulseStrip**: confirm volume looks normal for a school
   week (holidays read as drops; that's fine).

## 4. Moderation + appeals workflow

- Blocked content shows the author **why** (exact message) and an
  **appeal panel**. Appeals land in AI Review with the author's case.
- **Uphold** = block stands (author gets guidance to rephrase).
- **Overturn** = content publishes immediately and the safety
  fingerprint is cleared so it won't be re-blocked.
- Victim reports that quote abuse to ask for help are **held for human
  review, never auto-blocked**. Treat them as protection requests first.
- Strikes follow the ladder (3-in-7-days → suspension, 6 → ban). The
  system notifies the affected user with the rule and count every time.

## 5. Escalation — read this before launch

The platform detects, but **people protect**. For any content involving:

- **Child safety / grooming / sexual exploitation of a minor** → follow
  the school's safeguarding policy immediately (designated counselor +
  statutory reporting where required). Preserve evidence: do NOT delete
  the content before authorities advise — use Restrict/Quarantine and
  export the evidence pack from the report.
- **Credible threats of school violence / self-harm** → school emergency
  procedure first, platform action second.
- **Criminal fraud, extortion, doxxing of staff** → school leadership +
  law enforcement as policy requires.

Fill in the school's contacts here:

- Designated safeguarding lead: _______________ ext: ____
- Counselor on call: _______________ ext: ____
- Local police non-emergency: _______________
- Platform technical contact: _______________

## 6. Data, privacy, anonymity

- Students are anonymous IDs stored **only in their own browsers**. The
  server never sees names, emails, phones, IPs for attribution, or
  device fingerprints.
- Safety blocks anything that looks like personal data (addresses,
  phones, emails, IDs) before it can publish — on every surface.
- Admins see report/evidence content only inside the review queues.
- Retention: evidence packs and audit rows are operational records;
 auth sessions expire automatically. To erase a student's footprint on
  request, delete their content via Reports (admin) — there is no
  account to delete because none exists.
- Never copy student content (especially images) out of the admin
  console into email/chat. Review it where it lives.

## 7. Incidents (the site is down / slow / wrong)

1. Status page / Ops Center health cards: is it the app, Supabase, or
   Vercel? Each card names its probe.
2. Recent deploys: Vercel → promote the previous build (2 clicks,
   `docs/ROLLBACK.md`).
3. Revoke-and-rotate if you suspect the admin secret leaked: change the
   passphrase → update `ADMIN_SESSION_SECRET_SHA256` in Vercel →
   `revoke_all_sessions`.
4. After any incident: write a 5-line note (what, impact, cause, fix,
   prevention) in the school's logbook. The on-call engineer turns
   repeat failures into regression tests.

## 8. Staff changes

- Joiner: share the passphrase via the password manager, never chat/email.
- Leaver: change the passphrase, update Vercel, `revoke_all_sessions`,
  update the contacts in §5.
- Quarterly: rotate the passphrase even if nothing happened.

## 9. What the system does alone (do not do manually)

Retrying failed notifications, re-filing dead searches as knowledge
gaps, closing expired polls, purging stale sessions, reconciling
counts, escalating SLA breaches, scoring AI quality, running the 5-min
health tick. If you find yourself doing any of these by hand, report it
as a bug — the automation is supposed to own it.
