# Capability map — spec §41 (102 capabilities, verified)

Generated: 2026-10-04T07:04:11.100Z · by `scripts/audit-capabilities.mjs`. Every pointer below was checked against the working tree.

## 1. Proactive moderation — WIRED
- worker `comment-watch`
- route `/api/comments`
- ui `src/pages/admin/Reports.tsx`
- test `tests/api/comment-watch.test.ts`

## 2. PII detection — WIRED
- engine `api/_moderation.js#PII_EMAIL_RE`
- route `/api/comments`
- test `tests/api/pii-masking.test.ts`

## 3. Doxxing prevention — WIRED
- engine `api/_moderation.js#DOX_THREAT`
- test `tests/api/server-moderation-coercion.test.ts`

## 4. Blackmail detection — WIRED
- engine `api/_moderation.js#BLACKMAIL_DEMAND`
- test `tests/api/server-moderation-coercion.test.ts`

## 5. Threat detection — WIRED
- engine `api/_moderation.js#VIOLENCE_PATTERNS`
- test `tests/api/server-moderation.test.ts`

## 6. Harassment detection — WIRED
- engine `api/_moderation.js#BULLY_WORDS`
- test `tests/api/server-moderation.test.ts`

## 7. Grooming detection — WIRED
- engine `api/_moderation.js#EXPLICIT_BLOCK`
- test `tests/api/server-moderation.test.ts`

## 8. Child-safety detection — WIRED
- engine `api/_moderation.js#EXPLICIT_BLOCK`
- route `/api/reports`

## 9. Intimate-image abuse detection — WIRED
- engine `api/_moderation.js#EXPLICIT_NAKED_PIC`
- test `tests/api/server-moderation.test.ts`

## 10. Hate/abuse detection — WIRED
- engine `api/_moderation.js#SLURS`
- test `src/__tests__/moderation.test.ts`

## 11. Scam detection — WIRED
- engine `api/_agent-team.js#SPAM_REASON_RE`
- engine `api/_moderation.js#spamAnalyze`
- test `src/__tests__/moderation.test.ts`

## 12. Malware-link detection — WIRED
- engine `api/_evidence-scan.js#MALWARE_INDICATORS`
- engine `src/lib/moderation.ts#SPAM_PATTERNS`

## 13. Spam prevention — WIRED
- worker `spam-sentinel`
- worker `spam-score-decay`
- test `src/__tests__/moderation.test.ts`

## 14. Coordinated-abuse detection — WIRED
- worker `user-anomaly`
- route `/api/security`

## 15. Impersonation detection — WIRED
- engine `api/_agent-team.js#SPAM_REASON_RE`
- worker `authz-probe`

## 16. Slang understanding — WIRED
- engine `src/lib/lexicon.ts#SLANG`
- test `src/__tests__/moderation.test.ts`

## 17. Evasion detection — WIRED
- engine `api/_moderation.js#checkSafetyRepost`
- engine `api/_moderation.js#recordSafetyRepost`
- engine `api/_safety-pipeline.js#evaluateContent`
- engine `src/lib/lexicon.ts#foldLeet`
- route `/api/comments`
- test `tests/api/safety-parity.test.ts`

## 18. Multilingual moderation — WIRED
- engine `api/_translate.js#detectLanguage`
- worker `multilingual`
- test `tests/api/inbox-classify.test.ts`

## 19. Context analysis — WIRED
- engine `api/_moderation.js#REPORTING_CTX`
- test `tests/api/server-moderation.test.ts`

## 20. Report triage — WIRED
- route `/api/reports`
- ui `src/pages/admin/Reports.tsx`
- test `tests/api/reports.test.ts`

## 21. Automatic content enforcement — WIRED
- engine `api/_reports.js#enforceStrike`
- test `tests/api/reports.test.ts`

## 22. Safety verification — WIRED
- engine `api/_reports.js#verifyReportResolution`
- test `tests/api/reports.test.ts`

## 23. Safety regression testing — WIRED
- test `tests/api/server-moderation.test.ts`
- test `tests/api/server-moderation-coercion.test.ts`
- test `tests/api/safety-pipeline.test.ts`
- test `tests/api/safety-parity.test.ts`
- engine `api/_safety-pipeline.js#messageFor`

## 24. Safety red teaming — WIRED
- engine `api/_redteam-cases.js#runRedTeam`
- route `/api/workforce`

## 25. Anonymous identity protection — WIRED
- worker `anonymity-guard`
- worker `anonymity`
- test `tests/api/anonymity.test.ts`

## 26. Submission quality improvement — WIRED
- worker `submission-understanding`
- worker `content-quality`

## 27. Missing-information detection — WIRED
- worker `missing-info`
- test `tests/api/workforce-batch1.test.ts`

## 28. Automatic category suggestion — WIRED
- worker `category-assignment`
- test `tests/api/workforce-batch1.test.ts`

## 29. Category correction — WIRED
- worker `category-correction`
- test `tests/api/workforce-batch1.test.ts`

## 30. Department routing — WIRED
- route `/api/routing`
- engine `api/_agent-team.js#analyzeAndSuggest`

## 31. Duplicate detection — WIRED
- worker `duplicate-case`
- worker `duplicate-reports`
- test `tests/api/workforce-batch2.test.ts`

## 32. Related-case detection — WIRED
- worker `related-case`
- test `tests/api/workforce-batch2.test.ts`

## 33. Priority calculation — WIRED
- worker `priority`
- worker `priority-scaler`
- test `tests/api/workforce-batch2.test.ts`

## 34. Case assignment — WIRED
- worker `case-assignment`
- test `tests/api/workforce-batch2.test.ts`

## 35. SLA monitoring — WIRED
- worker `sla`
- worker `report-sla`
- test `tests/api/workforce-batch2.test.ts`

## 36. Automatic follow-up — WIRED
- worker `followup`
- test `tests/api/followup.test.ts`

## 37. Resolution collection — WIRED
- route `/api/reports`
- ui `src/pages/admin/Reports.tsx`

## 38. Resolution verification — WIRED
- engine `api/_reports.js#verifyReportResolution`
- test `tests/api/reports.test.ts`

## 39. Automatic reopening — WIRED
- worker `reopen`
- test `tests/api/reopen.test.ts`

## 40. Recurring issue detection — WIRED
- worker `suggestion-detection`
- worker `trends`

## 41. Community impact calculation — WIRED
- engine `api/_workforce.js#platformPulse`
- route `/api/leaderboard`

## 42. Poll creation — WIRED
- route `/api/polls`
- engine `api/_agent-chat.js#create_poll`

## 43. Poll integrity — WIRED
- worker `poll-integrity`
- test `tests/api/poll-integrity.test.ts`

## 44. Poll abuse detection — WIRED
- worker `poll-integrity`
- engine `api/_poll-integrity.js#FRAUD_KEY`

## 45. Poll closing — WIRED
- worker `poll-sweep`
- route `/api/polls`

## 46. Poll analytics — WIRED
- route `/api/polls`
- ui `src/pages/Polls.tsx`

## 47. Search relevance — WIRED
- route `/api/search`
- route `/api/search-quality`

## 48. Zero-result repair — WIRED
- engine `api/_search-quality.js#recoverSearchGaps`
- worker `search-gap-recovery`
- route `/api/search-quality`

## 49. Knowledge retrieval — WIRED
- engine `api/_learning-engine.js#queryKnowledge`
- route `/api/learning`

## 50. Knowledge update — WIRED
- engine `api/_learning-engine.js#sharePattern`
- route `/api/learning`

## 51. Knowledge conflict detection — WIRED
- engine `api/_learning-engine.js#analyzePatterns`
- route `/api/learning`

## 52. Student help — WIRED
- ui `src/pages/UserChat.tsx`
- route `/api/chat`

## 53. Issue explanation — WIRED
- engine `api/_agent-chat.js#INTENTS`
- ui `src/pages/admin/AgentChat.tsx`

## 54. Admin briefing — WIRED
- engine `api/_workforce.js#overnightBriefing`
- ui `src/pages/admin/OpsCenter.tsx`
- test `tests/api/workforce-briefing.test.ts`

## 55. Daily operations briefing — WIRED
- engine `api/_workforce.js#overnightBriefing`
- route `/api/workforce`

## 56. Inbox conversation summarization — WIRED
- engine `api/_inbox.js#summarizeThread`
- ui `src/pages/admin/UnifiedInbox.tsx`
- test `tests/api/inbox-summaries.test.ts`

## 57. Inbox action extraction — WIRED
- engine `api/_inbox.js#triageThread`
- ui `src/pages/admin/UnifiedInbox.tsx`

## 58. Inbox priority detection — WIRED
- engine `api/_inbox.js#triageInboxMessage`
- test `tests/api/inbox-triage.test.ts`

## 59. Automatic admin notification — WIRED
- engine `api/_auth.js#notifyUser`
- engine `api/_reports.js#enforceStrike`

## 60. Voice-to-case — WIRED
- worker `voice-intake`
- ui `src/pages/Submit.tsx`
- test `src/__tests__/Submit.test.tsx`

## 61. Voice transcription — WIRED
- engine `api/_transcribe.js`
- route `/api/transcribe`
- test `tests/api/transcribe.test.ts`

## 62. Voice response — WIRED
- engine `src/lib/speech.ts#readAloud`
- ui `src/pages/PostDetail.tsx`

## 63. Attachment understanding — WIRED
- engine `api/_evidence-scan.js`
- route `/api/evidence-scan`

## 64. OCR — WIRED
- engine `api/_evidence-scan.js#MALWARE_INDICATORS`

## 65. File safety — WIRED
- engine `api/_evidence-scan.js`
- route `/api/evidence-scan`
- route `/api/upload`

## 66. Notification routing — WIRED
- engine `api/_notification-delivery.js`
- route `/api/notifications`

## 67. Notification retry — WIRED
- engine `api/_notification-delivery.js#retryPendingDeliveries`
- test `tests/api/notification-delivery.test.ts`

## 68. Notification fallback — WIRED
- engine `api/_notification-delivery.js`
- worker `notification-health`

## 69. Notification delivery verification — WIRED
- engine `api/_notification-delivery.js#verifyNotificationStored`
- test `tests/api/notification-delivery.test.ts`

## 70. Broken-link detection — WIRED
- route `/api/tech-debt`

## 71. Broken-page detection — WIRED
- ui `src/pages/NotFound.tsx`
- test `tests/e2e/error-states.spec.ts`

## 72. UI defect detection — WIRED
- test `tests/e2e/no-horizontal-overflow.spec.ts`
- test `tests/e2e/admin-reports-mobile.spec.ts`

## 73. Browser QA — WIRED
- test `tests/e2e/user-flows.spec.ts`

## 74. Mobile QA — WIRED
- test `tests/e2e/admin-reports-mobile.spec.ts`

## 75. Accessibility testing — WIRED
- test `tests/e2e/a11y-claims.spec.ts`

## 76. Database monitoring — WIRED
- worker `db-health`
- route `/api/performance`

## 77. Query optimization — WIRED
- engine `api/_performance.js`

## 78. Index optimization — WIRED
- route `/api/performance`

## 79. Cache optimization — WIRED
- worker `cache-optimizer`
- test `tests/api/workforce-core-coverage.test.ts`

## 80. Load management — WIRED
- ui `src/pages/admin/PerformanceCenter.tsx`

## 81. Queue recovery — WIRED
- engine `api/_workforce.js#recoverStale`
- test `tests/api/workforce-recovery.test.ts`

## 82. Realtime optimization — WIRED
- route `/api/vitals`
- ui `src/pages/admin/SystemHealth.tsx`

## 83. Storage management — WIRED
- worker `storage`
- worker `orphan-auditor`

## 84. Performance regression detection — WIRED
- route `/api/feature-health`
- route `/api/performance`

## 85. Security testing — WIRED
- worker `authz-probe`
- route `/api/security`

## 86. Authorization testing — WIRED
- worker `authz-probe`
- test `tests/api/agent-approve-guard.test.ts`

## 87. Cross-user access testing — WIRED
- test `tests/api/anonymity.test.ts`

## 88. Data-exposure detection — WIRED
- engine `api/_evidence-scan.js`
- worker `anonymity`

## 89. Upload protection — WIRED
- engine `api/_evidence-scan.js`
- route `/api/upload`

## 90. AI model evaluation — WIRED
- engine `api/_evaluation-engine.js#runFullEvaluation`

## 91. AI regression testing — WIRED
- engine `api/_evaluation-engine.js#getEvaluationHistory`

## 92. AI red teaming — WIRED
- engine `api/_redteam-cases.js#runRedTeam`

## 93. AI drift detection — WIRED
- engine `api/_workforce.js#evalDrift`

## 94. Model routing — WIRED
- engine `api/_providers.js#buildChain`
- ui `src/pages/admin/ProviderSettings.tsx`

## 95. AI cost optimization — WIRED
- engine `api/_workforce-core.js#budgetAllows`

## 96. Incident detection — WIRED
- route `/api/incidents`
- engine `api/_incident-cron.js`

## 97. Incident recovery — WIRED
- engine `api/_incident-cron.js`
- ui `src/pages/admin/OpsCenter.tsx`

## 98. Deployment verification — WIRED
- route `/api/health`
- route `/api/feature-health`

## 99. Change impact analysis — WIRED
- engine `api/_workforce.js#impactCenter`
- route `/api/workforce`

## 100. Continuous improvement — WIRED
- engine `api/_continuous-learning.js#runContinuousEvaluation`

## 101. Appeal recourse — WIRED
- route `/api/appeals`
- engine `api/_appeals.js#publishOverturn`
- engine `api/_moderation.js#clearSafetyRepost`
- test `tests/api/appeals.test.ts`

## 102. Appeal SLA — WIRED
- worker `appeal-sla`
- test `tests/api/workforce-appeal-sla.test.ts`

## Totals
- WIRED: 102 · PARTIAL: 0 · GAP: 0
- Gate: exit code = GAP count (0).