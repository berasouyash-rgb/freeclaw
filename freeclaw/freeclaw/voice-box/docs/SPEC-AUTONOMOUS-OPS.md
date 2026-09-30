# VOICE BOX — AUTONOMOUS OPERATIONS SYSTEM
# FULL IMPLEMENTATION SPECIFICATION

> Normative specification (user-provided, 2026-09-23). This is the contract the implementation
> is judged against — see §46 Acceptance Criteria. Companion docs:
> [`RESEARCH-AGENT-SYSTEMS.md`](./RESEARCH-AGENT-SYSTEMS.md) · [`FRAMEWORK.md`](./FRAMEWORK.md) ·
> [`WORKFORCE-50.md`](./WORKFORCE-50.md) · [`CAPABILITIES-100.md`](./CAPABILITIES-100.md)

## ROLE

Act as the Principal Systems Architect, Autonomous Systems Engineer,
AI Engineer, Backend Engineer, SRE, Security Engineer, Database Engineer,
QA Engineer, Product Engineer and UX Engineer for Voice Box.

Your job is NOT to add a collection of AI features.

Your job is to transform Voice Box into a continuously operating,
autonomous software system that performs real work 24/7.

Do not merely create agents, dashboards, cards, prompts, labels or
"AI detected" messages.

Build the actual execution system.

============================================================
## 1. CORE DECISION
============================================================

DO NOT implement Voice Box as:

"50 AI agents sitting in a dashboard."

DO NOT implement:

agent -> analyze -> display result -> stop

Instead implement:

EVENT
-> DETECT
-> UNDERSTAND
-> PLAN
-> EXECUTE
-> OBSERVE
-> VERIFY
-> RECOVER IF NECESSARY
-> MEASURE
-> RECORD EVIDENCE
-> CONTINUE

The automation itself must perform the work.

Use four kinds of components:

1. AUTONOMOUS AGENTS
   For ambiguous, reasoning-heavy and open-ended tasks.

2. DETERMINISTIC AUTOMATION
   For tasks that software can perform reliably without an LLM.

3. CONTROLLED WORKFLOWS
   For predictable multi-step operations.

4. WORKERS / SERVICES
   For continuously running event, queue, scheduled and monitoring
   processes.

Do not force everything into an LLM.

Use the simplest architecture that reliably accomplishes the job.

============================================================
## 2. ABSOLUTE REAL-WORK RULE
============================================================

Every autonomous capability MUST satisfy:

TRIGGER
-> OBSERVE
-> UNDERSTAND
-> DECIDE
-> REAL TOOL
-> REAL STATE CHANGE
-> INDEPENDENT VERIFICATION
-> MEASUREMENT
-> AUDIT EVIDENCE

If a capability cannot change real system state or produce a verified
operational result, it is not an autonomous worker.

Do not create fake AI activity.

Never generate fake:

- scans
- metrics
- completed statuses
- security results
- optimization results
- performance improvements
- moderation actions
- database improvements
- delivery results
- test results
- uptime
- AI confidence
- "success" events

Only report what actually happened.

============================================================
## 3. AUTONOMOUS OPERATIONS ENGINE
============================================================

Create a central:

Autonomous Operations Engine

Responsibilities:

- receive events
- create durable work items
- determine required capability
- select workflow/agent/tool
- execute work
- observe tool results
- retry recoverable failures
- change strategy when necessary
- verify final state
- record evidence
- update metrics
- terminate successfully only after verification
- keep failed work alive until resolved, safely abandoned or escalated
- prevent duplicate execution
- enforce budgets
- enforce permissions
- enforce safety policies
- maintain execution history

Architecture:

Voice Box
    |
    v
Event Bus
    |
    v
Work Queue
    |
    v
Operations Orchestrator
    |
    +---- deterministic workflow
    |
    +---- autonomous agent
    |
    +---- specialized worker
    |
    +---- scheduled operation
    |
    v
Real Tools
    |
    v
Real System State
    |
    v
Independent Verification
    |
    v
Evidence + Metrics + Audit
    |
    v
Continuous Monitoring

============================================================
## 4. EVENT SYSTEM
============================================================

Everything important in Voice Box must generate an event.

Implement events such as:

NEW_POST
NEW_COMMENT
NEW_REPLY
NEW_MESSAGE
NEW_UPLOAD
NEW_REPORT
NEW_POLL
NEW_VOTE
NEW_REACTION
NEW_ACCOUNT
ACCOUNT_BEHAVIOR_CHANGE

CONTENT_EDITED
CONTENT_RESTORED
CONTENT_REPORTED
CONTENT_APPEALED

CASE_CREATED
CASE_UPDATED
CASE_OVERDUE
CASE_RESOLVED
CASE_REOPENED

SEARCH_ZERO_RESULT
SEARCH_LOW_CONFIDENCE
SEARCH_REGRESSION

QUEUE_BACKLOG
QUEUE_FAILURE
JOB_TIMEOUT

DATABASE_ANOMALY
SLOW_QUERY
LOCK_CONTENTION
CONNECTION_PRESSURE
STORAGE_ANOMALY
CACHE_FAILURE

LATENCY_REGRESSION
ERROR_SPIKE
REALTIME_FAILURE
API_FAILURE

NOTIFICATION_FAILURE
EMAIL_FAILURE
SMS_FAILURE
PUSH_FAILURE

SECURITY_EVENT
AUTHORIZATION_FAILURE
SUSPICIOUS_ACTIVITY
ABUSE_SPIKE

MODEL_FAILURE
MODEL_DRIFT
AI_REGRESSION
TOOL_FAILURE

DEPLOYMENT
RELEASE
CONFIG_CHANGE

SCHEDULED_MAINTENANCE
PERIODIC_HEALTH_CHECK

Every event must have:

id
type
timestamp
source
resource
actor
correlationId
priority
payload
deduplicationKey
traceId

============================================================
## 5. DURABLE WORK QUEUE
============================================================

Never depend on an in-memory queue for critical work.

Implement durable states:

PENDING
CLAIMED
RUNNING
WAITING
RETRYING
VERIFYING
COMPLETED
FAILED
BLOCKED
QUARANTINED
CANCELLED

Each job must have:

- id
- type
- priority
- attempts
- maxAttempts
- createdAt
- startedAt
- completedAt
- worker
- traceId
- parentJobId
- dependencies
- timeout
- retry policy
- evidence
- result
- failure reason

Guarantee:

- idempotency
- deduplication
- retries
- backoff
- dead-letter handling
- recovery after restart
- worker crash recovery
- orphan job recovery

============================================================
## 6. AGENT VS WORKFLOW DECISION RULE
============================================================

Use a WORKFLOW when:

- steps are predictable
- correctness matters
- actions are deterministic
- the same sequence normally works

Use an AGENT when:

- the number of steps cannot be predicted
- investigation is required
- multiple tools may be needed
- context changes during execution
- reasoning is required
- the system must dynamically decide what to investigate next

Use DETERMINISTIC CODE when:

- authorization is involved
- database state changes are involved
- permissions are involved
- validation is deterministic
- retry policies are involved
- audit logging is involved
- security boundaries are involved
- financial/state-critical operations are involved

Use a HYBRID when necessary.

Example:

AI decides:
"this appears to be a database performance problem."

Software executes:
query-plan collection,
metrics collection,
index creation procedure,
benchmark,
rollback.

============================================================
## 7. THE AUTONOMOUS WORKFORCE
============================================================

Do NOT create 50 independent LLM personalities.

Create autonomous capabilities grouped into these systems:

A. OPERATIONS
B. TRUST & SAFETY
C. CONTENT UNDERSTANDING
D. COMMUNITY OPERATIONS
E. CASE MANAGEMENT
F. SEARCH & KNOWLEDGE
G. DATABASE
H. PERFORMANCE
I. QUEUES
J. NOTIFICATIONS
K. STORAGE
L. REALTIME
M. SECURITY
N. QA
O. AI QUALITY
P. RELEASE & CHANGE
Q. AUTONOMOUS COWORKER

Each capability must have:

purpose
trigger
inputs
tools
permissions
decision policy
actions
verification
rollback
metrics
failure policy
cost budget
evidence

============================================================
## 8. CONTENT SAFETY — MOST IMPORTANT USER-FACING SYSTEM
============================================================

Every content surface must use the SAME safety infrastructure.

Not only post submission.

Apply it to:

posts
comments
replies
messages
uploads
polls
profiles
usernames
attachments
images
audio
documents
links

Events must enter the same safety pipeline.

Pipeline:

CONTENT_CREATED
    |
    v
NORMALIZE
    |
    v
LANGUAGE DETECTION
    |
    v
TEXT / IMAGE / AUDIO / FILE EXTRACTION
    |
    v
PII DETECTION
    |
    v
SLANG / EVASION DETECTION
    |
    v
CONTEXT ANALYSIS
    |
    v
SAFETY CLASSIFICATION
    |
    v
RISK DECISION
    |
    v
ENFORCEMENT POLICY
    |
    v
REAL ACTION
    |
    v
VERIFICATION

============================================================
## 9. SLANG IS NOT AN ENFORCEMENT CATEGORY
============================================================

IMPORTANT.

Do NOT make:

"slang detected = remove"

That is incorrect.

Slang detection exists to improve understanding.

Example:

"bro that exam was 💀"

should normally be allowed.

But coded slang may contain:

harassment
threats
blackmail
sexual exploitation
hate
scams
evasion
bullying
coordinated abuse

Therefore:

SLANG DETECTION
-> CONTEXT INTERPRETATION
-> ACTUAL SAFETY CLASSIFICATION
-> ENFORCEMENT ONLY IF WARRANTED

The system must understand what the slang means in context.

============================================================
## 10. SAFETY CATEGORIES
============================================================

Detect and reason about:

PRIVACY / PII

- phone numbers
- addresses
- private email
- government IDs
- student IDs
- passwords
- OTPs
- API keys
- tokens
- bank information
- private medical information
- private school records
- private screenshots
- location information
- private conversations
- doxxing

BLACKMAIL / EXTORTION

- threats to expose information
- financial blackmail
- sexual extortion
- sextortion
- coercion
- threats involving private images
- threats involving identity

THREATS / VIOLENCE

- death threats
- assault threats
- kidnapping
- school attacks
- targeted threats
- weapon threats
- threats toward students
- threats toward teachers/staff
- threats toward families

HARASSMENT / BULLYING

- targeted abuse
- repeated harassment
- humiliation
- dogpiling
- coordinated harassment
- stalking
- intimidation
- sexual harassment
- appearance-based harassment
- disability-based harassment
- identity-based harassment

CHILD SAFETY

- grooming
- sexual conversations involving minors
- requests for sexual images
- sexual exploitation
- sexual extortion
- coercion
- manipulation
- arranging sexual meetings
- child sexual exploitation material

SEXUAL / INTIMATE ABUSE

- non-consensual intimate imagery
- revenge porn
- sexual deepfakes
- nudification
- face-swap sexual abuse
- cyberflashing
- sexual exploitation
- sexual solicitation
- sexual coercion

HATE / DISCRIMINATION

- hate speech
- slurs
- dehumanization
- calls for violence
- caste-based abuse
- religious abuse
- racial abuse
- nationality-based abuse
- disability-based abuse
- gender-based abuse
- sexual-orientation-based abuse
- gender-identity-based abuse

SELF-HARM / DANGEROUS CONTENT

- suicide encouragement
- serious self-harm encouragement
- dangerous challenges
- instructions intended to facilitate self-harm
- glorification
- manipulation into self-harm
- eating-disorder encouragement

Do NOT automatically punish genuine discussions of mental health,
support-seeking or educational discussion.

FRAUD / SCAMS

- phishing
- fake scholarships
- fake prizes
- fake school officials
- payment scams
- credential theft
- investment scams
- fundraising scams
- QR scams
- malicious payment links
- impersonation

CYBER ABUSE

- malicious links
- malware
- credential theft
- exploit attempts
- XSS
- SQL injection attempts
- malicious scripts
- API abuse
- scraping abuse

DRUGS

- illegal sales
- distribution
- transaction facilitation
- dangerous promotion

WEAPONS

- illegal transactions
- weapon threats
- dangerous weapon distribution
- explosives

TERRORISM / EXTREMISM

- recruitment
- violent propaganda
- recruitment material
- calls for violence
- financing
- operational support

ANIMAL CRUELTY

MANIPULATION

- impersonation
- fake announcements
- fabricated emergencies
- forged evidence
- manipulated screenshots
- social engineering
- coordinated deception

SPAM / PLATFORM ABUSE

- flooding
- bots
- mass mentions
- fake engagement
- vote manipulation
- coordinated account abuse
- ban evasion
- notification abuse

ACADEMIC / SCHOOL ABUSE

- fabricated allegations
- targeted humiliation
- malicious rumors
- fake school officials
- doxxing
- coordinated attacks
- fake disciplinary information

============================================================
## 11. SAFETY ACTIONS
============================================================

Use a controlled enforcement ladder:

ALLOW
RESTRICT
QUARANTINE
REMOVE
BLOCK_ACTION
LIMIT_DISTRIBUTION
OPEN_INCIDENT
ESCALATE

Never blindly delete ambiguous content.

Every enforcement decision must have:

classification
confidence
policy
reason
target
action
timestamp
worker
traceId

============================================================
## 12. REAL MODERATION EXAMPLE
============================================================

Test:

A harmful comment is published.

Expected system:

1. NEW_COMMENT event created.
2. Content enters safety pipeline.
3. Language identified.
4. Slang/evasion understood.
5. Context analyzed.
6. Harm identified.
7. Enforcement policy selected.
8. Comment quarantined/removed according to policy.
9. Database state changed.
10. Cache invalidated.
11. Search index updated.
12. Repost/redistribution prevented where applicable.
13. User-facing state updated.
14. Independent read verifies comment is no longer publicly accessible.
15. Evidence recorded.
16. Incident created if required.
17. Metrics updated.
18. Regression test created if this revealed a new failure mode.

The system must not merely say:

"harmful content detected."

It must actually change the platform.

============================================================
## 13. "PROVE AI DID IT"
============================================================

Every meaningful autonomous action gets an evidence record.

Example:

AI ACTION VERIFIED

Worker:
Content Safety

Detected:
Targeted harassment

Target:
Comment #8421

Action:
Quarantined

Database:
Updated ✓

Public visibility:
Removed ✓

Cache:
Invalidated ✓

Search:
Updated ✓

Repost:
Blocked ✓

Independent verification:
Passed ✓

Evidence:
available

Trace:
available

Before state:
available

After state:
available

Never fabricate these fields.

============================================================
## 14. DATABASE AUTONOMOUS SYSTEM
============================================================

Continuously monitor:

- slow queries
- query plans
- missing indexes
- inefficient indexes
- duplicate indexes
- N+1 queries
- connection pressure
- locks
- deadlocks
- storage
- CPU
- memory
- realtime load
- database errors
- replication health

Workflow:

detect
-> investigate
-> identify root cause
-> calculate safe change
-> apply authorized optimization
-> benchmark
-> verify
-> keep or rollback
-> record evidence

Never claim optimization without before/after measurements.

============================================================
## 15. PERFORMANCE AUTONOMOUS SYSTEM
============================================================

Monitor:

p50
p95
p99
error rate
CPU
memory
database latency
database connections
queue depth
realtime latency
API latency
cache hit rate

When regression occurs:

detect
-> investigate
-> identify bottleneck
-> mitigate
-> verify
-> continue monitoring

Possible actions:

cache
batch
queue
rate limit
rebalance
optimize query
reduce unnecessary work
scale configured infrastructure
rollback bad release

Do not invent performance improvements.

============================================================
## 16. QUEUE AUTONOMOUS SYSTEM
============================================================

Continuously inspect:

- backlog
- failed jobs
- stuck jobs
- duplicate jobs
- timeout rate
- worker health
- processing latency

Automatically:

retry
rebalance
recover
deduplicate
move dead jobs
restart unhealthy workers
adjust concurrency within configured limits

Verify queue health afterward.

============================================================
## 17. NOTIFICATION AUTONOMOUS SYSTEM
============================================================

When delivery fails:

detect
-> identify provider
-> inspect error
-> retry
-> fallback where configured
-> verify
-> update notification state

Support:

email
push
SMS
in-app notifications

Never mark delivered merely because send() returned successfully.

Verify delivery using the provider's actual response/state when available.

============================================================
## 18. SEARCH AUTONOMOUS SYSTEM
============================================================

Monitor:

zero-result searches
poor results
duplicate results
stale results
index failures
latency
query errors

When search quality degrades:

detect
-> inspect query
-> inspect index
-> inspect ranking
-> inspect documents
-> repair/update
-> test
-> verify

Continuously turn important failures into regression cases.

============================================================
## 19. CASE / ISSUE SYSTEM
============================================================

Automatically manage:

new issues
duplicates
related issues
priority
assignment
SLA
recurring problems
resolution
resolution verification
reopening

Resolution is NOT:

"admin marked solved."

Resolution means:

problem state changed
+
evidence exists
+
verification passed

If verification fails:

REOPEN.

============================================================
## 20. SECURITY AUTONOMOUS SYSTEM
============================================================

Continuously monitor:

authentication
authorization
permission changes
suspicious behavior
rate abuse
credential exposure
unsafe endpoints
unexpected access
tool misuse
configuration changes

Security operations must use real tests and real evidence.

Never create a fake "security scan complete" dashboard.

Run:

authorization tests
permission boundary tests
API tests
input validation tests
rate-limit tests
session tests
data isolation tests
tenant/resource access tests

Use least privilege.

AI must never receive unrestricted database/system permissions.

Every tool must have:

name
description
schema
permissions
allowed resources
side effects
audit logging
rate limit
timeout

Current agent security guidance emphasizes least privilege, tool validation,
guardrails, monitoring and adversarial testing rather than simply giving
agents broad permissions.

============================================================
## 21. QA AUTONOMOUS SYSTEM
============================================================

After relevant code/config changes:

run real tests.

Where appropriate:

- browser tests
- mobile tests
- API tests
- database tests
- accessibility tests
- authentication tests
- authorization tests
- moderation tests
- search tests
- notification tests
- realtime tests

QA must interact with the real application.

A QA result is valid only when the test actually executed.

============================================================
## 22. AI QUALITY SYSTEM
============================================================

Continuously evaluate:

- classification accuracy
- false positives
- false negatives
- tool selection
- routing
- handoffs
- reasoning failures
- safety failures
- latency
- cost
- hallucination
- regression
- model drift
- tool reliability

Maintain:

golden datasets
regression datasets
adversarial datasets
production failure cases
synthetic cases
appeal/correction cases

Every important production failure should become a future test case where appropriate.

Modern agent platforms explicitly support traces and evaluation loops for
testing tool selection, handoffs, safety behavior and workflow regressions.
Use that model internally even if the implementation is custom.

============================================================
## 23. SELF-IMPROVEMENT
============================================================

The system may improve:

- routing
- prompts/instructions
- thresholds
- retrieval
- tool selection
- model selection
- workflow configuration
- test coverage
- recovery policies

But NEVER allow uncontrolled self-modification.

Every proposed change must:

1. be generated
2. be evaluated
3. be tested
4. be compared against baseline
5. pass safety checks
6. be deployed according to release policy
7. be monitored
8. be rollbackable

No autonomous rewriting of core safety/security rules without explicit
authorization.

============================================================
## 24. MODEL ROUTING
============================================================

Do not use the strongest model for every operation.

Create model tiers:

FAST
GENERAL
STRONG
SPECIALIZED

Route according to:

complexity
risk
latency requirement
cost
modality
language
task type

Start with quality baseline.

Then test cheaper/faster models.

Only replace a model when evaluation demonstrates that the replacement
meets the required quality.

============================================================
## 25. AI COWORKER
============================================================

There should be ONE user-facing AI Coworker.

It should feel like a modern AI assistant.

Support:

text
voice
files
images
documents
web research
citations
coding
data analysis
system investigation
reports
artifacts
long-running missions
background tasks
progress
conversation history
task history

The Coworker is NOT responsible for doing every background operation itself.

It is the conversational interface to the Autonomous Operations System.

Example:

User:
"Why are comments slow?"

Coworker:
"I'll investigate."

Then internally:

Performance
+
Database
+
Cache
+
Queue

perform actual work.

The Coworker receives their verified evidence and summarizes it.

============================================================
## 26. ADMIN EXPERIENCE
============================================================

Do NOT build an "AI agents" page full of fake activity cards.

Build an:

AUTONOMOUS OPERATIONS CENTER

Show:

ACTIVE WORK
ISSUES
FAILED WORK
RECOVERY
SECURITY
SAFETY
PERFORMANCE
DATABASE
NOTIFICATIONS
SEARCH
AI QUALITY
RELEASES
EVIDENCE
AUDIT

Every item must drill into actual work.

Example:

"Database optimized"

must open:

what happened
why
before metrics
action
after metrics
verification
rollback information
trace
evidence

============================================================
## 27. ATTENTION SYSTEM
============================================================

Admin should not need to monitor 50 workers.

Create:

WHAT NEEDS ATTENTION

Only surface:

critical failures
unresolved incidents
unsafe states
repeated failures
blocked work
policy exceptions
important regressions
high-impact decisions

Everything else continues autonomously.

============================================================
## 28. ADMIN INBOX
============================================================

If the AI Coworker has a long conversation with an admin while the admin
was away, generate an inbox summary.

Show:

TOPIC
SUMMARY
KEY FACTS
ACTIONS TAKEN
CURRENT STATUS
NEXT ACTION
URGENCY
EVIDENCE
FULL CHAT

Example:

"Comment moderation pipeline"

Summary:
"Three comments containing coded harassment were detected and removed.
One new slang pattern was identified and added to the evaluation dataset."

Actions:
3 comments quarantined
search indexes updated
one regression test created

Current status:
Resolved

Next action:
Continue monitoring

Full conversation:
Open

============================================================
## 29. AUTONOMOUS WATCHDOG
============================================================

Create a watchdog that monitors the workforce itself.

Detect:

worker stopped
worker looping
worker producing no work
worker failing repeatedly
worker timing out
worker spending excessive resources
worker claiming success without evidence
worker generating duplicate work
worker violating permissions

Actions:

restart
pause
reduce concurrency
disable capability
create incident
switch fallback
rollback configuration
reassign work

CRITICAL:

A worker that produces no measurable value must not remain permanently active.

============================================================
## 30. DISABLE TEST
============================================================

Every autonomous capability must have a disable test.

Ask:

"If this capability disappears tomorrow, what measurable thing becomes
worse?"

Possible answers:

more harmful content reaches users
moderation latency increases
database latency increases
notification failures remain unresolved
queue backlog grows
search quality decreases
QA coverage decreases
security detection decreases

If the answer is:

"nothing"

then remove or redesign the capability.

============================================================
## 31. HUMAN ROLE
============================================================

Do NOT require humans for routine operations.

Routine autonomous work should execute automatically within
pre-authorized boundaries.

Humans should exist as:

- owners
- policy designers
- exception handlers
- auditors
- override capability

Do not stop routine automation merely because a human is unavailable.

For actions outside configured authority or requiring sensitive approval,
pause safely rather than invent authorization.

Guardrails should validate inputs, outputs and tool behavior; sensitive
side effects can have approval boundaries where required.

============================================================
## 32. TOOL SYSTEM
============================================================

Create real tools for:

DATABASE

query
transaction
update
insert
quarantine
restore
index management
query-plan inspection

CONTENT

read
classify
quarantine
remove
restore
edit
restrict
limit distribution

SEARCH

query
index
reindex
invalidate
rank
evaluate

CACHE

inspect
invalidate
warm
measure

QUEUE

enqueue
claim
retry
cancel
rebalance
inspect

NOTIFICATIONS

send
retry
fallback
verify
inspect provider status

STORAGE

inspect
upload
delete
quarantine
restore
integrity check

SECURITY

inspect logs
test authorization
test permissions
test endpoints
rate-limit
revoke
contain

QA

browser
API
database
mobile
accessibility
regression

INFRASTRUCTURE

metrics
logs
traces
health
configuration
deployment
rollback

Every side-effecting tool must enforce permissions independently.

Never trust an LLM to enforce its own permissions.

============================================================
## 33. TOOL VERIFICATION
============================================================

For every side-effecting tool:

BEFORE:
validate input
validate authorization
validate resource
validate policy

EXECUTE:
perform real operation

AFTER:
read actual state
compare expected result
record verification

Example:

AI says:
"comment deleted."

System must NOT trust the AI.

Instead:

deleteComment()
then
getComment()

If public visibility still exists:

FAIL

Then:

retry/recover/investigate.

============================================================
## 34. FAILURE HANDLING
============================================================

Failures are normal.

The system must not hide them.

Failure loop:

FAIL
-> CLASSIFY
-> DETERMINE RECOVERABILITY
-> RETRY IF SAFE
-> CHANGE STRATEGY IF NECESSARY
-> VERIFY
-> CONTINUE

If unrecoverable:

BLOCKED
+
EVIDENCE
+
INCIDENT
+
SAFE STATE

Never:

FAIL
-> "success"

============================================================
## 35. OBSERVABILITY
============================================================

Every operation gets:

traceId
jobId
worker
agent
workflow
tool calls
tool results
state changes
verification
duration
tokens
cost
errors
retries
final state

Use tracing throughout.

Modern agent runtimes expose traces for model calls, tool calls,
handoffs and guardrails; Voice Box should have equivalent end-to-end
observability.

============================================================
## 36. REAL-TIME UI
============================================================

The UI must consume actual backend events.

Do not poll fake data.

Use realtime updates where appropriate.

Examples:

comment removed
job started
database repair completed
notification recovered
incident created
search repaired
worker failed
worker recovered

The UI should update from real state changes.

============================================================
## 37. MEMORY
============================================================

Separate:

USER MEMORY
WORK MEMORY
SYSTEM MEMORY
KNOWLEDGE
AUDIT HISTORY

Never blindly store everything.

Memory must have:

scope
owner
retention
sensitivity
source
timestamp
confidence
deletion policy

============================================================
## 38. EVIDENCE PACK
============================================================

Every important operation should be able to produce:

EVENT
INPUT
DECISION
TOOLS
ACTIONS
BEFORE STATE
AFTER STATE
VERIFICATION
METRICS
ERRORS
TRACE
TIMELINE

This creates:

"Prove AI did it."

============================================================
## 39. CONTINUOUS OPERATION
============================================================

Run workers through:

EVENT-DRIVEN
SCHEDULED
QUEUE-DRIVEN
REALTIME
BACKGROUND
ON-DEMAND

Do not require the admin to open the dashboard.

The system continues when nobody is watching.

============================================================
## 40. SAFETY OF AUTONOMY
============================================================

Never give a general-purpose AI unlimited access.

Apply:

least privilege
tool allowlists
resource-level authorization
argument validation
timeouts
rate limits
cost limits
iteration limits
sandboxing where required
audit logging
rollback
guardrails

AI output is NEVER itself authorization.

The tool layer must independently enforce authorization.

============================================================
## 41. PRODUCT PRINCIPLE
============================================================

Do not build features simply because they sound impressive.

Every feature must answer:

What real problem does this solve?

What triggers it?

What does it actually do?

What system state changes?

How do we verify it?

How do we measure it?

What happens when it fails?

What happens if we disable it?

If these questions cannot be answered, do not implement the feature.

============================================================
## 42. IMPLEMENTATION REQUIREMENT
============================================================

Inspect the actual Voice Box repository before making architectural
changes.

Do not replace working systems unnecessarily.

Preserve:

branding
UX
existing functionality
database schema where practical
existing integrations where useful
existing authentication
existing public flows

Refactor only where required to create the autonomous architecture.

============================================================
## 43. IMPLEMENTATION LOOP
============================================================

Work continuously:

INSPECT
-> UNDERSTAND
-> BASELINE
-> DESIGN
-> IMPLEMENT
-> INTEGRATE
-> TEST
-> RUN
-> OBSERVE
-> VERIFY
-> FIX
-> TEST AGAIN
-> CONTINUE

Do not stop after creating one worker.

Do not stop after creating UI.

Do not stop after creating APIs.

Do not stop after creating database tables.

Do not stop after tests merely compile.

The final system must actually execute.

============================================================
## 44. DO NOT CREATE FAKE DEMOS
============================================================

No:

mock agent activity
fake metrics
fake worker status
fake "AI completed" messages
fake security scans
fake optimization
fake database improvements
fake moderation
fake performance numbers
fake load tests
fake delivery
fake verification

If infrastructure is unavailable:

show unavailable.

Do not simulate success.

============================================================
## 45. TEST THE COMPLETE SYSTEM
============================================================

Create end-to-end tests such as:

TEST 1
Harmful comment appears
-> automatically detected
-> action occurs
-> public visibility changes
-> verification passes

TEST 2
Harmless slang appears
-> understood
-> allowed

TEST 3
Coded harassment appears
-> context understood
-> enforcement occurs

TEST 4
Database regression appears
-> detected
-> investigated
-> optimization applied
-> benchmarked
-> verified

TEST 5
Notification fails
-> retry
-> fallback
-> delivery verified

TEST 6
Queue worker dies
-> watchdog detects
-> worker recovered
-> job continues

TEST 7
Search returns zero results unexpectedly
-> investigate
-> repair
-> regression test created

TEST 8
Unauthorized action attempted
-> tool rejects it
-> audit event created

TEST 9
Worker claims success but state did not change
-> verification catches false success
-> worker marked failed
-> recovery begins

TEST 10
Worker produces no meaningful work
-> disable test fails value proposition
-> capability flagged for removal

============================================================
## 46. ACCEPTANCE CRITERIA
============================================================

Voice Box is NOT complete until:

[ ] events are real
[ ] queue is durable
[ ] workers execute real work
[ ] tools execute real operations
[ ] permissions are enforced
[ ] safety works on posts/comments/replies/messages/uploads
[ ] slang is interpreted in context
[ ] harmful content produces real enforcement
[ ] harmless content is not punished merely for slang
[ ] database operations are real
[ ] performance operations are real
[ ] queues recover automatically
[ ] notifications recover automatically
[ ] search operations are real
[ ] security tests are real
[ ] QA interacts with the actual product
[ ] AI quality is continuously evaluated
[ ] failures are visible
[ ] verification is independent
[ ] evidence is recorded
[ ] audit trail exists
[ ] admin UI reflects real state
[ ] AI Coworker can delegate real work
[ ] background work continues without admin presence
[ ] watchdog exists
[ ] rollback exists
[ ] disable tests exist
[ ] cost controls exist
[ ] model routing exists
[ ] regression datasets exist
[ ] no fake metrics exist
[ ] no fake completion exists

============================================================
## 47. FINAL ENGINEERING PRINCIPLE
============================================================

The finished Voice Box should not feel like:

"Here are some AI features."

It should feel like:

"Voice Box is operating itself."

A user creates a post.

The system understands it.

Safety is checked.

A harmful comment is automatically handled.

A database problem is automatically investigated.

A queue failure automatically recovers.

A notification failure automatically retries.

Search quality automatically gets monitored.

Security tests automatically run.

Releases automatically trigger QA.

AI quality automatically gets evaluated.

Failures automatically become work.

Work automatically becomes verified outcomes.

The admin does NOT need to manually coordinate all of this.

The admin supervises the autonomous system rather than manually operating it.

The AI Coworker is the conversational interface.

The Autonomous Operations Engine is the actual workforce.

Agents provide reasoning where reasoning is needed.

Workflows provide predictability where predictability is needed.

Deterministic software provides reliability where deterministic guarantees
are possible.

Workers and services execute continuously.

Everything important is observable, verifiable and auditable.

Do not optimize for the number of agents.

Optimize for the amount of REAL, VERIFIED WORK completed autonomously.

DO NOT DECLARE COMPLETION UNTIL THE ACTUAL SYSTEM HAS BEEN IMPLEMENTED,
INTEGRATED, EXECUTED, TESTED, VERIFIED AND OBSERVED END-TO-END.
