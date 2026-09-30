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

	it("keeps Polls on an explicit refresh instead of full-list realtime reloads", () => {
		const source = readFileSync(resolve(process.cwd(), "src/pages/Polls.tsx"), "utf8");
		expect(source).not.toContain("useRealtime(");
		expect(source).not.toContain("visibilitychange");
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
			for (const args of calls) {
				const handler = splitTopLevel(args)[1]?.trim();
				expect(
					handler,
					`${file} realtime handler must be a freshness signal`,
				).toBe("markUpdatesAvailable");
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
				// fetches — they stay; every fetch leaves the handler.
				mustKeep: ["bumpReaction", "bumpCommentCount", "markUpdatesAvailable"],
			},
		];
		for (const { file, mustKeep } of filtered) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8");
			const calls = callArgs(source, "useRealtime");
			expect(calls.length, `${file} should still subscribe`).toBeGreaterThan(0);
			for (const args of calls) {
				for (const token of mustKeep) {
					expect(args, `${file} realtime handler lost ${token}`).toContain(
						token,
					);
				}
				expect(
					args,
					`${file} realtime handler must not fetch`,
				).not.toMatch(/load\(|getFresh|getSlow|refreshMyReactions\(/);
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
});
