import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Extracts the full, balanced argument text of every `hook(` call so a
 * contract can assert on the real handler instead of guessing from the first
 * line — several of these calls span multiple lines.
 */
function callArgs(source: string, hook: string): string[] {
	const open = `${hook}(`;
	const out: string[] = [];
	let i = source.indexOf(open);
	while (i !== -1) {
		let depth = 0;
		let j = i + hook.length;
		for (; j < source.length; j++) {
			if (source[j] === "(") depth++;
			else if (source[j] === ")") {
				depth--;
				if (depth === 0) break;
			}
		}
		out.push(source.slice(i + open.length, j));
		i = source.indexOf(open, j + 1);
	}
	return out;
}

/**
 * True when a `useRealtime` call registered its subscription with a
 * `0` debounce — the zero-latency lane.
 *
 * The load-once rule below used to ban refetches on realtime events
 * outright. The vote requirement (totals live inside ~100ms) makes a
 * badge-then-tap impossible for poll rows, so the contract now carves out
 * exactly one thing: a zero-debounce subscription may refetch THE SINGLE
 * ROW it is about. Everything debounced stays badge-only, and no lane may
 * ever reach a list/feed loader or the raw network — the reload storm this
 * contract exists to prevent is still fully banned.
 */
function isFastLane(args: string): boolean {
	return splitTopLevel(args)[2]?.trim() === "0";
}

/**
 * The zero-debounce allowance, asserted tightly: registered with no
 * debounce, scoped to `polls`, routed through the named targeted refresher,
 * and never touching a list loader or a raw network call.
 */
function assertTargetedPollLane(args: string, helper: string, file: string) {
	const parts = splitTopLevel(args);
	expect(parts[2]?.trim(), `${file}: vote lane must be zero-debounce`).toBe("0");
	expect(parts[0], `${file}: vote lane must subscribe to polls`).toMatch(/"polls"/);
	expect(parts[1], `${file}: vote lane must call ${helper}()`).toContain(helper);
	expect(
		args,
		`${file}: vote lane may not reload a list or hit the network directly`,
	).not.toMatch(/load\s*\(|getSlow|getFresh|api\.(put|post|del)/);
}

/** Splits an argument list on commas that are not inside brackets. */
function splitTopLevel(args: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of args) {
		if ("([{".includes(ch)) depth++;
		else if (")]}".includes(ch)) depth--;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts;
}

describe("page lifecycle contracts", () => {
	it("keeps CommunityDetail on explicit refresh instead of background polling", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/pages/CommunityDetail.tsx"),
			"utf8",
		);
		expect(source).not.toMatch(/setInterval\s*\(/);
		expect(source).not.toContain("visibilitychange");
	});

	it("keeps the admin Overview on explicit refresh with a badge, never a refetch", () => {
		// Explicit user override 2026-09-26: adds/deletes surface in real
		// time like the admin feed — realtime raises "N new updates", the
		// admin pulls with Refresh / View updates. Same badge contract as
		// PostsTable: the handler must be the freshness signal, never a
		// fetch, and no timer or visibility reload may sneak back in.
		const source = readFileSync(
			resolve(process.cwd(), "src/pages/admin/Overview.tsx"),
			"utf8",
		);
		expect(source).not.toMatch(/setInterval\s*\(/);
		expect(source).not.toContain("visibilitychange");

		const calls = callArgs(source, "useRealtime");
		expect(calls.length, "Overview should subscribe for the badge").toBeGreaterThan(0);
		for (const args of calls) {
			const handler = splitTopLevel(args)[1]?.trim();
			expect(
				handler,
				"Overview realtime handler must be a freshness signal",
			).toBe("markUpdatesAvailable");
		}
		expect(source).toContain("UpdateNotice");
		expect(source).toContain("clearUpdates");
		expect(source).toContain('aria-label="Refresh dashboard"');
	});

	it("keeps Polls on targeted row refreshes instead of full-list realtime reloads", () => {
		// Contract evolution 2026-10-04 (vote realtime work): this used to be a
		// blanket `not.toContain("useRealtime(")`, which made Polls the one page
		// whose vote totals could freeze while the rest of the product was live.
		// The actual harm the blanket ban targeted — a full-list reload on every
		// vote elsewhere — stays banned; what is now allowed is the same
		// single-row refetch Home/PostDetail use.
		const source = readFileSync(resolve(process.cwd(), "src/pages/Polls.tsx"), "utf8");
		expect(source).not.toMatch(/setInterval\s*\(/);
		expect(source).not.toContain("visibilitychange");
		const calls = callArgs(source, "useRealtime");
		expect(calls.length, "Polls should subscribe for live vote totals").toBeGreaterThan(0);
		expect(calls.length, "Polls needs exactly one subscription").toBe(1);
		assertTargetedPollLane(calls[0] as string, "refreshPoll", "Polls");
		// The explicit Refresh control the ban was protecting stays.
		expect(source).toContain('aria-label="Refresh polls"');
	});

	it("keeps retired operations screens out of the active Admin registry", () => {
		// Approved scope: only the six Autonomous System UI pages were removed.
		// Errors and Logs remain active admin tabs, so their components stay
		// wired in Admin.tsx. Action Center survives as the secondary Command
		// Center panel inside Overview, not as an Admin shell import.
		const source = readFileSync(resolve(process.cwd(), "src/pages/Admin.tsx"), "utf8");
		for (const name of [
			"AgentChat",
			"OpsCenter",
			"SystemHealth",
			"PerformanceCenter",
			"SecurityCenter",
			"ActivityStream",
			"WorkCenter",
		]) {
			expect(source, name).not.toContain(`./admin/${name}`);
		}
		expect(source).toContain("./admin/ErrorTracking");
		expect(source).toContain("./admin/Logs");
		const overview = readFileSync(
			resolve(process.cwd(), "src/pages/admin/Overview.tsx"),
			"utf8",
		);
		expect(overview).toContain("./ActionCenter");
	});

	it("keeps admin data surfaces on explicit refresh boundaries", () => {
		const files = [
			"src/pages/admin/ErrorTracking.tsx",
			"src/pages/admin/SystemHealth.tsx",
			"src/pages/admin/PerformanceCenter.tsx",
			"src/components/admin/PulseStrip.tsx",
			"src/pages/admin/Reports.tsx",
			"src/pages/admin/Logs.tsx",
		];
		for (const file of files) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			expect(source, file).not.toMatch(/setInterval\s*\(/);
			expect(source, file).not.toContain("visibilitychange");
		}
	});

	// Regression: there is no 5s timer anywhere in the app. The "auto-refresh
	// storm" was realtime-driven — `api.ts` clears the entire GET cache on
	// every non-GET, so a burst of agent writes guaranteed one full refetch per
	// event and the admin surfaces reloaded continuously under load.
	// Realtime on these screens may only raise a freshness badge. The page
	// owner decides when a new snapshot is requested.
	it("treats realtime on admin data surfaces as a freshness signal, not a refetch", () => {
		const files = [
			"src/pages/admin/PostsTable.tsx",
			"src/pages/admin/PollManager.tsx",
			"src/pages/admin/ActivityStream.tsx",
			"src/pages/admin/SecurityCenter.tsx",
		];
		for (const file of files) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			expect(source, file).not.toMatch(/setInterval\s*\(/);
			expect(source, file).not.toContain("visibilitychange");

			const calls = callArgs(source, "useRealtime");
			expect(calls.length, `${file} should still subscribe`).toBeGreaterThan(0);
			for (const args of calls) {
				const handler = splitTopLevel(args)[1]?.trim();
				expect(
					handler,
					`${file} realtime handler must be a freshness signal`,
				).toBe("markUpdatesAvailable");
			}
			expect(source, file).toContain("UpdateNotice");
		}
	});

	it("gives the live admin data surfaces an explicit manual refresh", () => {
		for (const file of [
			"src/pages/admin/PostsTable.tsx",
			"src/pages/admin/PollManager.tsx",
		]) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			expect(source, file).toContain('aria-label="Refresh');
			expect(source, file).toContain("clearUpdates");
		}
	});

	// The load-once rule is app-wide, not admin-only: public pages and chats
	// load exactly once per visit and never refetch on realtime events. The
	// two filtered surfaces below cannot pass the literal handler (UserChat
	// drops other users' threads, Home applies zero-network local deltas),
	// so the contract pins the scoped property instead: the realtime handler
	// raises the badge and performs no fetch of its own.
	it("keeps public pages and chats on load-once with a badge, never a refetch", () => {
		const strict = [
			"src/pages/SolvingBoard.tsx",
			"src/pages/Suggestions.tsx",
			"src/pages/admin/UnifiedInbox.tsx",
			"src/pages/PostDetail.tsx",
		];
		for (const file of strict) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			const calls = callArgs(source, "useRealtime");
			expect(calls.length, `${file} should still subscribe`).toBeGreaterThan(0);
			let fastLanes = 0;
			for (const args of calls) {
				// PostDetail alone owns a poll: the vote lane refetches that one
				// row with no debounce. Every other lane — on any of these pages —
				// stays a badge.
				if (file.endsWith("PostDetail.tsx") && isFastLane(args)) {
					fastLanes++;
					assertTargetedPollLane(args, "fetchPoll", "PostDetail");
					continue;
				}
				const handler = splitTopLevel(args)[1]?.trim();
				// The badge is still mandatory — this remains the load-once
				// rule: no refetch, just a freshness signal. The handler must
				// be an identifier (the badge itself, or a named withdrawal
				// handler), never an inline body that could hide a side effect.
				expect(
					handler,
					`${file} realtime handler must be the badge signal or a named withdrawal handler`,
				).toMatch(/^(markUpdatesAvailable|handle\w*[Ww]ithdrawal)$/);
				// Contract evolution 2026-10-04 (post-withdrawal work): a
				// badge-only page may additionally DROP a row the server no
				// longer serves — a local state write, never a fetch. When it
				// does, the named handler must be a useCallback whose body
				// BOTH raises the badge and routes through the shared
				// predicate, so neither half can be dropped by a refactor.
				if (handler !== "markUpdatesAvailable") {
					const bodies = callArgs(source, "useCallback");
					expect(
						bodies.some(
							(body) =>
								body.includes("markUpdatesAvailable") &&
								body.includes("postWithdrawal("),
						),
						`${file} withdrawal handler must raise the badge and route through postWithdrawal()`,
					).toBe(true);
				}
				// The badge used to be guaranteed by handler equality; with
				// named handlers allowed, state the no-fetch rule out loud.
				// These pages pull a fresh snapshot only on explicit refresh.
				expect(
					args,
					`${file} realtime handler must not fetch`,
				).not.toMatch(
					/getSlow|getFresh|api\.put|api\.post|api\.del|load\s*\(|refresh\w*\s*\(/,
				);
			}
			if (file.endsWith("PostDetail.tsx")) {
				// Exactly one: the linked poll. A second would double-fetch the
				// same row on every vote event.
				expect(fastLanes, "PostDetail needs exactly one vote lane").toBe(1);
			}
			expect(source, file).toContain("UpdateNotice");
		}

		const filtered: Array<{ file: string; mustKeep: string[] }> = [
			{
				file: "src/pages/UserChat.tsx",
				// thread_id fan-out guard stays; the badge raise stays.
				mustKeep: ["changedThreadId", "markUpdatesAvailable"],
			},
			{
				file: "src/pages/Home.tsx",
				// exact reaction/comment deltas are local state writes, not
				// fetches — they stay. The live feed may quiet-merge through
				// the silent path (silent: true only — never a loud refetch);
				// the badge raise stays for everything else. Poll rows moved
				// to the zero-debounce lane below, where `refreshPoll` is
				// asserted — a feed-lane copy would fetch every vote twice.
				mustKeep: [
					"bumpReaction",
					"bumpCommentCount",
					"markUpdatesAvailable",
					"silent: true",
					// Withdrawal: rows the server no longer serves (hidden /
					// soft-deleted / hard-deleted) leave the feed immediately
					// instead of waiting on a badge tap. A local state write —
					// the same class as the two bump helpers above.
					"postWithdrawal(",
				],
			},
		];
		for (const { file, mustKeep } of filtered) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			const calls = callArgs(source, "useRealtime");
			expect(calls.length, `${file} should still subscribe`).toBeGreaterThan(0);
			let fastLanes = 0;
			for (const args of calls) {
				if (file.endsWith("Home.tsx") && isFastLane(args)) {
					// The vote lane: no debounce, one small targeted row GET, nothing
					// else. It is exempt from the feed-handler tokens because it is
					// not a feed handler — but it is held to a tighter bar instead.
					fastLanes++;
					assertTargetedPollLane(args, "refreshPoll", "Home");
					continue;
				}
				for (const token of mustKeep) {
					expect(args, `${file} realtime handler lost ${token}`).toContain(
						token,
					);
				}
				if (file.endsWith("Home.tsx")) {
					// Polls belong to the zero-debounce lane alone. Keeping them
					// on the batched lane too would refetch every changed row
					// twice per vote event.
					expect(
						splitTopLevel(args)[0],
						`${file} feed lane must leave polls to the vote lane`,
					).not.toMatch(/"polls"/);
					// Live feed: the ONLY fetches allowed inside the handler are
					// the quiet near-top merge (load with silent: true) and the
					// badge raise. No raw network calls.
					expect(
						args,
						`${file} realtime handler must not fetch directly`,
					).not.toMatch(/getSlow|getFresh|api\.put|api\.post|api\.del/);
					expect(
						args,
						`${file} realtime merge must stay silent`,
					).not.toMatch(/load\(\{\s*[^}]*silent:\s*false/);
				} else {
					expect(
						args,
						`${file} realtime handler must not fetch`,
					).not.toMatch(/load\(|getFresh|getSlow|refreshMyReactions\(/);
				}
			}
			if (file.endsWith("Home.tsx")) {
				// One vote lane. Zero-debounce subscriptions are counted so a
				// second one cannot sneak in and multiply per-event GETs.
				expect(fastLanes, "Home needs exactly one vote lane").toBe(1);
			}
			expect(source, file).toContain("UpdateNotice");
			expect(source, file).toContain("clearUpdates");
		}
	});

	it("gives the public boards and inbox an explicit manual refresh", () => {
		const labelled: Array<[string, string]> = [
			["src/pages/SolvingBoard.tsx", 'aria-label="Refresh solving board"'],
			["src/pages/Suggestions.tsx", 'aria-label="Refresh suggestions"'],
			["src/pages/admin/UnifiedInbox.tsx", 'aria-label="Refresh inbox"'],
		];
		for (const [file, label] of labelled) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			expect(source, file).toContain(label);
			expect(source, file).toContain("clearUpdates");
		}
	});

	it("lets UserChat auto-peek while visible (contract evolution 2026-10-05)", () => {
		// Owner override: chat_messages is outside the anon realtime
		// contract, so no subscription can ever deliver a reply — the
		// badge-only rule left chat dead until a manual refresh. The
		// allowance is exactly one visible-only merge tick: it may not
		// become a reload storm, touch read state, or show a loader.
		const source = readFileSync(
			resolve(process.cwd(), "src/pages/UserChat.tsx"),
			"utf8",
		);
		const timers = source.match(/setInterval\s*\(/g) || [];
		expect(timers.length, "UserChat may own exactly one peek timer").toBe(1);
		expect(source).toContain('document.visibilityState === "hidden"');
		expect(source).toContain("api.getFresh");
		expect(source).toContain("mergeMessages(prev, newMsgs)");
		// The tick merges only: read state stays with the explicit
		// load/send paths, and no loader may flash per tick.
		const peekBlock = source.slice(source.indexOf("const peek = useCallback"));
		expect(peekBlock).not.toContain("mark_read");
		expect(peekBlock).not.toContain("setLoading");
		expect(peekBlock).not.toContain("api.put");
	});
});
