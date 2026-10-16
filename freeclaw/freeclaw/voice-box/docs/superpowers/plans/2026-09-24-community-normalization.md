# Community Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each `settings` key named `community:${slug}` as the authoritative community store with normalized PostgreSQL tables while preserving `/api/communities` actions, the `/communities` UI, report targets, and a tested recovery path.

**Architecture:** Add community-specific tables, deterministic service-role RPCs, and a trigger-maintained summary projection; backfill legacy JSON idempotently; then route the existing API through a four-mode adapter (`legacy`, `shadow`, explicit-slug `canary`, `normalized`). Legacy documents remain untouched as rollback snapshots through this plan. The pages perform one initial read, use explicit cursor/comment reads, and reconcile authoritative mutation responses locally instead of reloading whole pages.

**Tech Stack:** Node.js 22.22+ (the inspected workstation has Node 25.9), TypeScript 5.9, React 19, Vite 7, Vitest 4, `@supabase/supabase-js` 2.99, Vercel serverless handlers, PostgreSQL/Supabase, SQL migrations under `api/migrations/`.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md` (approved design)

**Inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

## Global Constraints

- Keep the approved Vercel + Supabase stack; add no service and no runtime package.
- Preserve the existing `list`, `get`, `create`, `join`, `leave`, `post`, `comment`, `react`, `vote`, `solve_poll`, `delete_post`, `report`, and `admin` action names, HTTP methods, status meanings, and all fields consumed by the current pages. Add bounded `comments` and `stats` reads without changing those existing action contracts.
- The default deployment mode remains `legacy`; normalized reads and writes are never activated merely by applying migrations.
- Keep `settings` rows and anonymous identity behavior unchanged through this plan; do not delete `community:*` rows or redesign anonymous identity.
- Each page performs one initial bounded read. Remove the 30-second `Communities` timer and 25-second `CommunityDetail` timer, visibility reloads, and post-action full reloads.
- Every list is bounded. Community detail starts with at most 20 posts; each comment page contains at most 50 comments; community list contains at most 200 cards.
- All new public-schema tables have RLS enabled, deny `anon` and `authenticated`, and are reachable only through the server-side service-role client.
- All new RPCs are `SECURITY INVOKER`, use `SET search_path = ''`, fully qualify PostgreSQL objects, and grant `EXECUTE` only to `service_role`.
- New community tables are not added to `supabase_realtime`; community pages do not subscribe to passive row events.
- Migrations, backfill, application activation, and physical retirement of legacy JSON are separate. This plan never physically deletes the rollback snapshot.
- Test and lint commands run sequentially. Do not run test, typecheck, lint, or build commands concurrently.
- The working tree already contains unrelated user changes in `api/_agent.js`, `api/_announcement.js`, `api/_chat.js`, `src/lib/api.ts`, `src/__tests__/api.test.ts`, `tests/api/admin-gates-runtime.test.ts`, `tests/api/agent-suggestion-dismiss.test.ts`, and `tsconfig.app.tsbuildinfo`. Run `git status --short` before each task and stage only this plan’s hunks.
- Never run the integration/concurrency script with production write permission. It must abort unless `VOICE_BOX_ENVIRONMENT=staging` and `VOICE_BOX_ALLOW_COMMUNITY_WRITES=1` are set.
- No production migration, backfill, deployment, flag change, or legacy deletion occurs without the human gate required by the approved design.

## Review Focus

1. **Concurrent writes to one community:** Forty simultaneous comments, joins, or votes must all survive; no request may read one JSON snapshot and overwrite another request’s change.
2. **Ambiguous duplicate legacy data:** Duplicate settings keys, post IDs, comment IDs, poll-option IDs, or a voter in two poll options must stop backfill with an explicit issue code rather than silently discard data.
3. **Split-brain rollout:** A community slug must use one storage authority for reads and writes; percentageing by anonymous user is forbidden because two browsers could write the same community through different stores.
4. **Compatibility leakage:** Admin/hidden lists and viewer-specific detail/comment responses must never enter a public cache; normalized reads must not serve legacy data that is known to be incomplete.
5. **Projection drift:** `community_summaries.member_count` and `post_count` must equal base-table counts after backfill, concurrent actions, cascading deletes, and recovery.

---

## Evidence and Fixed Decisions

### Current implementation inspected

- `api/_communities.js:15-19` documents the `settings` JSON persistence model; `api/_communities.js:38-59` reads and rewrites the whole value; `api/_communities.js:151-499` routes all actions through that document.
- Current fixed limits are 500 members, 300 posts, 100 comments per post, 200 reactions per post/kind, four poll options, and a 15-second post cooldown.
- `src/pages/Communities.tsx:46-69` reloads every 30 seconds and on visibility; `src/pages/Communities.tsx:71-120` reloads after successful create/admin actions.
- `src/pages/CommunityDetail.tsx:103-135` reloads every 25 seconds and on visibility; `src/pages/CommunityDetail.tsx:137-341` reloads after join, post, vote, solve, delete, react, comment, hide, and unhide.
- `src/pages/CommunityDetail.tsx:699-733` expects comments inside each post, so the normalized contract retains `comments` and adds `comment_count` plus an explicit comment-page action.
- `tests/api/communities.test.ts` locks legacy validation, membership, cooldown, reports, moderation, poll, and delete behavior; it must remain green in `legacy` mode.
- `src/__tests__/Communities.test.tsx` covers list rendering but not timer removal or local reconciliation; there is no direct `CommunityDetail` component suite.
- `src/lib/dashboard/widgets.tsx:97,1025-1034,1649-1659` points at `/api/communities` without an action and expects array keys `communities` and `members`; the current handler returns 400 for that request. The plan adds a bounded admin `stats` response and keeps the two dashboard widgets.
- `api/migrations/001_baseline.sql:90-95` defines `settings.key` without a unique constraint, while current code uses `upsert(row, { onConflict: "key" })`. Live catalog inspection and a duplicate audit must precede the uniqueness migration.
- `api/migrations/005_rls_hardening.sql`, `010_rls_hardening.sql`, and `014_revoke_anon_private_tables.sql` establish an API-only service-role posture. The new tables follow that posture and are not published to Realtime.
- Generic `posts`, `comments`, `reactions`, and `poll_votes` tables are not reused; community-specific prefixed names prevent collisions and keep this migration reversible.

### Storage-mode contract

| Mode | Reads | Writes | Use |
|---|---|---|---|
| `legacy` | Legacy JSON | Legacy JSON | Default before backfill and rollback-safe pre-cutover mode |
| `shadow` | Legacy JSON is authoritative | Legacy JSON first, then normalized RPC | Compare every response and soak post-backfill traffic |
| `canary` | Only slugs in `COMMUNITY_CANARY_SLUGS` use normalized; every other slug uses legacy | Same rule per slug | Explicit test-community rollout; never percentage by user |
| `normalized` | Normalized RPC | Normalized RPC | Full cutover after zero mismatches and verified recovery export |

The invalid mode fails closed at module load. An empty or absent `COMMUNITY_CANARY_SLUGS` means no canary slug. Shadow mismatch logs contain route, slug, action, and issue code, never document bodies or anonymous IDs.

### Public response contract

Create `src/types/community.ts` with these exact interfaces:

```ts
export interface CommunityCard {
	slug: string;
	name: string;
	description: string;
	avatar: string;
	photo: string;
	created_by: string;
	created_at: string;
	hidden: boolean;
	member_count: number;
	post_count: number;
}

export interface CommunityComment {
	id: string;
	anon_id: string;
	author: string;
	text: string;
	created_at: string;
}

export interface CommunityPollOption {
	id: string;
	text: string;
	votes: number;
}

export interface CommunityPoll {
	id: string;
	question: string;
	options: CommunityPollOption[];
	created_by: string;
	my_vote: string | null;
	total_votes: number;
}

export interface CommunityPost {
	id: string;
	anon_id: string;
	author: string;
	text: string;
	created_at: string;
	/** Compatibility key retained for old clients; normalized detail returns {}. */
	reactions: Record<string, string[]>;
	reaction_counts: Record<string, number>;
	mine_reactions: Record<string, boolean>;
	poll: CommunityPoll | null;
	/** Compatibility key retained; populated by action=comments. */
	comments: CommunityComment[];
	comment_count: number;
}

export interface CommunityDetailData extends CommunityCard {
	members: string[];
	is_member: boolean;
	is_creator: boolean;
	posts: CommunityPost[];
	next_cursor: string | null;
}

export interface CommunityListResponse {
	communities: CommunityCard[];
}

export type CommunityDetailResponse = CommunityDetailData;

export interface CommunityCommentPageResponse {
	comments: CommunityComment[];
	next_cursor: string | null;
}

export interface CommunityStatsResponse {
	communities: number;
	members: number;
	posts: number;
}

export interface CommunityMembershipResponse {
	is_member: boolean;
	member_count: number;
}

export interface CommunityReactionResponse {
	kind: string;
	active: boolean;
	count: number;
}

export interface CommunityVoteResponse {
	ok: true;
	my_vote: string;
	poll: CommunityPoll;
}

export interface CommunityPostResponse {
	post: CommunityPost;
	post_count: number;
}

export interface CommunityDeletePostResponse {
	ok: true;
	deleted: true;
	post_count: number;
}

export interface CommunityAdminResponse {
	ok: true;
	hidden?: boolean;
	deleted?: boolean;
	community?: CommunityCard;
}
```

Normalized `GET action=get` returns `reactions: {}` and `comments: []` to retain response keys without transferring every reaction identity or every comment body. It returns exact `reaction_counts`, `mine_reactions`, and `comment_count`; `mine_reactions` and poll `my_vote` are viewer-specific. No current page consumes the raw `reactions` arrays.

### Mutation-to-state reconciliation

| Action | Authoritative response | Pure state update | Forbidden behavior |
|---|---|---|---|
| `create` | `{ community: CommunityCard }` | Prepend returned card | No list reload |
| `admin hide/unhide` | `{ ok, hidden, community }` | Replace only returned card | No list reload |
| `admin delete` | `{ ok, deleted: true }` | Remove card | No list reload |
| `join/leave` | `{ is_member, member_count }` | Patch `is_member` and `member_count` | No detail reload |
| `post` | `{ post: CommunityPost, post_count: number }` | Insert/replace post and patch `post_count` | No detail reload |
| `comment` | `{ comment, comment_count }` | Append to that post/thread and replace count | No detail reload |
| `react` | `{ kind, active, count }` | Patch only that post/kind | No detail reload |
| `vote` | `{ ok, my_vote, poll }` | Replace only that post’s poll | No detail reload |
| `solve_poll` / `delete_post` | `{ ok, deleted, post_count }` | Remove post and patch count | No detail reload |
| `report` | `{ ok: true }` | Preserve page data and show success toast | No reload |

### Query budgets

| Operation | Browser HTTP calls | Supabase calls in authoritative mode | Bound |
|---|---:|---:|---|
| Community list initial load | 1 GET | 1 RPC or 1 legacy settings read | 200 cards |
| Community detail initial load | 1 GET | 1 RPC or 1 legacy document read | 20 posts, 500 member IDs, aggregates only |
| Open one comment thread | 1 user-triggered GET | 1 RPC | 50 comments |
| Load older posts | 1 user-triggered GET | 1 RPC | 20 posts |
| Create/join/post/comment/react/vote/delete/admin | 1 POST | 1 RPC | One transaction |
| Admin stats | 1 GET | 1 RPC | Three scalar counts |
| Shadow mutation | 1 POST | 1 legacy write + 1 normalized RPC | Legacy response wins; mismatch is observable |
| Canary list | 1 GET | At most 2 reads | Allowlisted normalized slugs replace their legacy cards |

Performance gates use the approved targets: warm user-facing p95 below 500 ms, write acknowledgement p95 below 800 ms, zero unexpected 5xx/timeouts, and no sequential full-page or full-feed reload.

## File Map

### Create

- `api/migrations/021_settings_key_unique.sql` — guarded global settings-key uniqueness required by existing upserts.
- `api/migrations/022_community_normalized_schema.sql` — normalized tables, constraints, indexes, RLS, and grants.
- `api/migrations/023_community_summary_projection.sql` — trigger functions that maintain summary counts.
- `api/migrations/024_community_normalized_reads.sql` — list/detail/comment/stats RPCs.
- `api/migrations/025_community_normalized_writes.sql` — atomic mutation RPCs.
- `api/migrations/026_community_migration_tools.sql` — import, semantic verification, legacy export, and projection rebuild RPCs.
- `api/_community-storage.js` — storage modes, canary selection, error mapping, and response comparison.
- `api/_community-legacy-store.js` — the current JSON behavior extracted behind the store contract.
- `api/_community-normalized-store.js` — Supabase RPC adapter.
- `scripts/lib/community-legacy.mjs` — pure legacy-document validation, canonical comparison, and cursor helpers.
- `scripts/community-normalization.mjs` — `audit`, `backfill`, `verify`, `rebuild-summaries`, and `replay-legacy` commands.
- `scripts/test-community-normalization.mjs` — disposable staging concurrency/query-budget test.
- `src/types/community.ts` — shared public response types.
- `src/lib/communityState.ts` — pure list/detail reconciliation functions.
- `src/__tests__/communityState.test.ts` — reducer tests.
- `src/__tests__/CommunityDetail.test.tsx` — one-load, action, comments, cursor, and failure-state tests.
- `tests/api/communities-storage.test.ts` — mode/canary/error/shadow tests.
- `tests/api/communities-normalized.test.ts` — RPC mapping and query-budget tests.
- `tests/api/community-schema-contract.test.ts` — migration security/constraint/index contract.
- `tests/api/community-normalization-script.test.ts` — legacy validation/canonicalization/replay tests.

### Modify

- `api/_communities.js` — validation/routing only; choose the store and preserve responses.
- `src/pages/Communities.tsx` — one initial read, manual refresh, local create/admin reconciliation.
- `src/pages/CommunityDetail.tsx` — one initial read, cursor/comments, local action reconciliation, no timer/visibility reload.
- `src/__tests__/Communities.test.tsx` — timer/visibility/action-reconciliation coverage.
- `src/lib/api.ts` — only the `isNonReplayable` community hunk; preserve unrelated working-tree changes.
- `src/__tests__/api.test.ts` — only the community non-replay test hunk; preserve unrelated working-tree changes.
- `src/lib/dashboard/widgets.tsx` — point community widgets at `?action=stats` and render scalar stats.
- `src/__tests__/dashboard-widgets.test.tsx` — source/shape contract for the two widgets.
- `package.json` — explicit normalization and staging-test scripts; no dependency change.
- `.env.template` — documented storage mode and canary slugs.
- `docs/DEPLOY-SCHOOL.md` — migration order, Data API exposure, backfill, and activation gates.
- `docs/ROLLBACK.md` — mode rollback and normalized-to-legacy replay procedure.
- `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md` — mark the two community routes compliant only after their evidence tests pass.

### Do not modify in this plan

- `api/migrations/001_baseline.sql` and deployed migrations `002` through `015`.
- Generic `posts`, `comments`, `reactions`, `polls`, and `poll_votes` APIs.
- Realtime publication/allowlists.
- `settings` rows named `community:*` after backfill.
- `package-lock.json`; no dependency is added.

---

### Task 1: Lock the Shared Contract and Pure Reconcilers

**Files:**
- Create: `src/types/community.ts`
- Create: `src/lib/communityState.ts`
- Create: `src/__tests__/communityState.test.ts`

**Interfaces:**
- Consumes: Current JSON field names from `api/_communities.js:72-128` and page action handlers.
- Produces: `CommunityCard`, `CommunityDetailData`, mutation response types, and these pure functions:

```ts
export function upsertCommunityCard(
	cards: CommunityCard[],
	card: CommunityCard,
): CommunityCard[];

export function removeCommunityCard(
	cards: CommunityCard[],
	slug: string,
): CommunityCard[];

export function patchCommunityMembership(
	data: CommunityDetailData,
	result: CommunityMembershipResponse,
): CommunityDetailData;

export function insertCommunityPost(
	data: CommunityDetailData,
	post: CommunityPost,
	postCount: number,
): CommunityDetailData;

export function removeCommunityPost(
	data: CommunityDetailData,
	postId: string,
	postCount: number,
): CommunityDetailData;

export function patchCommunityReaction(
	data: CommunityDetailData,
	postId: string,
	result: CommunityReactionResponse,
): CommunityDetailData;

export function replaceCommunityPoll(
	data: CommunityDetailData,
	postId: string,
	poll: CommunityPoll,
): CommunityDetailData;

export function appendCommunityComment(
	state: CommunityCommentState,
	postId: string,
	comment: CommunityComment,
	commentCount: number,
): CommunityCommentState;
```

`CommunityCommentState` is:

```ts
export interface CommunityCommentThread {
	items: CommunityComment[];
	next_cursor: string | null;
	loading: boolean;
	error: string;
}

export type CommunityCommentState = Record<string, CommunityCommentThread>;
```

- [ ] **Step 1: Write failing reducer tests**

Create `src/__tests__/communityState.test.ts` with state-based tests:

```ts
import { describe, expect, it } from "vitest";
import {
	appendCommunityComment,
	insertCommunityPost,
	patchCommunityReaction,
	removeCommunityPost,
	upsertCommunityCard,
} from "../lib/communityState";
import type {
	CommunityCard,
	CommunityComment,
	CommunityDetailData,
	CommunityPost,
} from "../types/community";

const card: CommunityCard = {
	slug: "study-gang",
	name: "Study Gang",
	description: "",
	avatar: "📚",
	photo: "",
	created_by: "anon-a",
	created_at: "2026-09-24T10:00:00.000Z",
	hidden: false,
	member_count: 1,
	post_count: 0,
};

function detail(): CommunityDetailData {
	return {
		...card,
		members: ["anon-a"],
		is_member: true,
		is_creator: true,
		posts: [],
		next_cursor: null,
	};
}

function post(id: string): CommunityPost {
	return {
		id,
		anon_id: "anon-a",
		author: "A",
		text: id,
		created_at: "2026-09-24T10:01:00.000Z",
		reactions: {},
		reaction_counts: { support: 1 },
		mine_reactions: { support: true },
		poll: null,
		comments: [],
		comment_count: 0,
	};
}

describe("community state reconciliation", () => {
	it("replaces a card without duplicating it", () => {
		const next = upsertCommunityCard([card], { ...card, hidden: true });
		expect(next).toHaveLength(1);
		expect(next[0]?.hidden).toBe(true);
	});

	it("inserts and removes one post while preserving other posts", () => {
		const first = insertCommunityPost(detail(), post("cp_1"), 1);
		const second = insertCommunityPost(first, post("cp_2"), 2);
		expect(second.posts.map((p) => p.id)).toEqual(["cp_1", "cp_2"]);
		expect(second.post_count).toBe(2);
		expect(removeCommunityPost(second, "cp_1", 1).posts.map((p) => p.id)).toEqual(["cp_2"]);
	});

	it("patches only the requested reaction count", () => {
		const next = patchCommunityReaction(insertCommunityPost(detail(), post("cp_1"), 1), "cp_1", {
			kind: "helpful",
			active: true,
			count: 4,
		});
		expect(next.posts[0]?.reaction_counts).toEqual({ support: 1, helpful: 4 });
		expect(next.posts[0]?.mine_reactions.helpful).toBe(true);
	});

	it("appends a comment to only its own thread", () => {
		const comment: CommunityComment = {
			id: "cc_1",
			anon_id: "anon-b",
			author: "B",
			text: "hello",
			created_at: "2026-09-24T10:02:00.000Z",
		};
		const next = appendCommunityComment({}, "cp_1", comment, 1);
		expect(next.cp_1?.items).toEqual([comment]);
	});
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npm test -- src/__tests__/communityState.test.ts
```

Expected: FAIL because `src/lib/communityState.ts` and `src/types/community.ts` do not exist.

- [ ] **Step 3: Add the exact public types**

Create `src/types/community.ts` with the full interface block in “Public response contract.” Do not rename snake_case API fields to camelCase.

- [ ] **Step 4: Implement immutable reducers**

Use these rules in `src/lib/communityState.ts`:

```ts
function replaceItem<T extends { id: string }>(items: T[], next: T): T[] {
	return [...items.filter((item) => item.id !== next.id), next];
}
```

For posts, order by `created_at` ascending and then `id` ascending. When inserting a post, deduplicate by ID, sort, retain the current loaded page count, and set `post_count` to the server’s `post_count`; when deleting, remove the ID and set `post_count` to the server value. Reaction updates must copy the post, `reaction_counts`, and `mine_reactions` objects rather than mutate them. `appendCommunityComment` deduplicates by comment ID, appends in server order, clears an existing error, and sets `next_cursor` to null for the first newly appended page.

- [ ] **Step 5: Run focused tests and typecheck**

Run sequentially:

```powershell
npm test -- src/__tests__/communityState.test.ts
npm run typecheck
```

Expected: reducer tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit the contract and reducers**

```powershell
git status --short
git add src/types/community.ts src/lib/communityState.ts src/__tests__/communityState.test.ts
git diff --cached --check
git commit -m "feat(communities): define normalized response and state contracts"
```

---

### Task 2: Add Settings-Key Uniqueness and the Additive Normalized Schema

**Files:**
- Create: `api/migrations/021_settings_key_unique.sql`
- Create: `api/migrations/022_community_normalized_schema.sql`
- Create: `tests/api/community-schema-contract.test.ts`

**Interfaces:**
- Consumes: Existing `settings(id uuid, key text, value jsonb, updated_at timestamptz)` and service-role-only access pattern.
- Produces: `communities`, `community_memberships`, `community_posts`, `community_comments`, `community_poll_options`, `community_reactions`, `community_votes`, and `community_summaries` with stable public child IDs.

- [ ] **Step 1: Write the failing schema contract test**

Create `tests/api/community-schema-contract.test.ts` to read the three migration files and assert exact security/constraint properties:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("api/migrations/022_community_normalized_schema.sql", "utf8");
const settings = readFileSync("api/migrations/021_settings_key_unique.sql", "utf8");

const tables = [
	"communities",
	"community_memberships",
	"community_posts",
	"community_comments",
	"community_poll_options",
	"community_reactions",
	"community_votes",
	"community_summaries",
];

describe("community normalized schema contract", () => {
	it("creates every normalized table", () => {
		for (const table of tables) {
			expect(schema).toContain(`public.${table}`);
		}
	});

	it("uses a concurrent unique settings-key index", () => {
		expect(settings).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS settings_key_uidx/i);
		expect(settings).toMatch(/ON public\.settings\(key\)/i);
	});

	it("enforces one membership, reaction, and vote per identity", () => {
		expect(schema).toContain("PRIMARY KEY (community_id, anon_id)");
		expect(schema).toContain("PRIMARY KEY (post_id, anon_id, kind)");
		expect(schema).toContain("PRIMARY KEY (post_id, voter_id)");
	});

	it("keeps direct client access denied", () => {
		expect(schema).toMatch(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
		expect(schema).toMatch(/ENABLE ROW LEVEL SECURITY/);
		expect(schema).toMatch(/TO service_role/);
		expect(schema).not.toMatch(/TO anon/);
	});

	it("does not publish community tables to Realtime", () => {
		expect(schema).not.toMatch(/supabase_realtime/i);
	});
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
```

Expected: FAIL because migrations `021` and `022` do not exist.

- [ ] **Step 3: Run the duplicate-key gate before creating the unique index**

Run this read-only query against the actual Voice Flow project, not an unrelated Supabase project:

```sql
SELECT key, count(*) AS copies,
       array_agg(id ORDER BY updated_at DESC NULLS LAST, id) AS settings_ids
FROM public.settings
WHERE key IS NOT NULL
GROUP BY key
HAVING count(*) > 1
ORDER BY copies DESC, key;
```

Expected before migration 021: zero rows. If any row appears, stop. Compare the referenced JSON documents; delete only byte-equivalent extras in a separately reviewed forward migration after a verified backup. If documents differ, record a human decision rather than merging arbitrary JSON.

Also run:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'settings'
ORDER BY indexname;
```

Expected: either an existing unique index whose first/only key is `settings.key`, or no such index. If an equivalent differently named index exists, do not run migration 021 on that environment until the migration is adjusted to avoid a redundant write-amplifying index.

- [ ] **Step 4: Create migration 021**

```sql
-- 021_settings_key_unique.sql
-- Run only after duplicate-key audit returns zero rows.
-- Forward-only: the old application also depends on ON CONFLICT (key).
-- Run outside a transaction because CREATE INDEX CONCURRENTLY cannot run in one.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS settings_key_uidx
  ON public.settings(key);
```

- [ ] **Step 5: Create migration 022 with this exact schema**

```sql
-- 022_community_normalized_schema.sql
-- Additive only. Legacy settings rows remain untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS public.communities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_key text UNIQUE,
  legacy_settings_id uuid UNIQUE,
  legacy_digest text,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '🌐',
  photo text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false,
  migrated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communities_legacy_metadata_check CHECK (
    (legacy_key IS NULL AND legacy_settings_id IS NULL AND legacy_digest IS NULL)
    OR
    (legacy_key IS NOT NULL AND legacy_settings_id IS NOT NULL AND legacy_digest IS NOT NULL)
  ),
  CONSTRAINT communities_legacy_digest_check CHECK (
    legacy_digest IS NULL OR legacy_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT communities_slug_check CHECK (
    char_length(slug) BETWEEN 1 AND 40
    AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT communities_name_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
  CONSTRAINT communities_description_check CHECK (char_length(description) <= 240),
  CONSTRAINT communities_avatar_check CHECK (char_length(avatar) <= 8),
  CONSTRAINT communities_photo_check CHECK (
    char_length(photo) <= 400
    AND (photo = '' OR photo ~ '^(https?://|data:image/)')
  ),
  CONSTRAINT communities_created_by_check CHECK (char_length(created_by) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS public.community_memberships (
  community_id bigint NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  anon_id text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, anon_id),
  CONSTRAINT community_memberships_anon_check CHECK (char_length(anon_id) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS public.community_posts (
  id text PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  anon_id text NOT NULL,
  author text NOT NULL DEFAULT '',
  body text NOT NULL,
  poll_id text,
  poll_question text,
  poll_created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_posts_id_check CHECK (char_length(id) BETWEEN 1 AND 24),
  CONSTRAINT community_posts_anon_check CHECK (char_length(anon_id) BETWEEN 1 AND 40),
  CONSTRAINT community_posts_author_check CHECK (char_length(author) <= 24),
  CONSTRAINT community_posts_body_check CHECK (char_length(body) BETWEEN 1 AND 500),
  CONSTRAINT community_posts_poll_shape_check CHECK (
    (poll_id IS NULL AND poll_question IS NULL AND poll_created_by IS NULL)
    OR
    (char_length(poll_id) BETWEEN 1 AND 24
      AND char_length(poll_question) BETWEEN 1 AND 80
      AND char_length(poll_created_by) BETWEEN 1 AND 40)
  )
);

CREATE TABLE IF NOT EXISTS public.community_comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  anon_id text NOT NULL,
  author text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_comments_id_check CHECK (char_length(id) BETWEEN 1 AND 24),
  CONSTRAINT community_comments_anon_check CHECK (char_length(anon_id) BETWEEN 1 AND 40),
  CONSTRAINT community_comments_author_check CHECK (char_length(author) <= 24),
  CONSTRAINT community_comments_body_check CHECK (char_length(body) BETWEEN 1 AND 400)
);

CREATE TABLE IF NOT EXISTS public.community_poll_options (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL,
  option_text text NOT NULL,
  CONSTRAINT community_poll_options_id_post_unique UNIQUE (id, post_id),
  CONSTRAINT community_poll_options_ordinal_check CHECK (ordinal BETWEEN 0 AND 3),
  CONSTRAINT community_poll_options_text_check CHECK (char_length(btrim(option_text)) BETWEEN 1 AND 40),
  CONSTRAINT community_poll_options_post_ordinal_unique UNIQUE (post_id, ordinal)
);

CREATE TABLE IF NOT EXISTS public.community_reactions (
  post_id text NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  anon_id text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, anon_id, kind),
  CONSTRAINT community_reactions_anon_check CHECK (char_length(anon_id) BETWEEN 1 AND 40),
  CONSTRAINT community_reactions_kind_check CHECK (char_length(kind) BETWEEN 1 AND 24)
);

CREATE TABLE IF NOT EXISTS public.community_votes (
  post_id text NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  voter_id text NOT NULL,
  option_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, voter_id),
  CONSTRAINT community_votes_voter_check CHECK (char_length(voter_id) BETWEEN 1 AND 40),
  CONSTRAINT community_votes_option_post_fk
    FOREIGN KEY (option_id, post_id)
    REFERENCES public.community_poll_options(id, post_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.community_summaries (
  community_id bigint PRIMARY KEY REFERENCES public.communities(id) ON DELETE CASCADE,
  member_count integer NOT NULL DEFAULT 0,
  post_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_summaries_member_count_check CHECK (member_count >= 0),
  CONSTRAINT community_summaries_post_count_check CHECK (post_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS community_posts_poll_id_uidx
  ON public.community_posts(poll_id) WHERE poll_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS communities_public_list_idx
  ON public.communities(created_at DESC, id DESC) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS community_memberships_anon_idx
  ON public.community_memberships(anon_id, community_id);
CREATE INDEX IF NOT EXISTS community_posts_feed_idx
  ON public.community_posts(community_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS community_posts_cooldown_idx
  ON public.community_posts(community_id, anon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_comments_post_created_idx
  ON public.community_comments(post_id, created_at, id);
CREATE INDEX IF NOT EXISTS community_reactions_post_kind_idx
  ON public.community_reactions(post_id, kind) INCLUDE (anon_id, created_at);
CREATE INDEX IF NOT EXISTS community_votes_post_option_idx
  ON public.community_votes(post_id, option_id);
CREATE INDEX IF NOT EXISTS community_votes_option_post_idx
  ON public.community_votes(option_id, post_id);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'communities', 'community_memberships', 'community_posts',
    'community_comments', 'community_poll_options', 'community_reactions',
    'community_votes', 'community_summaries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = 'service_role_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        table_name
      );
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 6: Run the static contract test**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Apply only to dedicated staging and inspect**

On the approved staging workstation with PostgreSQL 16+:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f api/migrations/021_settings_key_unique.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f api/migrations/022_community_normalized_schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'community%' ORDER BY tablename;"
```

Expected: eight normalized tables, `rowsecurity = true`, and zero rows because backfill has not run.

- [ ] **Step 8: Commit the additive schema**

```powershell
git add api/migrations/021_settings_key_unique.sql api/migrations/022_community_normalized_schema.sql tests/api/community-schema-contract.test.ts
git diff --cached --check
git commit -m "feat(db): add normalized community schema"
```

---

### Task 3: Maintain the Compact Summary Projection

**Files:**
- Create: `api/migrations/023_community_summary_projection.sql`
- Modify: `tests/api/community-schema-contract.test.ts`

**Interfaces:**
- Consumes: `communities`, `community_memberships`, `community_posts`, and `community_summaries` from Task 2.
- Produces: one summary row per community and exact count maintenance for inserts/deletes/cascades.

- [ ] **Step 1: Add failing trigger-contract assertions**

Extend the schema test:

```ts
const projection = readFileSync("api/migrations/023_community_summary_projection.sql", "utf8");

it("maintains summary rows with guarded trigger functions", () => {
	expect(projection).toContain("community_summary_after_community");
	expect(projection).toContain("community_summary_after_membership");
	expect(projection).toContain("community_summary_after_post");
	expect(projection).toMatch(/SECURITY INVOKER/);
	expect(projection).toMatch(/SET search_path = ''/);
	expect(projection).toMatch(/GREATEST\(0, member_count ([+-]) 1\)/);
	expect(projection).toMatch(/GREATEST\(0, post_count ([+-]) 1\)/);
});
```

- [ ] **Step 2: Run the test and confirm RED**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
```

Expected: FAIL because migration 023 is absent.

- [ ] **Step 3: Create migration 023**

```sql
-- 023_community_summary_projection.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.community_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_summary_after_community()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.community_summaries(community_id, member_count, post_count)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (community_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_summary_after_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_summaries
       SET member_count = member_count + 1, updated_at = now()
     WHERE community_id = NEW.community_id;
    RETURN NEW;
  END IF;

  UPDATE public.community_summaries
     SET member_count = GREATEST(0, member_count - 1), updated_at = now()
   WHERE community_id = OLD.community_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_summary_after_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_summaries
       SET post_count = post_count + 1, updated_at = now()
     WHERE community_id = NEW.community_id;
    RETURN NEW;
  END IF;

  UPDATE public.community_summaries
     SET post_count = GREATEST(0, post_count - 1), updated_at = now()
   WHERE community_id = OLD.community_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS communities_touch_updated_at ON public.communities;
DROP TRIGGER IF EXISTS community_summary_init ON public.communities;
DROP TRIGGER IF EXISTS community_summary_memberships ON public.community_memberships;
DROP TRIGGER IF EXISTS community_summary_posts ON public.community_posts;

CREATE TRIGGER communities_touch_updated_at
BEFORE UPDATE ON public.communities
FOR EACH ROW EXECUTE FUNCTION public.community_touch_updated_at();

CREATE TRIGGER community_summary_init
AFTER INSERT ON public.communities
FOR EACH ROW EXECUTE FUNCTION public.community_summary_after_community();

CREATE TRIGGER community_summary_memberships
AFTER INSERT OR DELETE ON public.community_memberships
FOR EACH ROW EXECUTE FUNCTION public.community_summary_after_membership();

CREATE TRIGGER community_summary_posts
AFTER INSERT OR DELETE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.community_summary_after_post();

REVOKE ALL ON FUNCTION public.community_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_summary_after_community() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_summary_after_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_summary_after_post() FROM PUBLIC, anon, authenticated;

COMMIT;
```

- [ ] **Step 4: Verify trigger behavior in staging**

```sql
BEGIN;
INSERT INTO public.communities(slug, name, created_by)
VALUES ('projection-test', 'Projection Test', 'anon-test');
INSERT INTO public.community_memberships(community_id, anon_id)
SELECT id, 'anon-a' FROM public.communities WHERE slug='projection-test';
INSERT INTO public.community_posts(id, community_id, anon_id, body)
SELECT 'cp_projection_test', id, 'anon-a', 'test'
FROM public.communities WHERE slug='projection-test';
SELECT member_count, post_count
FROM public.community_summaries
WHERE community_id=(SELECT id FROM public.communities WHERE slug='projection-test');
ROLLBACK;
```

Expected: `member_count = 1`, `post_count = 1`.

- [ ] **Step 5: Run tests and commit**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
git add api/migrations/023_community_summary_projection.sql tests/api/community-schema-contract.test.ts
git diff --cached --check
git commit -m "feat(db): maintain community summary projection"
```

---

### Task 4: Add Bounded Normalized Read RPCs

**Files:**
- Create: `api/migrations/024_community_normalized_reads.sql`
- Create: `tests/api/community-schema-contract.test.ts` additions only.

**Interfaces:**
- `community_list(p_include_hidden boolean DEFAULT false) RETURNS jsonb`
- `community_get(p_slug text, p_anon_id text, p_include_hidden boolean DEFAULT false, p_limit integer DEFAULT 20, p_before_created_at timestamptz DEFAULT NULL, p_before_id text DEFAULT NULL) RETURNS jsonb`
- `community_comment_page(p_slug text, p_post_id text, p_include_hidden boolean DEFAULT false, p_limit integer DEFAULT 50, p_before_created_at timestamptz DEFAULT NULL, p_before_id text DEFAULT NULL) RETURNS jsonb`
- `community_stats() RETURNS jsonb`

All four return JSON already shaped for the TypeScript interfaces. No Node-side row hydration is permitted in normalized read mode.

- [ ] **Step 1: Add failing RPC security assertions**

Assert migration 024 contains every signature, `SECURITY INVOKER`, `SET search_path = ''`, service-role grants, and revokes from `PUBLIC`, `anon`, and `authenticated`.

- [ ] **Step 2: Run the contract test and confirm RED**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
```

Expected: FAIL because migration 024 is absent.

- [ ] **Step 3: Create the list and stats RPCs exactly**

```sql
CREATE OR REPLACE FUNCTION public.community_list(p_include_hidden boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'communities',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slug', c.slug,
          'name', c.name,
          'description', c.description,
          'avatar', c.avatar,
          'photo', c.photo,
          'created_by', c.created_by,
          'created_at', c.created_at,
          'hidden', c.hidden,
          'member_count', s.member_count,
          'post_count', s.post_count
        ) ORDER BY c.created_at DESC, c.id DESC
      ),
      '[]'::jsonb
    )
  )
  FROM (
    SELECT c.*, s.member_count, s.post_count
    FROM public.communities c
    JOIN public.community_summaries s ON s.community_id = c.id
    WHERE p_include_hidden OR c.hidden = false
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 200
  ) c;
$$;

CREATE OR REPLACE FUNCTION public.community_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'communities', (SELECT count(*) FROM public.communities),
    'members', (SELECT count(*) FROM public.community_memberships),
    'posts', (SELECT count(*) FROM public.community_posts)
  );
$$;
```

- [ ] **Step 4: Implement `community_get` with a 20-row cursor and aggregate-only child data**

The function must:

1. Clamp `p_limit` to 1..20.
2. Return the existing community shape plus `members`, `is_member`, `is_creator`, `posts`, and `next_cursor`.
3. Select newest rows by `(created_at DESC, id DESC)`, retain 20, and return them oldest-first to the UI.
4. Set `next_cursor` to the literal `created_at|id` pair for the oldest visible post only when an additional row exists.
5. Return `reactions = '{}'`, exact reaction counts, exact viewer reactions, poll options with exact vote counts, `my_vote`, `total_votes`, `comments = '[]'`, and exact `comment_count`.
6. Raise SQLSTATE `P0002` with `Community not found` for missing or hidden non-admin communities.

Use this post JSON expression inside the page query:

```sql
jsonb_build_object(
  'id', p.id,
  'anon_id', p.anon_id,
  'author', p.author,
  'text', p.body,
  'created_at', p.created_at,
  'reactions', '{}'::jsonb,
  'reaction_counts', coalesce((
    SELECT jsonb_object_agg(kind, cnt)
    FROM (
      SELECT kind, count(*)::int AS cnt
      FROM public.community_reactions
      WHERE post_id = p.id
      GROUP BY kind
    ) counts
  ), '{}'::jsonb),
  'mine_reactions', coalesce((
    SELECT jsonb_object_agg(kind, true)
    FROM public.community_reactions
    WHERE post_id = p.id AND anon_id = nullif(p_anon_id, '')
  ), '{}'::jsonb),
  'poll', CASE WHEN p.poll_id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p.poll_id,
    'question', p.poll_question,
    'options', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'text', o.option_text,
        'votes', (
          SELECT count(*)::int FROM public.community_votes v
          WHERE v.post_id = p.id AND v.option_id = o.id
        )
      ) ORDER BY o.ordinal)
      FROM public.community_poll_options o
      WHERE o.post_id = p.id
    ), '[]'::jsonb),
    'created_by', p.poll_created_by,
    'my_vote', (
      SELECT v.option_id FROM public.community_votes v
      WHERE v.post_id = p.id AND v.voter_id = nullif(p_anon_id, '')
    ),
    'total_votes', (
      SELECT count(*)::int FROM public.community_votes v WHERE v.post_id = p.id
    )
  ) END END,
  'comments', '[]'::jsonb,
  'comment_count', (
    SELECT count(*)::int FROM public.community_comments c WHERE c.post_id = p.id
  )
)
```

Create the function around that expression with this exact control flow:

```sql
CREATE OR REPLACE FUNCTION public.community_get(
  p_slug text,
  p_anon_id text,
  p_include_hidden boolean DEFAULT false,
  p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_community public.communities%ROWTYPE;
  v_summary public.community_summaries%ROWTYPE;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_post_ids text[];
  v_post_count integer;
  v_next_cursor text;
  v_posts jsonb;
  v_members jsonb;
  v_is_member boolean;
BEGIN
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = 'Invalid cursor';
  END IF;

  SELECT * INTO v_community
  FROM public.communities
  WHERE slug = p_slug;

  IF NOT FOUND OR (v_community.hidden AND NOT coalesce(p_include_hidden, false)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Community not found';
  END IF;

  SELECT * INTO v_summary
  FROM public.community_summaries
  WHERE community_id = v_community.id;

  SELECT array_agg(page.id ORDER BY page.created_at DESC, page.id DESC)
  INTO v_post_ids
  FROM (
    SELECT p.id, p.created_at
    FROM public.community_posts p
    WHERE p.community_id = v_community.id
      AND (
        p_before_created_at IS NULL
        OR (p.created_at, p.id) < (p_before_created_at, p_before_id)
      )
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT v_limit + 1
  ) page;

  v_post_count := coalesce(array_length(v_post_ids, 1), 0);
  IF v_post_count > v_limit THEN
    v_post_ids := v_post_ids[1:v_limit];
    SELECT p.created_at::text || '|' || p.id
    INTO v_next_cursor
    FROM public.community_posts p
    WHERE p.id = v_post_ids[v_limit];
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'anon_id', p.anon_id,
           'author', p.author,
           'text', p.body,
           'created_at', p.created_at,
           'reactions', '{}'::jsonb,
           'reaction_counts', coalesce((
             SELECT jsonb_object_agg(kind, cnt)
             FROM (
               SELECT r.kind, count(*)::int AS cnt
               FROM public.community_reactions r
               WHERE r.post_id = p.id
               GROUP BY r.kind
             ) counts
           ), '{}'::jsonb),
           'mine_reactions', coalesce((
             SELECT jsonb_object_agg(r.kind, true)
             FROM public.community_reactions r
             WHERE r.post_id = p.id
               AND r.anon_id = nullif(p_anon_id, '')
           ), '{}'::jsonb),
           'poll', CASE WHEN p.poll_id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', p.poll_id,
             'question', p.poll_question,
             'options', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                 'id', o.id,
                 'text', o.option_text,
                 'votes', (
                   SELECT count(*)::int
                   FROM public.community_votes v
                   WHERE v.post_id = p.id AND v.option_id = o.id
                 )
               ) ORDER BY o.ordinal)
               FROM public.community_poll_options o
               WHERE o.post_id = p.id
             ), '[]'::jsonb),
             'created_by', p.poll_created_by,
             'my_vote', (
               SELECT v.option_id
               FROM public.community_votes v
               WHERE v.post_id = p.id
                 AND v.voter_id = nullif(p_anon_id, '')
             ),
             'total_votes', (
               SELECT count(*)::int
               FROM public.community_votes v
               WHERE v.post_id = p.id
             )
           ) END END,
           'comments', '[]'::jsonb,
           'comment_count', (
             SELECT count(*)::int
             FROM public.community_comments c
             WHERE c.post_id = p.id
           )
         ) ORDER BY p.created_at, p.id), '[]'::jsonb)
  INTO v_posts
  FROM public.community_posts p
  WHERE p.id = ANY(v_post_ids);

  SELECT coalesce(jsonb_agg(m.anon_id ORDER BY m.joined_at, m.anon_id), '[]'::jsonb)
  INTO v_members
  FROM (
    SELECT anon_id, joined_at
    FROM public.community_memberships
    WHERE community_id = v_community.id
    ORDER BY joined_at, anon_id
    LIMIT 500
  ) m;

  SELECT EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = v_community.id
      AND anon_id = nullif(p_anon_id, '')
  ) INTO v_is_member;

  RETURN jsonb_build_object(
    'slug', v_community.slug,
    'name', v_community.name,
    'description', v_community.description,
    'avatar', v_community.avatar,
    'photo', v_community.photo,
    'created_by', v_community.created_by,
    'created_at', v_community.created_at,
    'hidden', v_community.hidden,
    'member_count', v_summary.member_count,
    'post_count', v_summary.post_count,
    'members', v_members,
    'is_member', coalesce(v_is_member, false),
    'is_creator', nullif(p_anon_id, '') = v_community.created_by,
    'posts', v_posts,
    'next_cursor', v_next_cursor
  );
END;
$$;
```

- [ ] **Step 5: Implement `community_comment_page` with a 50-row cursor**

Return oldest-first comments and `next_cursor` using the same literal `created_at|id` format. Clamp `p_limit` to 1..50. Verify the post belongs to `p_slug`; raise `P0002` for missing/hidden community or missing post.

```sql
CREATE OR REPLACE FUNCTION public.community_comment_page(
  p_slug text,
  p_post_id text,
  p_include_hidden boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_hidden boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_comment_ids text[];
  v_count integer;
  v_next_cursor text;
  v_comments jsonb;
BEGIN
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = 'Invalid cursor';
  END IF;

  SELECT c.hidden
  INTO v_hidden
  FROM public.community_posts p
  JOIN public.communities c ON c.id = p.community_id
  WHERE c.slug = p_slug AND p.id = p_post_id;

  IF NOT FOUND OR (v_hidden AND NOT coalesce(p_include_hidden, false)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Post not found';
  END IF;

  SELECT array_agg(page.id ORDER BY page.created_at, page.id)
  INTO v_comment_ids
  FROM (
    SELECT c.id, c.created_at
    FROM public.community_comments c
    WHERE c.post_id = p_post_id
      AND (
        p_before_created_at IS NULL
        OR (c.created_at, c.id) > (p_before_created_at, p_before_id)
      )
    ORDER BY c.created_at, c.id
    LIMIT v_limit + 1
  ) page;

  v_count := coalesce(array_length(v_comment_ids, 1), 0);
  IF v_count > v_limit THEN
    v_comment_ids := v_comment_ids[1:v_limit];
    SELECT c.created_at::text || '|' || c.id
    INTO v_next_cursor
    FROM public.community_comments c
    WHERE c.id = v_comment_ids[v_limit];
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'anon_id', c.anon_id,
           'author', c.author,
           'text', c.body,
           'created_at', c.created_at
         ) ORDER BY c.created_at, c.id), '[]'::jsonb)
  INTO v_comments
  FROM public.community_comments c
  WHERE c.id = ANY(v_comment_ids);

  RETURN jsonb_build_object(
    'comments', v_comments,
    'next_cursor', v_next_cursor
  );
END;
$$;
```

- [ ] **Step 6: Grant and revoke function access**

For every function with its exact signature:

```sql
REVOKE ALL ON FUNCTION public.community_list(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_get(text,text,boolean,integer,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_comment_page(text,text,boolean,integer,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_list(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_get(text,text,boolean,integer,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_comment_page(text,text,boolean,integer,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_stats() TO service_role;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 7: Apply to staging and verify security/query shape**

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f api/migrations/024_community_normalized_reads.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT has_function_privilege('anon','public.community_get(text,text,boolean,integer,timestamptz,text)','execute') AS anon_execute, has_function_privilege('service_role','public.community_get(text,text,boolean,integer,timestamptz,text)','execute') AS service_execute;"
```

Expected: `anon_execute = false`, `service_execute = true`.

- [ ] **Step 8: Run tests and commit**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
git add api/migrations/024_community_normalized_reads.sql tests/api/community-schema-contract.test.ts
git diff --cached --check
git commit -m "feat(db): add bounded community read functions"
```

---

### Task 5: Add Atomic, Lock-Safe Community Mutation RPCs

**Files:**
- Create: `api/migrations/025_community_normalized_writes.sql`
- Modify: `tests/api/community-schema-contract.test.ts`

**Interfaces:**
- `community_create(p_slug text, p_name text, p_description text, p_avatar text, p_photo text, p_anon_id text) RETURNS jsonb`
- `community_set_membership(p_slug text, p_anon_id text, p_join boolean) RETURNS jsonb`
- `community_create_post(p_slug text, p_anon_id text, p_author text, p_body text, p_post_id text, p_poll jsonb DEFAULT NULL) RETURNS jsonb`
- `community_create_comment(p_slug text, p_post_id text, p_anon_id text, p_author text, p_body text, p_comment_id text) RETURNS jsonb`
- `community_toggle_reaction(p_slug text, p_post_id text, p_anon_id text, p_kind text, p_active boolean DEFAULT NULL) RETURNS jsonb`
- `community_cast_vote(p_slug text, p_post_id text, p_anon_id text, p_option_id text) RETURNS jsonb`
- `community_delete_post(p_slug text, p_post_id text, p_anon_id text, p_actor_is_admin boolean, p_solve_poll boolean DEFAULT false) RETURNS jsonb`
- `community_admin(p_slug text, p_op text, p_actor_is_admin boolean) RETURNS jsonb`

SQLSTATE contract:

| SQLSTATE | Meaning | HTTP |
|---|---|---:|
| `P0002` | Community/post not found or hidden | 404 |
| `P0003` | 15-second post cooldown | 429 |
| `P0004` | Member/post/comment/reaction limit | 400 |
| `P0005` | Membership/ownership/admin denial | 403 |
| `23505` | Duplicate community slug or conflicting client ID | 409 |
| `40001` / `40P01` | Serialization/deadlock; one safe retry | 503 |

- [ ] **Step 1: Add failing write-function contract assertions**

Assert every signature exists, all functions are `VOLATILE SECURITY INVOKER`, all set an empty search path, and no function is granted to `anon` or `authenticated`.

- [ ] **Step 2: Run the contract test and confirm RED**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
```

Expected: FAIL because migration 025 is absent.

- [ ] **Step 3: Implement create and membership with deterministic locks**

`community_create` must execute this ordering:

```sql
PERFORM pg_advisory_xact_lock(hashtextextended('community-create:' || p_anon_id, 0));
IF (SELECT count(*) FROM public.communities
    WHERE created_by = p_anon_id AND hidden = false) >= 5 THEN
  RAISE EXCEPTION USING ERRCODE = 'P0004',
    MESSAGE = 'You can create at most 5 communities';
END IF;
INSERT INTO public.communities(slug, name, description, avatar, photo, created_by)
VALUES (p_slug, p_name, p_description, p_avatar, p_photo, p_anon_id);
INSERT INTO public.community_memberships(community_id, anon_id)
VALUES (id, p_anon_id);
```

Use `RETURNING id INTO v_community_id`, then return the same ten-field card projection defined by `community_list` under the `community` key.

`community_set_membership` must lock the community row before counting:

```sql
SELECT id, hidden INTO v_community_id, v_hidden
FROM public.communities
WHERE slug = p_slug
FOR UPDATE;
```

Raise `P0002` when absent/hidden. On join, raise `P0004` when the current count is already 500, then execute:

```sql
INSERT INTO public.community_memberships(community_id, anon_id)
VALUES (v_community_id, p_anon_id)
ON CONFLICT (community_id, anon_id) DO NOTHING;
```

On leave, execute:

```sql
DELETE FROM public.community_memberships
WHERE community_id = v_community_id AND anon_id = p_anon_id;
```

Return the authoritative `is_member` and `community_summaries.member_count`.

- [ ] **Step 4: Implement post creation with membership/cooldown/cap locks**

`community_create_post` must:

1. Lock the matching membership row and raise `P0005` when it is absent:

```sql
SELECT community_id
INTO v_membership_community_id
FROM public.community_memberships
WHERE community_id = v_community_id AND anon_id = p_anon_id
FOR UPDATE;
IF v_membership_community_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = 'P0005',
    MESSAGE = 'Join the community to post';
END IF;
```

2. If a row with `p_post_id` already exists for the same community/author/body, return it; if it exists with different content, raise `23505`.
3. Query the actor’s latest post in that community. If it is newer than `now() - interval '15 seconds'`, raise `P0003` with `Please wait between messages`.
4. Insert the post. If `p_poll` is non-null, validate question length 1..80 and exactly 2..4 option objects, then insert with `jsonb_array_elements(p_poll->'options') WITH ORDINALITY AS option(value, ordinal)` and preserve each supplied option ID.
5. Acquire `pg_advisory_xact_lock(hashtextextended('community-post-cap:' || v_community_id, 0))` and delete rows beyond 300:

```sql
DELETE FROM public.community_posts
WHERE id IN (
  SELECT id FROM public.community_posts
  WHERE community_id = v_community_id
  ORDER BY created_at DESC, id DESC
  OFFSET 300
);
```

6. Return the exact post JSON expression defined in Task 4 under the `post` key and the summary’s current count under `post_count`.

- [ ] **Step 5: Implement comment/reaction functions with per-post row locks**

Both functions lock the post row with `FOR UPDATE` before checking limits, which serializes the 100-comment and 200-reaction caps without a read-then-write race. A repeated comment ID with the same post/author/body returns the existing comment; a conflicting ID raises `23505`.

`community_toggle_reaction` uses desired state when provided:

```sql
SELECT EXISTS (
  SELECT 1 FROM public.community_reactions
  WHERE post_id = p_post_id AND anon_id = p_anon_id AND kind = p_kind
) INTO v_exists;

v_active := coalesce(p_active, NOT v_exists);
IF v_active AND NOT v_exists
   AND (SELECT count(*) FROM public.community_reactions
        WHERE post_id = p_post_id AND kind = p_kind) >= 200 THEN
  RAISE EXCEPTION USING ERRCODE = 'P0004',
    MESSAGE = 'Reaction limit reached on this post';
END IF;

IF v_active THEN
  INSERT INTO public.community_reactions(post_id, anon_id, kind)
  VALUES (p_post_id, p_anon_id, p_kind);
ELSE
  DELETE FROM public.community_reactions
  WHERE post_id = p_post_id AND anon_id = p_anon_id AND kind = p_kind;
END IF;
```

Return the post-locked count. `p_active IS NULL` preserves legacy toggle behavior; the updated UI sends explicit desired state.

- [ ] **Step 6: Implement vote upsert and authoritative poll response**

Verify the option belongs to the post, then use one statement:

```sql
INSERT INTO public.community_votes(post_id, voter_id, option_id)
VALUES (p_post_id, p_anon_id, p_option_id)
ON CONFLICT (post_id, voter_id)
DO UPDATE SET option_id = EXCLUDED.option_id, updated_at = now();
```

Return `ok = true`, `my_vote = p_option_id`, and a `poll` object containing `id`, `question`, ordinal `options` with exact `votes`, `created_by`, `my_vote`, and `total_votes`. The primary key makes concurrent first votes converge to exactly one row.

- [ ] **Step 7: Implement delete and admin mutations**

`community_delete_post` locks the post, enforces author/admin, enforces poll existence when `p_solve_poll = true`, allows the poll creator to solve, deletes the post, and returns the projection `post_count`. Cascades remove comments, reactions, options, and votes; triggers decrement the projection.

`community_admin` first raises `P0005` when `p_actor_is_admin = false`, locks the community, then performs exactly one operation:

- `hide`: set `hidden = true`, return `{ ok: true, hidden: true, community: card }`.
- `unhide`: set `hidden = false`, return `{ ok: true, hidden: false, community: card }`.
- `delete`: delete the community and return `{ ok: true, deleted: true }`.
- Any other value raises `P0004` with `Unknown admin op`.

- [ ] **Step 8: Grant/revoke all write functions and apply to staging**

Use explicit signature-specific revokes/grants. Then:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f api/migrations/025_community_normalized_writes.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname LIKE 'community_%' ORDER BY proname;"
```

Expected: all new functions show `prosecdef = false` and `search_path = \"\"`.

- [ ] **Step 9: Run tests and commit**

```powershell
npm run test:api -- tests/api/community-schema-contract.test.ts
git add api/migrations/025_community_normalized_writes.sql tests/api/community-schema-contract.test.ts
git diff --cached --check
git commit -m "feat(db): add atomic community mutations"
```

---

### Task 6: Build Idempotent Backfill, Verification, and Recovery Tools

**Files:**
- Create: `api/migrations/026_community_migration_tools.sql`
- Create: `scripts/lib/community-legacy.mjs`
- Create: `scripts/community-normalization.mjs`
- Create: `tests/api/community-normalization-script.test.ts`
- Modify: `package.json`

**Interfaces:**
- `community_import_legacy(p_settings_id uuid, p_legacy_key text, p_document jsonb, p_digest text) RETURNS jsonb`
- `community_verify_backfill() RETURNS jsonb`
- `community_export_legacy(p_slug text) RETURNS jsonb`
- `community_rebuild_summaries() RETURNS jsonb`
- CLI commands:

```text
node scripts/community-normalization.mjs audit
node scripts/community-normalization.mjs backfill --batch-size 20
node scripts/community-normalization.mjs verify
node scripts/community-normalization.mjs rebuild-summaries
node scripts/community-normalization.mjs replay-legacy --all
node scripts/community-normalization.mjs replay-legacy --slug study-gang
```

- [ ] **Step 1: Write failing validator/canonicalization tests**

`tests/api/community-normalization-script.test.ts` must import the pure `.mjs` helpers and prove:

```js
import { describe, expect, it } from "vitest";
import {
	auditLegacyDocuments,
	canonicalizeLegacyDocument,
	stableStringify,
} from "../../scripts/lib/community-legacy.mjs";

const document = {
	slug: "book-club",
	name: "Book Club",
	description: "",
	avatar: "📚",
	photo: "",
	created_by: "anon-a",
	created_at: "2026-09-24T10:00:00.000Z",
	hidden: false,
	members: ["anon-b", "anon-a"],
	posts: [
		{
			id: "cp_1",
			anon_id: "anon-a",
			author: "A",
			text: "hello",
			created_at: "2026-09-24T10:01:00.000Z",
			reactions: { support: ["anon-b", "anon-a"] },
			comments: [],
			poll: null,
		},
	],
};

describe("community legacy migration helpers", () => {
	it("sorts semantically unordered collections deterministically", () => {
		expect(stableStringify(canonicalizeLegacyDocument(document))).toBe(
			stableStringify(canonicalizeLegacyDocument({
				...document,
				members: [...document.members].reverse(),
				posts: [{
					...document.posts[0],
					reactions: { support: [...document.posts[0].reactions.support].reverse() },
				}],
			})),
		);
	});

	it("rejects duplicate global post and comment IDs", () => {
		const report = auditLegacyDocuments([
			{ settings_id: "00000000-0000-0000-0000-000000000001", key: "community:a", value: document },
			{
				settings_id: "00000000-0000-0000-0000-000000000002",
				key: "community:b",
				value: {
					...document,
					slug: "b",
					posts: [document.posts[0], document.posts[0]],
				},
			},
		]);
		expect(report.ok).toBe(false);
		expect(report.issues.map((issue) => issue.code)).toContain("duplicate_post_id");
	});

	it("rejects one voter assigned to multiple poll options", () => {
		const pollDocument = {
			...document,
			posts: [{
				...document.posts[0],
				poll: {
					id: "cv_1",
					question: "Q?",
					created_by: "anon-a",
					options: [{ id: "co_a", text: "A" }, { id: "co_b", text: "B" }],
					votes: { co_a: ["anon-b"], co_b: ["anon-b"] },
				},
			}],
		};
		const report = auditLegacyDocuments([
			{ settings_id: "00000000-0000-0000-0000-000000000001", key: "community:a", value: pollDocument },
		]);
		expect(report.issues.map((issue) => issue.code)).toContain("voter_in_multiple_options");
	});
});
```

Append this table-driven coverage for every remaining issue code:

```js
const SETTINGS_A = {
	settings_id: "00000000-0000-0000-0000-000000000001",
	key: "community:book-club",
	value: document,
};

function auditOne(value) {
	return auditLegacyDocuments([{ ...SETTINGS_A, value }]);
}

const singleValueCases = [
	["document_not_object", null],
	["slug_key_mismatch", { ...document, slug: "different-slug" }],
	["invalid_name", { ...document, name: "!" }],
	["missing_created_by", { ...document, created_by: "" }],
	["invalid_created_at", { ...document, created_at: "not-a-timestamp" }],
	["members_not_array", { ...document, members: {} }],
	["posts_not_array", { ...document, posts: {} }],
	["post_id_missing_or_duplicate", {
		...document,
		posts: [document.posts[0], document.posts[0]],
	}],
	["comments_not_array", {
		...document,
		posts: [{ ...document.posts[0], comments: {} }],
	}],
	["comment_id_missing_or_duplicate", {
		...document,
		posts: [{
			...document.posts[0],
			comments: [
				{ id: "cc_1", anon_id: "anon-b", author: "B", text: "one", created_at: "2026-09-24T10:02:00.000Z" },
				{ id: "cc_1", anon_id: "anon-c", author: "C", text: "two", created_at: "2026-09-24T10:03:00.000Z" },
			],
		}],
	}],
	["poll_option_id_missing_or_duplicate", {
		...document,
		posts: [{
			...document.posts[0],
			poll: {
				id: "cv_1",
				question: "Q?",
				created_by: "anon-a",
				options: [{ text: "A" }, { id: "co_b", text: "B" }],
				votes: {},
			},
		}],
	}],
	["reaction_value_not_array", {
		...document,
		posts: [{ ...document.posts[0], reactions: { support: {} } }],
	}],
	["count_limit_exceeded", {
		...document,
		members: Array.from({ length: 501 }, (_, index) => `anon-${index}`),
	}],
];

it.each(singleValueCases)("reports %s", (code, value) => {
	expect(auditOne(value).issues.map((issue) => issue.code)).toContain(code);
});

it("reports duplicate_settings_key", () => {
	const report = auditLegacyDocuments([SETTINGS_A, { ...SETTINGS_A }]);
	expect(report.issues.map((issue) => issue.code)).toContain("duplicate_settings_key");
});
```

- [ ] **Step 2: Run the script test and confirm RED**

```powershell
npm run test:api -- tests/api/community-normalization-script.test.ts
```

Expected: FAIL because the script helpers do not exist.

- [ ] **Step 3: Implement exact audit issue codes**

`auditLegacyDocuments(rows)` returns:

```ts
interface LegacyAuditIssue {
	settings_id: string;
	key: string;
	code:
		| "duplicate_settings_key"
		| "document_not_object"
		| "slug_key_mismatch"
		| "invalid_name"
		| "missing_created_by"
		| "invalid_created_at"
		| "members_not_array"
		| "posts_not_array"
		| "post_id_missing_or_duplicate"
		| "comments_not_array"
		| "comment_id_missing_or_duplicate"
		| "poll_option_id_missing_or_duplicate"
		| "voter_in_multiple_options"
		| "reaction_value_not_array"
		| "count_limit_exceeded";
}
```

The audit must inspect duplicate keys across all settings rows, post IDs across all communities, comment IDs across all posts, option IDs across all posts, membership duplicates, reaction duplicates, and cross-option voter duplicates. `ok` is true only when `issues.length === 0`.

- [ ] **Step 4: Implement canonicalization**

`canonicalizeLegacyDocument` must:

- Sort object keys through `stableStringify`.
- Sort and deduplicate members.
- Sort posts by ID and comments by ID.
- Sort reaction kind keys and each kind’s actor array.
- Keep poll option array order because it is display order.
- Sort vote keys and each option’s voter array.
- Preserve all scalar fields and `created_at` values exactly.

- [ ] **Step 5: Create migration 026 RPCs**

Implement `community_import_legacy` as an idempotent, insert-only transaction under a per-key advisory lock:

```sql
CREATE OR REPLACE FUNCTION public.community_import_legacy(
  p_settings_id uuid,
  p_legacy_key text,
  p_document jsonb,
  p_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_community_id bigint;
  v_slug text;
  v_existing_digest text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_legacy_key, 0));
  v_slug := split_part(p_legacy_key, ':', 2);

  IF jsonb_typeof(p_document) <> 'object'
     OR p_legacy_key <> 'community:' || v_slug
     OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR p_digest !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_document->'members') <> 'array'
     OR jsonb_typeof(p_document->'posts') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0004',
      MESSAGE = 'Invalid legacy community document';
  END IF;

  SELECT legacy_digest
  INTO v_existing_digest
  FROM public.communities
  WHERE legacy_key = p_legacy_key;

  IF FOUND THEN
    IF v_existing_digest <> p_digest THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        MESSAGE = 'Legacy community changed during backfill';
    END IF;

    SELECT id INTO v_community_id
    FROM public.communities
    WHERE legacy_key = p_legacy_key;

    RETURN jsonb_build_object(
      'slug', v_slug,
      'member_count', (SELECT count(*)::int FROM public.community_memberships WHERE community_id = v_community_id),
      'post_count', (SELECT count(*)::int FROM public.community_posts WHERE community_id = v_community_id),
      'comment_count', (SELECT count(*)::int FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id WHERE p.community_id = v_community_id),
      'reaction_count', (SELECT count(*)::int FROM public.community_reactions r JOIN public.community_posts p ON p.id = r.post_id WHERE p.community_id = v_community_id),
      'vote_count', (SELECT count(*)::int FROM public.community_votes v JOIN public.community_posts p ON p.id = v.post_id WHERE p.community_id = v_community_id)
    );
  END IF;

  INSERT INTO public.communities(
    legacy_key, legacy_settings_id, legacy_digest, slug, name,
    description, avatar, photo, created_by, created_at, hidden, migrated_at
  )
  VALUES (
    p_legacy_key,
    p_settings_id,
    p_digest,
    v_slug,
    p_document->>'name',
    coalesce(p_document->>'description', ''),
    coalesce(nullif(p_document->>'avatar', ''), '🌐'),
    coalesce(p_document->>'photo', ''),
    p_document->>'created_by',
    (p_document->>'created_at')::timestamptz,
    coalesce((p_document->>'hidden')::boolean, false),
    now()
  )
  RETURNING id INTO v_community_id;

  INSERT INTO public.community_memberships(community_id, anon_id, joined_at)
  SELECT DISTINCT v_community_id, member.value #>> '{}', now()
  FROM jsonb_array_elements(p_document->'members') AS member(value);

  INSERT INTO public.community_posts(
    id, community_id, anon_id, author, body,
    poll_id, poll_question, poll_created_by, created_at
  )
  SELECT
    legacy_post.value->>'id',
    v_community_id,
    legacy_post.value->>'anon_id',
    coalesce(legacy_post.value->>'author', ''),
    legacy_post.value->>'text',
    nullif(legacy_post.value->'poll'->>'id', ''),
    nullif(legacy_post.value->'poll'->>'question', ''),
    nullif(legacy_post.value->'poll'->>'created_by', ''),
    (legacy_post.value->>'created_at')::timestamptz
  FROM jsonb_array_elements(p_document->'posts') AS legacy_post(value);

  INSERT INTO public.community_comments(id, post_id, anon_id, author, body, created_at)
  SELECT
    legacy_comment.value->>'id',
    legacy_post.value->>'id',
    legacy_comment.value->>'anon_id',
    coalesce(legacy_comment.value->>'author', ''),
    legacy_comment.value->>'text',
    (legacy_comment.value->>'created_at')::timestamptz
  FROM jsonb_array_elements(p_document->'posts') AS legacy_post(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(legacy_post.value->'comments') = 'array'
        THEN legacy_post.value->'comments'
      ELSE '[]'::jsonb
    END
  ) AS legacy_comment(value);

  INSERT INTO public.community_poll_options(id, post_id, ordinal, option_text)
  SELECT
    legacy_option.value->>'id',
    legacy_post.value->>'id',
    (legacy_option.ordinality - 1)::smallint,
    legacy_option.value->>'text'
  FROM jsonb_array_elements(p_document->'posts') AS legacy_post(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    legacy_post.value->'poll'->'options'
  ) WITH ORDINALITY AS legacy_option(value, ordinality)
  WHERE legacy_post.value->'poll' IS NOT NULL
    AND jsonb_typeof(legacy_post.value->'poll') = 'object';

  INSERT INTO public.community_reactions(post_id, anon_id, kind, created_at)
  SELECT
    legacy_post.value->>'id',
    reaction_actor.value,
    reaction_kind.key,
    coalesce(
      (legacy_post.value->>'created_at')::timestamptz,
      now()
    )
  FROM jsonb_array_elements(p_document->'posts') AS legacy_post(value)
  CROSS JOIN LATERAL jsonb_each_text(
    CASE
      WHEN jsonb_typeof(legacy_post.value->'reactions') = 'object'
        THEN legacy_post.value->'reactions'
      ELSE '{}'::jsonb
    END
  ) AS reaction_kind(key, value)
  CROSS JOIN LATERAL jsonb_array_elements_text(reaction_kind.value) AS reaction_actor(value);

  INSERT INTO public.community_votes(post_id, voter_id, option_id)
  SELECT
    legacy_post.value->>'id',
    vote_actor.value,
    vote_option.key
  FROM jsonb_array_elements(p_document->'posts') AS legacy_post(value)
  CROSS JOIN LATERAL jsonb_each_text(
    CASE
      WHEN jsonb_typeof(legacy_post.value->'poll'->'votes') = 'object'
        THEN legacy_post.value->'poll'->'votes'
      ELSE '{}'::jsonb
    END
  ) AS vote_option(key, value)
  CROSS JOIN LATERAL jsonb_array_elements_text(vote_option.value) AS vote_actor(value)
  JOIN public.community_poll_options option_row
    ON option_row.id = vote_option.key
   AND option_row.post_id = legacy_post.value->>'id';

  RETURN jsonb_build_object(
    'slug', v_slug,
    'member_count', (SELECT count(*)::int FROM public.community_memberships WHERE community_id = v_community_id),
    'post_count', (SELECT count(*)::int FROM public.community_posts WHERE community_id = v_community_id),
    'comment_count', (SELECT count(*)::int FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id WHERE p.community_id = v_community_id),
    'reaction_count', (SELECT count(*)::int FROM public.community_reactions r JOIN public.community_posts p ON p.id = r.post_id WHERE p.community_id = v_community_id),
    'vote_count', (SELECT count(*)::int FROM public.community_votes v JOIN public.community_posts p ON p.id = v.post_id WHERE p.community_id = v_community_id)
  );
END;
$$;
```

The importer never deletes. A conflicting existing ID raises `23505`; repair requires a separate operator-reviewed forward migration, never an implicit delete/recreate.

`community_verify_backfill` must return zero-valued mismatch arrays/counts for:

- missing communities;
- metadata mismatches;
- member set/count mismatches;
- post set/count mismatches;
- comment set/count mismatches;
- reaction membership mismatches;
- vote membership mismatches;
- summary count mismatches;
- orphan child rows.

`community_export_legacy(p_slug)` must reconstruct the exact old document shape, including `reactions` actor arrays and poll `votes` actor arrays, ordered by base-table timestamps and IDs. It returns `NULL` for an unknown slug.

`community_rebuild_summaries()` performs one set-based insert/upsert so it also repairs a missing summary row:

```sql
INSERT INTO public.community_summaries(community_id, member_count, post_count, updated_at)
SELECT c.id,
       (SELECT count(*)::int
          FROM public.community_memberships m
         WHERE m.community_id = c.id),
       (SELECT count(*)::int
          FROM public.community_posts p
         WHERE p.community_id = c.id),
       now()
FROM public.communities c
ON CONFLICT (community_id) DO UPDATE
SET member_count = EXCLUDED.member_count,
    post_count = EXCLUDED.post_count,
    updated_at = now();
```

It returns `{ communities, memberships, posts, rebuilt_at }`.

Grant/revoke all four functions exactly like Tasks 4 and 5.

- [ ] **Step 6: Implement the CLI with bounded pagination and no secret output**

`scripts/community-normalization.mjs` must create a service-role Supabase client from existing environment variables. `audit` and `verify` are read-only. `backfill`, `replay-legacy`, and `rebuild-summaries` accept only `VOICE_BOX_ENVIRONMENT=staging` or `production`; any production write additionally requires `VOICE_BOX_ALLOW_COMMUNITY_WRITES=1`, a verified backup, and the explicit human gate. Use keyset pagination for `settings.key LIKE 'community:%'` ordered by key. Never print the service key, full document, member IDs, or post bodies.

Command behavior:

- `audit`: fetch all community settings rows, run `auditLegacyDocuments`, print issue counts and keys, exit 1 if any issue exists.
- `backfill`: run the same audit first; if it fails, stop. Process 20 documents per RPC call. Existing matching digests are skipped. A conflicting ID stops the import and requires a separate operator-reviewed repair migration, preventing accidental overwrite.
- `verify`: run `community_verify_backfill`, fetch each exported normalized document and corresponding legacy document, compare `stableStringify(canonicalizeLegacyDocument(document))` for both, and print mismatch codes only.
- `rebuild-summaries`: call the set-based RPC, then rerun verify.
- `replay-legacy --all` or `--slug`: export normalized documents and upsert `settings.value` by exact key; refuse if the settings-key duplicate audit is nonzero.

- [ ] **Step 7: Add package scripts without dependencies**

Add:

```json
{
  "scripts": {
    "communities:audit": "node scripts/community-normalization.mjs audit",
    "communities:backfill": "node scripts/community-normalization.mjs backfill --batch-size 20",
    "communities:verify": "node scripts/community-normalization.mjs verify",
    "communities:rebuild-summaries": "node scripts/community-normalization.mjs rebuild-summaries",
    "communities:replay-legacy": "node scripts/community-normalization.mjs replay-legacy"
  }
}
```

Merge these keys into the existing `scripts` object; do not replace existing commands and do not modify `package-lock.json`.

- [ ] **Step 8: Test against staging**

```powershell
$env:VOICE_BOX_ENVIRONMENT="staging"
npm run communities:audit
npm run communities:backfill
npm run communities:verify
```

Expected: audit exits 0; backfill reports imported/skipped counts; verify reports `ok: true` and all mismatch counts zero. Then test resume:

```powershell
npm run communities:backfill
npm run communities:verify
```

Expected: all documents are skipped by digest and no duplicate rows appear.

- [ ] **Step 9: Run tests and commit**

```powershell
npm run test:api -- tests/api/community-normalization-script.test.ts tests/api/community-schema-contract.test.ts
git add api/migrations/026_community_migration_tools.sql scripts/lib/community-legacy.mjs scripts/community-normalization.mjs tests/api/community-normalization-script.test.ts package.json
git diff --cached --check
git commit -m "feat(communities): add verified backfill and recovery tools"
```

---

### Task 7: Route the API Through Legacy, Shadow, Canary, and Normalized Stores

**Files:**
- Create: `api/_community-storage.js`
- Create: `api/_community-legacy-store.js`
- Create: `api/_community-normalized-store.js`
- Modify: `api/_communities.js`
- Create: `tests/api/communities-storage.test.ts`
- Modify: `tests/api/communities.test.ts`
- Create: `tests/api/communities-normalized.test.ts`
- Modify: `.env.template`

**Interfaces:**
- `getCommunityStorageMode(): "legacy" | "shadow" | "canary" | "normalized"`
- `isCanarySlug(slug: string): boolean`
- `mapCommunityRpcError(error: unknown): { status: number; message: string }`
- `selectCommunityStore(slug?: string): CommunityStore`
- `CommunityStore` is this exact interface:

```ts
interface CommunityStore {
	list(includeHidden: boolean): Promise<CommunityListResponse>;
	get(input: {
		slug: string;
		anonId: string;
		includeHidden: boolean;
		limit: number;
		beforeCreatedAt: string | null;
		beforeId: string | null;
	}): Promise<CommunityDetailResponse>;
	comments(input: {
		slug: string;
		postId: string;
		includeHidden: boolean;
		limit: number;
		beforeCreatedAt: string | null;
		beforeId: string | null;
	}): Promise<CommunityCommentPageResponse>;
	stats(): Promise<CommunityStatsResponse>;
	create(input: { slug: string; name: string; description: string; avatar: string; photo: string; anonId: string }): Promise<{ community: CommunityCard }>;
	setMembership(input: { slug: string; anonId: string; join: boolean }): Promise<CommunityMembershipResponse>;
	createPost(input: {
		slug: string;
		anonId: string;
		author: string;
		body: string;
		postId: string;
		poll: { id: string; question: string; options: { id: string; text: string }[]; created_by: string } | null;
	}): Promise<CommunityPostResponse>;
	createComment(input: { slug: string; postId: string; anonId: string; author: string; body: string; commentId: string }): Promise<{ comment: CommunityComment; comment_count: number }>;
	toggleReaction(input: { slug: string; postId: string; anonId: string; kind: string; active: boolean | null }): Promise<CommunityReactionResponse>;
	castVote(input: { slug: string; postId: string; anonId: string; optionId: string }): Promise<CommunityVoteResponse>;
	deletePost(input: { slug: string; postId: string; anonId: string; actorIsAdmin: boolean; solvePoll: boolean }): Promise<CommunityDeletePostResponse>;
	admin(input: { slug: string; op: "hide" | "unhide" | "delete"; actorIsAdmin: boolean }): Promise<CommunityAdminResponse>;
}
```

- [ ] **Step 1: Write failing mode and canary tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.resetModules();
	delete process.env.COMMUNITY_STORAGE_MODE;
	delete process.env.COMMUNITY_CANARY_SLUGS;
});

describe("community storage mode", () => {
	it("defaults to legacy", async () => {
		const { getCommunityStorageMode } = await import("../../api/_community-storage.js");
		expect(getCommunityStorageMode()).toBe("legacy");
	});

	it("rejects an unknown mode", async () => {
		process.env.COMMUNITY_STORAGE_MODE = "dual";
		const { getCommunityStorageMode } = await import("../../api/_community-storage.js");
		expect(() => getCommunityStorageMode()).toThrow(/COMMUNITY_STORAGE_MODE/);
	});

	it("selects only explicit canary slugs", async () => {
		process.env.COMMUNITY_STORAGE_MODE = "canary";
		process.env.COMMUNITY_CANARY_SLUGS = "study-gang,qa-room";
		const { isCanarySlug } = await import("../../api/_community-storage.js");
		expect(isCanarySlug("study-gang")).toBe(true);
		expect(isCanarySlug("qa-room")).toBe(true);
		expect(isCanarySlug("other")).toBe(false);
	});
});
```

Append this exact mapping test:

```ts
it.each([
	["P0002", "Community not found", 404],
	["P0003", "Please wait between messages", 429],
	["P0004", "Reaction limit reached on this post", 400],
	["P0005", "Join the community to post", 403],
	["23505", "A community with this name already exists", 409],
	["40001", "Community storage unavailable", 503],
	["40P01", "Community storage unavailable", 503],
])("maps RPC SQLSTATE %s", async (code, message, status) => {
	const { mapCommunityRpcError } = await import("../../api/_community-storage.js");
	expect(mapCommunityRpcError({ code, message })).toEqual({ status, message });
});
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
npm run test:api -- tests/api/communities-storage.test.ts
```

Expected: FAIL because the storage module does not exist.

- [ ] **Step 3: Implement mode selection and error mapping**

Use an exact allowlist:

```js
const MODES = new Set(["legacy", "shadow", "canary", "normalized"]);

export function getCommunityStorageMode() {
	const mode = process.env.COMMUNITY_STORAGE_MODE || "legacy";
	if (!MODES.has(mode)) {
		throw new Error("COMMUNITY_STORAGE_MODE must be legacy, shadow, canary, or normalized");
	}
	return mode;
}

export function isCanarySlug(slug) {
	if (getCommunityStorageMode() !== "canary") return false;
	return new Set(
		(process.env.COMMUNITY_CANARY_SLUGS || "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	).has(slug);
}
```

Map the SQLSTATEs in the table above to their HTTP status. Preserve the message only when it is one of the controlled messages raised by migrations 021–026; otherwise return the status-specific safe fallback. Unknown SQLSTATEs return status 503 with `Community storage unavailable`. Send the original error to structured logging without exposing SQL.

- [ ] **Step 4: Extract the existing behavior into the legacy store**

Move the current settings document code without semantic changes. Keep the current validation, caps, 15-second warm-instance cooldown, error strings, report target built as `${slug}::${postId}`, and admin authorization. Add `post_count` beside the existing `post` field on post creation and `comment_count` beside the existing `comment` field on comment creation; these additive fields are required for authoritative local reconciliation. `tests/api/communities.test.ts` must continue to pass in legacy mode after updating those two assertions.

- [ ] **Step 5: Implement the normalized store with one RPC per operation**

Every method calls `supabase.rpc(exact_function_name, exact_named_parameters)`. The success path is one RPC per operation. If PostgreSQL returns `40001` or `40P01`, retry that same idempotent normalized RPC once; do not retry validation, authorization, limit, duplicate, or unknown errors. The store must not call `.from()` for authoritative normalized operations. Extend the existing `_db-client.js` test mock with `rpc: vi.fn()` and count calls; do not add a production-only injection branch.

- [ ] **Step 6: Implement list/get/shadow behavior**

- `legacy`: call legacy store only.
- `shadow`: call legacy, call normalized read, compare canonical public response fields, log `community_storage_mismatch` on differences, return legacy.
- `canary` detail/action: choose normalized only when `isCanarySlug(slug)`; otherwise legacy. List reads legacy, reads normalized, replaces only allowlisted slugs, and preserves the legacy sort order.
- `normalized`: call normalized only. If a required RPC/table is unavailable, return 503; never silently fall back to an unverified legacy document.

The `stats` action returns 403 unless `isAdmin(req)` succeeds. Public list/detail/comment requests pass `includeHidden = false`; verified admin requests pass `true`, but viewer-specific detail/comment responses remain private. Admin list uses `Cache-Control: private, no-store`. Public list uses `public, max-age=0, s-maxage=30, stale-while-revalidate=60`. Detail/comments use `private, no-cache`. Stats uses `private, no-store`.

- [ ] **Step 7: Implement shadow mutation behavior**

For every mutation except `report`:

1. Execute the legacy mutation and retain its public response.
2. Execute the equivalent normalized RPC with the same generated IDs.
3. Log a mismatch when the returned affected counts/IDs differ.
4. Return the legacy response in `shadow` mode so the user-visible write cannot be reported as failed after the authoritative legacy write committed.

Normalized mode executes only the normalized RPC. Canary mode chooses one store per slug before either write begins, so a community never receives split authority.

- [ ] **Step 8: Add normalized action inputs without breaking old clients**

- `react` accepts optional `active: boolean`; omitted means legacy toggle.
- `post` accepts optional `post_id`, `poll_id`, and option IDs; the handler generates current `cp_`, `cv_`, and `co_` IDs when absent.
- `comment` accepts optional `comment_id`; the handler generates `cc_` when absent.
- Existing request bodies without these fields keep working.

- [ ] **Step 9: Add query-budget and storage-mode API tests**

`tests/api/communities-normalized.test.ts` must assert:

- list = exactly one `rpc("community_list", { p_include_hidden: false })` in normalized mode;
- detail = exactly one `rpc("community_get", { p_slug, p_anon_id, p_include_hidden, p_limit: 20, p_before_created_at, p_before_id })`;
- comments = exactly one `rpc("community_comment_page", { p_slug, p_post_id, p_include_hidden, p_limit: 50, p_before_created_at, p_before_id })`;
- each mutation = exactly 1 normalized RPC;
- no `.from("settings")` call occurs in normalized mode;
- shadow list performs one legacy read and one normalized read;
- normalized missing RPC returns 503 and does not read settings;
- `stats` calls no RPC and returns 403 when `isAdmin` is false;
- public list sets `Cache-Control` to `public, max-age=0, s-maxage=30, stale-while-revalidate=60`;
- admin list, viewer detail/comments, and admin stats each set `Cache-Control` to `private, no-store` or `private, no-cache` and never use the public list header.

- [ ] **Step 10: Document flags in `.env.template`**

Append:

```dotenv
# Community storage rollout: legacy | shadow | canary | normalized
COMMUNITY_STORAGE_MODE=legacy
# Comma-separated explicit community slugs used only in canary mode.
COMMUNITY_CANARY_SLUGS=
```

- [ ] **Step 11: Run focused API tests**

```powershell
npm run test:api -- tests/api/communities.test.ts tests/api/communities-storage.test.ts tests/api/communities-normalized.test.ts
```

Expected: all existing legacy contracts and new mode/query budgets PASS.

- [ ] **Step 12: Commit the store boundary**

```powershell
git add api/_community-storage.js api/_community-legacy-store.js api/_community-normalized-store.js api/_communities.js tests/api/communities-storage.test.ts tests/api/communities-normalized.test.ts tests/api/communities.test.ts .env.template
git diff --cached --check
git commit -m "feat(communities): add safe storage rollout adapter"
```

---

### Task 8: Reconcile Community List Actions Without Reloading

**Files:**
- Modify: `src/pages/Communities.tsx`
- Modify: `src/__tests__/Communities.test.tsx`
- Use: `src/lib/communityState.ts`, `src/types/community.ts`

**Interfaces:**
- Consumes: `CommunityCard`, `CommunityAdminResponse`, `upsertCommunityCard`, `removeCommunityCard`.
- Produces: one initial GET, optional manual refresh, zero timer/visibility loads, and zero list reloads after create/admin actions.

- [ ] **Step 1: Add failing one-load and reconciliation tests**

Add to `src/__tests__/Communities.test.tsx`:

```tsx
import userEvent from "@testing-library/user-event";

it("performs one initial load and no timer/visibility reload", async () => {
	vi.useFakeTimers();
	const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	render(<Communities />);
	await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
	await vi.advanceTimersByTimeAsync(60_000);
	document.dispatchEvent(new Event("visibilitychange"));
	expect(mocks.get).toHaveBeenCalledTimes(1);
	vi.useRealTimers();
});

it("prepends the created community without another list read", async () => {
	const user = userEvent.setup();
	mocks.post.mockResolvedValue({ community: { ...listRes.communities[0], slug: "new-group" } });
	render(<Communities />);
	await screen.findByText("Study Gang");
	await user.click(screen.getByRole("button", { name: "New community" }));
	await user.type(screen.getByLabelText("Name"), "New Group");
	await user.click(screen.getByRole("button", { name: "Create community" }));
	expect(await screen.findByText("New Group")).toBeInTheDocument();
	expect(mocks.get).toHaveBeenCalledTimes(1);
});
```

Add an admin-hide test where `post` resolves `{ ok: true, hidden: true, community: { ...card, hidden: true } }`; assert the HIDDEN/admin state changes and `mocks.get` remains at one call.

- [ ] **Step 2: Run the component test and confirm RED**

```powershell
npm test -- src/__tests__/Communities.test.tsx
```

Expected: timer/visibility and no-refetch assertions FAIL against current behavior.

- [ ] **Step 3: Remove automatic reload sources**

Delete the interval and visibility listener. Keep one `useEffect` that calls the initial loader and cancels stale state through an `active` flag. Add an explicit “Refresh” button that calls `api.getFresh<CommunityListResponse>("/api/communities?action=list")`.

- [ ] **Step 4: Reconcile create/admin responses**

- Create: parse `{ community }` and call `setCommunities(current => upsertCommunityCard(current, community))`, then prepend by `created_at` descending.
- Hide/unhide: parse `{ community }` and replace the matching slug.
- Delete: remove the slug locally after the authoritative `{ deleted: true }` response.
- On failure: retain the prior list and show the existing error toast. Do not call `load`.

- [ ] **Step 5: Run component tests, typecheck, and lint**

```powershell
npm test -- src/__tests__/Communities.test.tsx
npm run typecheck
npm run lint
```

Expected: PASS, exit 0, exit 0.

- [ ] **Step 6: Commit list reconciliation**

```powershell
git add src/pages/Communities.tsx src/__tests__/Communities.test.tsx
git diff --cached --check
git commit -m "feat(communities): reconcile list actions without reloads"
```

---

### Task 9: Add Bounded Detail/Comment Reads and Reconcile Every Post Action

**Files:**
- Modify: `src/pages/CommunityDetail.tsx`
- Create: `src/__tests__/CommunityDetail.test.tsx`
- Use: `src/lib/communityState.ts`, `src/types/community.ts`

**Interfaces:**
- Initial GET: build `/api/communities?action=get&slug=${encodeURIComponent(slug)}&anon_id=${encodeURIComponent(anonId)}&limit=20`.
- Older page GET: use the same URL and append the decoded `cursor` from `next_cursor`.
- Comment GET: build `/api/communities?action=comments&slug=${encodeURIComponent(slug)}&post_id=${encodeURIComponent(postId)}&limit=50` and append the optional cursor.
- Manual refresh: `api.getFresh` with the initial URL
- All mutation responses use the reconciliation matrix.

- [ ] **Step 1: Write a failing one-load test**

Mock `api.get` with a complete `CommunityDetailData`, render the route with `MemoryRouter` and `Routes`, use fake timers, and assert:

```tsx
await screen.findByRole("heading", { name: "Book Club" });
await vi.advanceTimersByTimeAsync(60_000);
document.dispatchEvent(new Event("visibilitychange"));
expect(mocks.get).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Write failing action reconciliation tests**

Add one test per behavior:

- join response patches `is_member`/count with no second GET;
- post response inserts the post and applies the returned `post_count` with no second GET;
- comment response appends only that post’s thread;
- reaction response patches only the selected kind;
- vote response replaces only the poll and permits another vote;
- solve/delete removes only the selected post;
- hide/unhide patches the header;
- delete redirects to `/communities`;
- a failed action leaves the previous rendered state unchanged and shows the error toast.

Use `userEvent` and `waitFor`; assert `mocks.get.mock.calls.length` before and after every action.

- [ ] **Step 3: Run and confirm RED**

```powershell
npm test -- src/__tests__/CommunityDetail.test.tsx
```

Expected: FAIL because the suite is absent/current actions refetch.

- [ ] **Step 4: Remove timers/visibility and add explicit refresh/load-more**

Delete the 25-second interval and visibility listener. Keep the first load per slug. Add a manual Refresh control. Render a “Load older posts” button only when `next_cursor` exists; fetch the next page once, prepend it after de-duplication, and advance the cursor. Reset post/comment state when `slug` changes and ignore responses from an obsolete slug.

- [ ] **Step 5: Load comments only when opened**

Initialize every post’s thread with `items: p.comments`, `next_cursor: null`, and no extra read for compatibility. On first open, call `action=comments` with limit 50 and store the response in `commentState`. Render `comment_count` in the collapsed button. A “Load more comments” button appears only when that thread has a cursor. Opening comments is user-triggered and is not a page reload.

- [ ] **Step 6: Reconcile mutations with pure helpers**

- `joinLeave`: call `patchCommunityMembership`; do not reload.
- `postMessage`: call `insertCommunityPost` with the response’s `post_count`; clear the composer only after a 2xx response.
- `react`: compute `active = !post.mine_reactions[kind]`, send it, then call `patchCommunityReaction`. Remove the refetch.
- `vote`: call `replaceCommunityPoll` from `CommunityVoteResponse.poll`.
- `comment`: append the returned comment and set the server count; clear only that draft after success.
- `solvePoll`/`deletePost`: call `removeCommunityPost` with the server count.
- `adminOp`: patch header for hide/unhide; navigate only after confirmed delete.

Retain in-flight guards. On a 429, show the API message; do not replay automatically.

- [ ] **Step 7: Preserve honest failure behavior**

If a refresh fails and `data` exists, keep the last-known-good feed and show a visible stale/error banner with Retry. A 404 still renders the not-found page; timeout/429/500 never masquerade as deletion.

- [ ] **Step 8: Run focused and related tests**

```powershell
npm test -- src/__tests__/CommunityDetail.test.tsx src/__tests__/Communities.test.tsx
npm run test:api -- tests/api/communities.test.ts tests/api/communities-normalized.test.ts
npm run typecheck
npm run lint
```

Expected: all PASS.

- [ ] **Step 9: Commit detail reconciliation**

```powershell
git add src/pages/CommunityDetail.tsx src/__tests__/CommunityDetail.test.tsx
git diff --cached --check
git commit -m "feat(communities): reconcile detail actions and bound feed reads"
```

---

### Task 10: Repair Dashboard Stats and Prevent Ambiguous Community Write Replay

**Files:**
- Modify: `src/lib/dashboard/widgets.tsx`
- Modify: `src/__tests__/dashboard-widgets.test.tsx`
- Modify only the community hunk in `src/lib/api.ts`
- Modify only the community test hunk in `src/__tests__/api.test.ts`

**Interfaces:**
- Dashboard source: `/api/communities?action=stats`
- Dashboard widgets read scalar keys `communities` and `members`.
- `api.ts` adds `path.startsWith("/api/communities")` to `isNonReplayable`.

- [ ] **Step 1: Add failing dashboard source/shape assertions**

In `src/__tests__/dashboard-widgets.test.tsx`, assert the community source path is `/api/communities?action=stats`, and render both widgets with:

```ts
const data = {
	communities: { communities: 7, members: 42, posts: 19 },
};
```

Expected values: `7` and `42`. Current count widgets expect arrays and the source lacks `action=stats`, so the test fails.

- [ ] **Step 2: Add a failing non-replay test**

In the existing offline-queue describe block:

```ts
it("never queues ambiguous community mutations", async () => {
	vi.useFakeTimers();
	fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
	await expect(
		api.post("/api/communities", { action: "react", active: true }),
	).rejects.toThrow("Failed to fetch");
	expect(queuedCount()).toBe(0);
});
```

- [ ] **Step 3: Run both tests and confirm RED**

```powershell
npm test -- src/__tests__/dashboard-widgets.test.tsx src/__tests__/api.test.ts
```

Expected: dashboard shape/source and community non-replay assertions FAIL.

- [ ] **Step 4: Update dashboard source/widgets**

Change `SOURCES.communities.path` to `/api/communities?action=stats`. Replace both `countWidget` calls with `statWidget` calls reading `communities` and `members`. The existing posts stat is not changed.

- [ ] **Step 5: Mark all community writes non-replayable**

Add this condition to `isNonReplayable`:

```ts
path.startsWith("/api/communities") ||
```

Place it with `/api/reactions`. A community write timeout is ambiguous: replaying a post can duplicate it, a comment can duplicate it, and a reaction can reverse the desired state. The UI uses authoritative responses and explicit retry rather than the offline queue.

- [ ] **Step 6: Stage only the intended pre-existing-file hunks**

Because these two files are already modified, inspect and stage selectively:

```powershell
git diff -- src/lib/api.ts src/__tests__/api.test.ts
git add src/lib/dashboard/widgets.tsx src/__tests__/dashboard-widgets.test.tsx
git add -p src/lib/api.ts
git add -p src/__tests__/api.test.ts
git diff --cached -- src/lib/api.ts src/__tests__/api.test.ts
```

The cached diff must contain only the community path/test hunk. Do not stage unrelated existing changes.

- [ ] **Step 7: Run tests/typecheck/lint and commit**

```powershell
npm test -- src/__tests__/dashboard-widgets.test.tsx src/__tests__/api.test.ts
npm run typecheck
npm run lint
git diff --cached --check
git commit -m "fix(communities): reconcile dashboard stats and write replay"
```

---

### Task 11: Prove Concurrency, Rollback, and Query Budgets in Staging

**Files:**
- Create: `scripts/test-community-normalization.mjs`
- Modify: `package.json`

**Interfaces:**
- Script exits 0 only when all concurrency, integrity, summary, cursor, and cleanup assertions pass.
- It uses the deployed staging `/api/communities` plus a service-role Supabase client for direct verification and cleanup.
- It refuses production.

- [ ] **Step 1: Implement the production-write guard**

At process start:

```js
if (process.env.VOICE_BOX_ENVIRONMENT !== "staging") {
	throw new Error("Community integration tests require VOICE_BOX_ENVIRONMENT=staging");
}
if (process.env.VOICE_BOX_ALLOW_COMMUNITY_WRITES !== "1") {
	throw new Error("Set VOICE_BOX_ALLOW_COMMUNITY_WRITES=1 for the disposable staging run");
}
```

Never accept a URL override that points to production.

- [ ] **Step 2: Seed one disposable community and capture IDs**

Generate `runId = Date.now().toString(36)`, use the exact slug `community-concurrency-${runId}`, create it through `/api/communities`, and retain the returned post ID. Direct service-role reads verify normalized tables in `normalized` mode.

- [ ] **Step 3: Run concurrent lost-update assertions**

Run these exact cases and fail on the first mismatch:

1. 40 comment POSTs from 40 identities to one post: direct comment count must equal 40 and all IDs must be unique.
2. 20 join POSTs from 20 identities: `member_count` and summary must equal 21 including the creator.
3. 20 explicit `active: true` reactions for one identity/kind: exactly one reaction row and count 1.
4. 20 concurrent votes for one identity split between two valid options: exactly one vote row; `total_votes = 1`; `my_vote` equals the stored option.
5. Two posts by one member inside one second: one 201 and one 429; direct post count increases by one.
6. Delete a post while one reaction is submitted: reaction is either committed before cascade or receives 404; after the request, no orphan reaction/comment/vote/option row exists.
7. After every case, compare `community_summaries` to direct counts.

- [ ] **Step 4: Run API query-budget assertions**

Using a counting Supabase client or staging request metrics, assert:

- list = one authoritative database call;
- detail = one authoritative database call;
- first comment page = one;
- older post page = one;
- each mutation = one;
- detail returns no more than 20 posts;
- comment page returns no more than 50 rows;
- no normalized read calls `.from("settings")`.

Vitest’s `rpc` call-count suite from Task 7 is the deterministic gate; staging timings validate the same code path.

- [ ] **Step 5: Prove recovery export**

Run:

```powershell
$runId = [System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
node scripts/community-normalization.mjs replay-legacy --slug "community-concurrency-$runId"
```

Fetch the exact settings key and compare it to the normalized export with `canonicalizeLegacyDocument`. Expected: equal canonical digest. Then perform the same test for `--all` against a staging copy before production use.

- [ ] **Step 6: Clean up in `finally`**

Delete the disposable community through the staging API as admin or directly through the service-role client. Assert `communities`, memberships, posts, comments, reactions, options, votes, and summary rows for that slug/ID are zero. A failed test still runs cleanup before exiting nonzero.

- [ ] **Step 7: Add the explicit script command**

Add:

```json
"test:community-normalization": "node scripts/test-community-normalization.mjs"
```

- [ ] **Step 8: Run in staging and record evidence**

```powershell
$env:VOICE_BOX_ENVIRONMENT="staging"
$env:VOICE_BOX_ALLOW_COMMUNITY_WRITES="1"
npm run test:community-normalization
```

Expected: all cases PASS, no orphan rows remain, query budgets pass, cleanup count is zero.

- [ ] **Step 9: Run EXPLAIN on representative staging data**

```sql
BEGIN;
DELETE FROM public.communities WHERE slug = 'query-plan-fixture';
INSERT INTO public.communities(slug, name, created_by)
VALUES ('query-plan-fixture', 'Query Plan Fixture', 'anon-plan');
INSERT INTO public.community_memberships(community_id, anon_id)
SELECT id, 'anon-plan' FROM public.communities WHERE slug = 'query-plan-fixture';
INSERT INTO public.community_posts(
  id, community_id, anon_id, body, poll_id, poll_question, poll_created_by
)
SELECT 'cp_query_plan', id, 'anon-plan', 'fixture', 'cv_query_plan', 'Question?', 'anon-plan'
FROM public.communities WHERE slug = 'query-plan-fixture';
INSERT INTO public.community_poll_options(id, post_id, ordinal, option_text)
VALUES ('co_query_plan_a', 'cp_query_plan', 0, 'A'),
       ('co_query_plan_b', 'cp_query_plan', 1, 'B');
INSERT INTO public.community_comments(id, post_id, anon_id, body)
VALUES ('cc_query_plan', 'cp_query_plan', 'anon-plan', 'comment');
INSERT INTO public.community_reactions(post_id, anon_id, kind)
VALUES ('cp_query_plan', 'anon-plan', 'support');
INSERT INTO public.community_votes(post_id, voter_id, option_id)
VALUES ('cp_query_plan', 'anon-plan', 'co_query_plan_a');

EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id, s.member_count, s.post_count
FROM public.communities c
JOIN public.community_summaries s ON s.community_id=c.id
WHERE c.hidden=false
ORDER BY c.created_at DESC, c.id DESC
LIMIT 200;

EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id
FROM public.community_posts p
WHERE p.community_id = (SELECT id FROM public.communities WHERE slug='query-plan-fixture')
ORDER BY p.created_at DESC, p.id DESC
LIMIT 21;

EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id
FROM public.community_comments c
WHERE c.post_id='cp_query_plan'
ORDER BY c.created_at, c.id
LIMIT 51;

EXPLAIN (ANALYZE, BUFFERS)
SELECT r.kind, count(*)
FROM public.community_reactions r
WHERE r.post_id='cp_query_plan'
GROUP BY r.kind;

EXPLAIN (ANALYZE, BUFFERS)
SELECT v.option_id, count(*)
FROM public.community_votes v
WHERE v.post_id='cp_query_plan'
GROUP BY v.option_id;
ROLLBACK;
```

Expected: index plans for selective child lookups, no full scan of a large `community_posts` table for a single community, shared buffer reads remain bounded, and end-to-end p95 meets the approved 500/800 ms gates. Save before/after plan output in the release evidence, not a new source file.

- [ ] **Step 10: Commit the integration test**

```powershell
git add scripts/test-community-normalization.mjs package.json
git diff --cached --check
git commit -m "test(communities): prove concurrency and query budgets"
```

---

### Task 12: Document Rollout, Rollback, and Final Verification

**Files:**
- Modify: `docs/DEPLOY-SCHOOL.md`
- Modify: `docs/ROLLBACK.md`
- Modify: `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

**Interfaces:**
- Produces: an operator-executable sequence from legacy through shadow/canary/normalized and a safe recovery procedure.

- [ ] **Step 1: Document the exact migration order**

Add migrations 021 through 026 after the core ledger. State that 021 runs outside a transaction, the duplicate key audit must return zero, and 026’s import/verify/export RPCs are service-role only.

- [ ] **Step 2: Document Data API exposure for the 2026 Supabase change**

Because new public-schema tables/functions may not be automatically exposed beginning in late 2026, require the actual Voice Flow project’s Data API settings to expose the required public functions. Verify service-role RPC calls and verify `anon` has no direct table/function privilege. Do not enable automatic exposure for every future table merely to make this route work.

- [ ] **Step 3: Document the activation gates**

Use this order:

1. Apply additive migrations with `COMMUNITY_STORAGE_MODE=legacy`.
2. Run `communities:audit`; stop on any issue.
3. Run `communities:backfill`; run twice to prove digest-based resume.
4. Run `communities:verify`; require zero mismatches.
5. Deploy the new code with `COMMUNITY_STORAGE_MODE=shadow` and a 30-second response-age soak across ordinary staging traffic. Re-run verify; require zero mismatches.
6. Select one or more explicit staging/internal community slugs, set `COMMUNITY_CANARY_SLUGS`, and run the staging concurrency test.
7. Promote `COMMUNITY_STORAGE_MODE=normalized` only after the human approval gate, a verified PITR backup, and a successful full-response recovery export.

- [ ] **Step 4: Document rollback by phase**

- Before normalized writes: set mode back to `legacy` and promote the previous Vercel deployment; normalized tables remain additive and unused.
- After normalized writes: do not deploy the old handler first. Set `COMMUNITY_STORAGE_MODE=normalized`, stop rollout, set `VOICE_BOX_ENVIRONMENT=production` and `VOICE_BOX_ALLOW_COMMUNITY_WRITES=1` only after the human gate, run `npm run communities:replay-legacy -- --all`, run `npm run communities:verify`, confirm the legacy export represents current normalized data, then set mode to `legacy` and promote the previous deployment.
- If replay/verify fails, keep normalized mode, keep writes on the normalized store, and use the verified PITR backup; never delete normalized tables to force a rollback.
- Do not drop tables, functions, indexes, or settings rows during rollback.

- [ ] **Step 5: Update inventory only after evidence exists**

Mark `/communities` and `/communities/:slug` compliant only when:

- their direct component suites pass;
- no timers/visibility listeners remain;
- successful actions cause zero list/detail GET refetches;
- the staging concurrency script passes;
- the storage rollout is normalized with zero verification mismatches.

Keep the legacy JSON row physically present and record it as a rollback snapshot, not as an active data source.

- [ ] **Step 6: Run final sequential verification**

```powershell
npm run test:api -- tests/api/communities.test.ts tests/api/communities-storage.test.ts tests/api/communities-normalized.test.ts tests/api/community-schema-contract.test.ts tests/api/community-normalization-script.test.ts
npm test -- src/__tests__/communityState.test.ts src/__tests__/Communities.test.tsx src/__tests__/CommunityDetail.test.tsx src/__tests__/dashboard-widgets.test.tsx src/__tests__/api.test.ts
npm run typecheck
npm run lint
npm run build
npm run audit:security
```

Expected: all commands exit 0. Then run the staging-only integration and query-budget script from Task 11.

- [ ] **Step 7: Review the final diff for scope and security**

```powershell
git status --short
git diff --check
git diff -- api/migrations api/_community-storage.js api/_community-legacy-store.js api/_community-normalized-store.js api/_communities.js src/pages/Communities.tsx src/pages/CommunityDetail.tsx src/lib/communityState.ts src/types/community.ts
```

Confirm:

- no `settings` delete;
- no anon/authenticated grant;
- no Realtime publication change;
- no new dependency;
- no generated `tsconfig.app.tsbuildinfo` or `services/__pycache__` staged;
- no unrelated pre-existing hunk staged.

- [ ] **Step 8: Commit documentation after all gates pass**

```powershell
git add docs/DEPLOY-SCHOOL.md docs/ROLLBACK.md docs/superpowers/specs/2026-09-24-platform-surface-inventory.md
git diff --cached --check
git commit -m "docs(communities): record rollout and recovery gates"
```

## Definition of Done

- All eight normalized tables exist with the exact constraints, FK actions, and indexes in this plan.
- Every public RPC is service-role-only, `SECURITY INVOKER`, empty-search-path, and covered by the schema contract test.
- Legacy JSON audits detect every named duplicate/invalid shape and backfill resumes by canonical digest.
- Backfill verification reports zero metadata, membership, post, comment, reaction, vote, orphan, and summary mismatches.
- Existing `tests/api/communities.test.ts` remains green in legacy mode.
- Normalized API query budgets and response shapes are locked by tests.
- Staging proves concurrent comments, joins, reactions, votes, cooldown, delete races, cascades, and summary counts.
- `/communities` and `/communities/:slug` perform one automatic initial read, no timer/visibility reload, and no full reload after a successful action.
- Community mutations are excluded from offline replay.
- Dashboard community widgets use the new bounded stats action.
- Shadow, canary, normalized, and replay-legacy operational steps are documented and rehearsed.
- `community:*` settings rows remain intact as verified rollback snapshots; no destructive contract migration is included.
