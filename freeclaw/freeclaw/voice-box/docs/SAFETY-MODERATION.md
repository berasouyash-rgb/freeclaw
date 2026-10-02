# Voice Flow 2.0 — Safety & Moderation Specification

Status: **Spec (briefed, not yet built).** This document captures the expanded safety /
content-moderation system the product owner briefed, sourced from Ofcom / eSafety
expectations for a user-generated-content platform. It is **deliberately NOT part of
Batch B1** — it is the contract that later batches build against, above all:

| Safety theme | Owning worker(s) | Batch |
|---|---|---|
| Content Moderation (#22), Abuse Detection (#23) | the 19-category detection + enforcement ladder | **B4** |
| Data Exposure Protection (#39) | PII/OTP/key/card detection & masking | **B7** |
| Security Operations (#36), Authorization Protection (#37) | malicious links, cyber abuse, insider/privilege | **B6 / B7** |
| AI Red-Team (#26) | adversarial probes against this classifier | **B5** |
| Admin Briefing (#18) | the **🤖 AI ACTION VERIFIED** proof surface | **B3** |

The roster and batch plan live in [`docs/WORKFORCE-50.md`](./WORKFORCE-50.md). This file is
the authoritative safety contract referenced from the roster.

---

## 1. Principles (non-negotiable)

1. **Proactive, not report-only.** Detection runs continuously *before* a human report
   arrives; a report is corroboration, never the trigger.
2. **Deterministic first, AI second.** Heuristics/allow-lists decide the unambiguous cases;
   the LLM is used only for contextual / coded ambiguity and **always with a deterministic
   fallback** when AI is unavailable.
3. **Anonymity outranks polish.** Detection must never de-anonymize a protected reporter,
   whistle-blower, or survivor. Identity exposure is itself a harm (category #1).
4. **Never blanket-delete.** A wrong removal is a harm too. The default for uncertainty is
   quarantine + review, not removal. See §4 enforcement ladder.
5. **Specialized infra for child safety.** The general-purpose LLM must **never** inspect,
   store, reproduce, or summarize CSAM. Child-safety signals route to a dedicated,
   access-controlled pipeline with defined escalation (§5).
6. **Evidence-bound actions.** Every serious enforcement act is independently verified and
   surfaced in the proof UI (§7). No "success" without a re-read.
7. **Safety systems are not B1 work.** Nothing in this document ships in Batch 1. Building
   it is owned by the batches in the table above.

---

## 2. The 19 detection categories

The brief groups some harms together; where the correct *response path* differs they are
split below. Each category names real signals, the intended response, and where a worker
will live.

| # | Category | Representative signals | Primary response | Worker / batch |
|---|---|---|---|---|
| 1 | **Personal information & privacy exposure** | addresses, phone numbers, government IDs, OTP/2FA codes, API keys/tokens, bank & card numbers, passwords, doxxing of a person or their family | hide/remove + notify owner; mask in transit | #39 Data Exposure (B7), #22 (B4) |
| 2 | **Blackmail, extortion & sextortion** | demands for money/payment under threat of releasing intimate material; "I have your photos" | specialized workflow + restrict + security escalation; never auto-close | #23 (B4) |
| 3 | **Threats & violence** | credible threats to a named person/group; planning or inciting violence; "I will find you" | credible → restrict + security workflow + preserve evidence | #23 (B4) |
| 4 | **Harassment, bullying & stalking** | sustained targeting, slurs aimed at a person, unwanted repeated contact, coordinated pile-ons | context-dependent restrict/remove; protect the target | #23 (B4) |
| 5 | **Child safety** *(dedicated)* | grooming, adult↔minor contact, requests for sexual images, attempts to move a minor off-platform, age-misrepresentation for sexual contact | **specialized high-severity pipeline only** (§5) | #23 (B4), dedicated infra |
| 6 | **Sexual & intimate-image abuse** | non-consensual intimate imagery, deepfakes, cyberflashing, "leaked"/"exposed" content | hide/remove + preserve + survivor-support path | #22 (B4), #39 (B7) |
| 7 | **Hate & discrimination** | attacks on protected characteristics (race, religion, caste, gender, sexuality, disability, nationality) | remove/reduce reach on severity; context-aware for reclaimed/educational use | #22 (B4) |
| 8 | **Self-harm & suicide** | ideation, methods, encouragement/instruction | **supportive response** (crisis resources, check-in), not blanket deletion; escalate only on live-risk signals | #22 (B4), #18 (B3) |
| 9 | **Dangerous content & risky challenges** | dangerous "challenges", instructions for serious self-injury, viral harm trends | age-gate / remove by severity; never amplify | #22 (B4) |
| 10 | **Fraud & scams** | fake giveaways, investment/"guaranteed returns", job/placement scams, romance scams, phishing-for-money | remove + block links + warn users | #23 (B4) |
| 11 | **Malicious links & cybersecurity** | phishing/malware URLs, credential-harvesting, keyloggers, exploit kits | neutralize/block links, quarantine, security escalation | #36 Security Ops (B6) |
| 12 | **Drugs** | sale/sourcing of controlled substances, dosing/instruction | remove + escalate where illegal sales | #22 (B4) |
| 13 | **Weapons & dangerous goods** | sale/trafficking of weapons, explosives, precursors, banned items | remove + escalate on illegal sale | #22 (B4) |
| 14 | **Terrorism & violent extremism** | propaganda, recruitment, incitement, glorification | immediate quarantine + escalation | #23 (B4), #36 (B6) |
| 15 | **Animal cruelty** | graphic abuse, promotion, "how to" harm to animals | remove/reduce reach | #22 (B4) |
| 16 | **Manipulation & deception** | coordinated inauthentic behaviour, impersonation, astroturfing, fabricated claims presented as fact | reduce reach / label / review | #23 (B4) |
| 17 | **Spam & platform abuse** | bulk/duplicate posting, engagement farming, bot floods, ban-evasion | rate-limit / challenge / shadow-limit | #23 (B4) |
| 18 | **Academic & community abuse** | fabricated allegations against students/teachers, doxxing a member of the community, weaponized reports | review-first; **never auto-remove genuine complaints** (§4) | #23 (B4) |
| 19 | **Contextual & coded abuse** | slang, Hinglish/mixed-language, emoji codes, leetspeak/altered spelling, indirect or implied threats, dog-whistles | LLM + context model with deterministic fallback; review-first | #23 (B4) |

> **Category #19 is the reason AI exists in this system.** If a harm can be caught with a
> lexicon/allow-list, the deterministic path must catch it — the model is reserved for the
> cases where wording is indirect and the *intent* is the signal.

---

## 3. Detection architecture (per category)

```
ingest (post/comment/upload/DM)
      │
      ├─ deterministic pass ──► allow-list / lexicon / regex / link reputation
      │        │ match?                          │ no match
      │        ▼                                 ▼
      │   category + severity              AI context pass (only when needed)
      │                                            │
      └────────────────────────────────────────────┘
                        │
                 severity + confidence
                        │
      ┌─────────────────┴──────────────────┐
      │ high confidence                    │ low / ambiguous
      ▼                                    ▼
  enforcement ladder (§4)            quarantine → human review
                        │
                        ▼
              verify() re-reads state → proof UI (§7)
```

Hard rules:

- **Confidence gating.** Only high-confidence, unambiguous matches auto-act. Everything
  else is quarantined for review. False-positive removal is treated as a first-class bug.
- **Context is carried, not discarded.** The report ("criticism of policy", "reported a
  scam by quoting it", "educational discussion") is an input to the decision, not noise.
- **No CSAM to the general model.** Category #5 is handled out-of-band (§5).

---

## 4. Enforcement ladder

Least-destructive action that resolves the harm wins. Escalate step by step; jump straight
to the severe step only for the critical cases named below.

| # | Situation | Action |
|---|---|---|
| 1 | **Critical illegal / imminent safety risk** (child safety, credible violence, terror) | **immediate quarantine/remove + independent verification** + security escalation |
| 2 | **Severe privacy exposure** (IDs, OTPs, keys, card/bank, doxxing) | **hide/remove** + notify owner + rate-limit re-post |
| 3 | **Credible threat** | **restrict** + open security workflow (evidence preserved) |
| 4 | **Child safety / sextortion** | **specialized workflow** (§5) — never the general moderation path |
| 5 | **Severe harassment** | **restrict / remove by context** (target safety first) |
| 6 | **Spam / platform abuse** | **rate-limit / challenge** (not removal) |
| 7 | **Uncertain** | **quarantine → human review** |
| 8 | **Low confidence** | **monitor** (no user-visible action; keep evidence) |
| 9 | **Normal criticism / lawful discussion** | **allow** |

Every step 1–6 is a *serious action* and therefore must produce the proof record in §7.

---

## 5. Child safety — dedicated high-severity system

Child-safety signals (#5) and sextortion (#2, where a minor is involved) **must not** be
processed by the general LLM moderation path. Required properties:

- **Dedicated detection infrastructure** with its own access controls (not the general
  moderation model). The general model must never be shown, asked to reproduce, or asked to
  summarize potentially illegal child-sexual-abuse material.
- **No retention of illegal material** beyond what is legally required; storage is
  access-controlled and audited.
- **Defined escalation path** to the platform's child-safety/trust-and-safety owner and, per
  jurisdiction and applicable law, to the competent authority (e.g. NCMEC-equivalent
  reporting). Legal review owns the exact reporting obligations.
- **Immediate action** on the account/contact vector (block contact, suspend the adult
  account, preserve minimal evidence) — this is the one area where instantaneous action is
  correct.
- **Never auto-close** a child-safety case; it requires human sign-off.

This section is a **build prerequisite** for #23 in B4 and is tracked here so the general
moderation worker is never wired ahead of the specialized pipeline.

---

## 6. Allow-list — must NOT be auto-blocked

The following are explicitly protected from automated removal. A false positive here is a
serious failure of the system:

- Genuine complaints and service reports (including angry ones).
- Criticism of the platform, its policies, or its staff.
- Political, religious, and academic discussion, even when controversial.
- Reporting misconduct or abuse — including **quoting** harmful content to report it.
- Mental-health discussion, help-seeking, and recovery content.
- Educational, journalistic, and historical content about harmful topics.
- Reclaimed / in-group language used non-abusively.
- Benign slang, emoji, and code-switching (must be checked in context, category #19).

> **Critical distinction.** Category #18 ("academic/community abuse") covers *fabricated
> allegations* and *doxxing of community members* — **not** legitimate criticism. A student
> or teacher making a genuine negative complaint about the institution must never be
> auto-removed. Review-first, always.

---

## 7. Proof UI — "🤖 AI ACTION VERIFIED"

For every **serious action** (ladder steps 1–6) the admin surface shows a verification
card. This is the visible proof that the action was real, verified, and traceable — the same
"no success without evidence" contract the 50-worker system uses.

```
🤖 AI ACTION VERIFIED
────────────────────────────────────────────
Detected:       <harm + category + confidence>
Target:         <post / comment / account / link>
Action:         <quarantined | removed | hidden | restricted | rate-limited>
Verification:   Passed  (re-read state confirms the action took effect)
Exposure time:  <time between detection and enforcement>
Worker:         <worker id + name, e.g. #22 Content Moderation>
Evidence link:  <ledger / audit row>
────────────────────────────────────────────
```

Rules:

- `Verification: Passed` is shown **only** when `verify()` re-read the live state and
  confirmed the change. Otherwise the card shows the failure and the automatic rollback.
- **Exposure time** is measured from first-detection to enforcement — it is a first-class
  metric, surfaced to Admins.
- **Evidence link** points at the immutable audit/ledger row (`workforce_actions_kv` and/or
  `activity_logs`) so the action is auditable after the fact.
- The card is owned by **#18 Admin Briefing (B3)** and fed by the enforcement workers.

---

## 8. Data model (planned)

| Store | Purpose |
|---|---|
| `activity_logs` | every detection + enforcement action (audit trail, evidence links) |
| `workforce_actions_kv` | per-run worker ledger rows (outcome, verification proof, metrics) |
| `agent_suggestions` | quarantined/low-confidence items awaiting human review |
| `reports` | human corroboration (never the sole trigger) |
| specialized child-safety store | access-controlled, separate from the general moderation path (§5) |

---

## 9. Build checklist (when the owning batch lands)

1. **Deterministic classifier** — lexicon + link reputation + structural heuristics for the
   unambiguous cases, with the §6 allow-list embedded as pre-emptions.
2. **AI context pass** — provider abstraction + deterministic fallback, prompt-injection
   hardened (see #26), never fed CSAM.
3. **Severity + confidence model** — drives the ladder; confidence gating is mandatory.
4. **Child-safety pipeline** — specialized infra + escalation + legal review sign-off.
5. **Enforcement adapters** — quarantine/remove/hide/restrict/rate-limit, each with a
   `verify()` re-read and rollback.
6. **Proof UI** — the §7 card, wired to the ledger.
7. **Metrics** — per-category precision/recall, false-positive rate, exposure time.
8. **Disable test** — "with moderation off for 24 h, abusive content measurably persists →
   users leave / reports spike." Proves the worker's job.
9. **Adversarial probes** — #26 AI Red-Team attacks the classifier (evasion, injection,
   jailbreak) and the allow-list (false-positive attacks).

---

## 10. Status

- **Not started.** This is a specification, deliberately outside Batch B1.
- Consumed by: **B3** (#18 proof UI), **B4** (#22/#23 detection + enforcement),
  **B5** (#26 adversarial probes), **B6/B7** (#36/#37/#39 security & exposure).
- The roster table in [`docs/WORKFORCE-50.md`](./WORKFORCE-50.md) points here.
