// ═══════════════════════════════════════════════════════════════════
// Domain map — SPEC §7 systems (A–Q) ↔ FRAMEWORK §8 domains
// ═══════════════════════════════════════════════════════════════════
// Spec §7 groups the autonomous workforce into 17 systems A–Q;
// FRAMEWORK §8 groups the same capability space into 8 domains.
// This module is the canonical crosswalk between the two documents:
// every spec system names its ONE primary §8 domain (its home rows)
// and a `source` citing the §8 rows that carry it, so the documents
// cannot drift apart silently.
//
// validateDomainMap() fails loudly on: a missing spec system, an
// unknown/extra key, a renamed system name that no longer matches
// spec §7, a primary that is not a FRAMEWORK §8 domain, a `source`
// that cites no §8 row, and a §8 domain that carries no spec system.
// Held-out tests in tests/api/domain-enrollment.test.ts assert the
// full 17-row crosswalk independently of this file's prose.
// ═══════════════════════════════════════════════════════════════════

import { DOMAINS } from "./_worker-contracts.js";

/** SPEC §7 — THE AUTONOMOUS WORKFORCE, canonical order. */
export const SPEC_SYSTEMS = Object.freeze([
	{ key: "A", name: "OPERATIONS" },
	{ key: "B", name: "TRUST & SAFETY" },
	{ key: "C", name: "CONTENT UNDERSTANDING" },
	{ key: "D", name: "COMMUNITY OPERATIONS" },
	{ key: "E", name: "CASE MANAGEMENT" },
	{ key: "F", name: "SEARCH & KNOWLEDGE" },
	{ key: "G", name: "DATABASE" },
	{ key: "H", name: "PERFORMANCE" },
	{ key: "I", name: "QUEUES" },
	{ key: "J", name: "NOTIFICATIONS" },
	{ key: "K", name: "STORAGE" },
	{ key: "L", name: "REALTIME" },
	{ key: "M", name: "SECURITY" },
	{ key: "N", name: "QA" },
	{ key: "O", name: "AI QUALITY" },
	{ key: "P", name: "RELEASE & CHANGE" },
	{ key: "Q", name: "AUTONOMOUS COWORKER" },
]);

/**
 * Spec §7 system → FRAMEWORK §8 primary domain + carrying rows.
 * Exactly one primary per system (its §8 home); rows living in other
 * domains are cited in `source`, not promoted to a second primary —
 * one home keeps the map checkable.
 */
export const SPEC_SYSTEM_MAP = Object.freeze({
	A: {
		name: "OPERATIONS",
		primary: "orchestration",
		source: "§8.1 Event Engine, Work Dispatcher, Scheduler, Retry Engine, Dependency Manager, Watchdog",
	},
	B: {
		name: "TRUST & SAFETY",
		primary: "trust_safety",
		source: "§8.2 Harassment, Threat Detection, PII Protection, Child Safety, Sexual Safety, Spam/Abuse, Enforcement",
	},
	C: {
		name: "CONTENT UNDERSTANDING",
		primary: "trust_safety",
		source: "§8.2 Content Understanding, Context/Slang",
	},
	D: {
		name: "COMMUNITY OPERATIONS",
		primary: "community",
		source: "§8.3 Duplicate Detection, Issue Clustering, Priority, Poll Operations, Community Health",
	},
	E: {
		name: "CASE MANAGEMENT",
		primary: "community",
		source: "§8.3 Case Lifecycle",
	},
	F: {
		name: "SEARCH & KNOWLEDGE",
		primary: "search_knowledge",
		source: "§8.4 Search, Ranking, RAG, Knowledge Updates, Zero-result Recovery",
	},
	G: { name: "DATABASE", primary: "platform", source: "§8.5 Database" },
	H: { name: "PERFORMANCE", primary: "platform", source: "§8.5 Performance (load manager)" },
	I: {
		name: "QUEUES",
		primary: "platform",
		source: "§8.5 Queue; §8.1 Work Dispatcher/Retry Engine/Dependency Manager queue mechanics",
	},
	J: { name: "NOTIFICATIONS", primary: "platform", source: "§8.5 Notifications" },
	K: { name: "STORAGE", primary: "platform", source: "§8.5 Storage" },
	L: { name: "REALTIME", primary: "platform", source: "§8.5 Realtime" },
	M: {
		name: "SECURITY",
		primary: "security",
		source: "§8.6 Detection, Authorization Testing, Abuse Detection, Incident Response, Verification (meta)",
	},
	N: { name: "QA", primary: "quality", source: "§8.7 E2E QA, Mobile QA, Accessibility" },
	O: { name: "AI QUALITY", primary: "quality", source: "§8.7 AI Evaluation, Red Team, Drift" },
	P: { name: "RELEASE & CHANGE", primary: "quality", source: "§8.7 Regression (golden journeys)" },
	Q: {
		name: "AUTONOMOUS COWORKER",
		primary: "coworker",
		source: "§8.8 Chat, Voice, Files, Research, Coding, Investigation, Delegation, Reports",
	},
});

/**
 * Validate the crosswalk. Tamper-evident by construction: any missing,
 * extra, renamed, uncited, or unmapped entry produces a named error.
 *
 * @param {Record<string, {name?: unknown, primary?: unknown, source?: unknown}>} [map]
 * @param {{key: string, name: string}[]} [systems]
 * @param {string[]} [domains]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDomainMap(map = SPEC_SYSTEM_MAP, systems = SPEC_SYSTEMS, domains = DOMAINS) {
	const errors = [];
	const req = (cond, msg) => {
		if (!cond) errors.push(msg);
	};

	req(map && typeof map === "object" && !Array.isArray(map), "map must be an object");
	if (errors.length) return { ok: false, errors };

	const systemKeys = systems.map((s) => s.key);

	for (const s of systems) {
		const entry = map[s.key];
		req(entry !== undefined, `missing spec system ${s.key} (${s.name})`);
		if (entry === undefined) continue;
		req(entry && typeof entry === "object" && !Array.isArray(entry), `${s.key}: entry must be an object`);
		if (!entry || typeof entry !== "object") continue;
		req(entry.name === s.name, `${s.key}: name "${entry.name}" does not match spec §7 "${s.name}"`);
		req(
			typeof entry.primary === "string" && domains.includes(entry.primary),
			`${s.key}: primary "${entry.primary}" is not a FRAMEWORK §8 domain`,
		);
		req(
			typeof entry.source === "string" && entry.source.includes("§8"),
			`${s.key}: source must cite a FRAMEWORK §8 row (e.g. "§8.1 …")`,
		);
	}

	for (const k of Object.keys(map)) {
		req(systemKeys.includes(k), `unknown map key "${k}" — not a spec §7 system`);
	}

	for (const d of domains) {
		req(
			Object.values(map).some((e) => e && typeof e === "object" && e.primary === d),
			`domain "${d}" carries no spec §7 system`,
		);
	}

	return { ok: errors.length === 0, errors };
}
