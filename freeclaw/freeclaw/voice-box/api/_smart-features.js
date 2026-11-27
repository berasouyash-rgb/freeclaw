// Ten practical admin intelligence features. Every result is derived from
// live platform data or a real model call. No fabricated rows, no mock data.
// Each action has an honest failure path; nothing changes production data
// except the explicitly approved publish action.

import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { callLLMChain, hasUsableLLM, buildChain } from "./_providers.js";
import { generateBriefing } from "./_briefing.js";

const CATEGORY_WEIGHT = {
	Bullying: 40, Security: 40, Medical: 35, Safety: 35,
	Food: 15, Facilities: 12, Transport: 12, Academic: 10,
	Staff: 15, Technology: 8, Events: 5, General: 5, Other: 5,
};
const STATUS_EXPLAIN = {
	reported: "Your feedback is in the moderation queue. A reviewer checks it before it appears publicly.",
	verified: "A reviewer confirmed this report. It is waiting for a team response.",
	in_progress: "A staff member is working on this issue.",
	waiting: "The issue is acknowledged; we are waiting for an update from the responsible team.",
	solved: "This issue was resolved. Thank you for reporting it.",
	archived: "This report is closed and archived.",
	pending_review: "Your post is held for a safety review before it becomes public.",
	rejected: "This submission was not accepted under the platform rules.",
};

function tokens(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2);
}
function similarity(a, b) {
	const A = new Set(tokens(a));
	const B = new Set(tokens(b));
	if (!A.size || !B.size) return 0;
	let shared = 0;
	for (const t of A) if (B.has(t)) shared++;
	return shared / new Set([...A, ...B]).size;
}
function daysAgo(n) {
	return new Date(Date.now() - n * 86400000).toISOString();
}

async function recentPosts(days = 30, limit = 300) {
	const { data, error } = await supabase
		.from("posts")
		.select("id,title,description,category,status,priority,created_at,comment_count")
		.eq("deleted", false)
		.eq("hidden", false)
		.gte("created_at", daysAgo(days))
		.order("created_at", { ascending: false })
		.limit(limit);
	if (error) throw error;
	return data || [];
}

async function llm(system, prompt, budget = 15000) {
	if (!(await hasUsableLLM()))
		return { ok: false, error: "No AI provider is currently available." };
	try {
		const r = await callLLMChain(system, prompt, [], "low", budget);
		if (!r?.ok || !r.text) return { ok: false, error: "The model did not return an answer." };
		return { ok: true, text: r.text };
	} catch (e) {
		return { ok: false, error: e?.message || "Model call failed" };
	}
}

// 1 — duplicate clustering
async function duplicates(params) {
	const days = Math.min(Number(params.days) || 30, 90);
	const posts = await recentPosts(days, 300);
	const groups = [];
	const used = new Set();
	for (let i = 0; i < posts.length; i++) {
		if (used.has(posts[i].id)) continue;
		const cluster = [posts[i]];
		used.add(posts[i].id);
		for (let j = i + 1; j < posts.length; j++) {
			if (used.has(posts[j].id)) continue;
			if (posts[i].category && posts[j].category && posts[i].category !== posts[j].category) continue;
			if (similarity(`${posts[i].title} ${posts[i].description}`, `${posts[j].title} ${posts[j].description}`) >= 0.62) {
				cluster.push(posts[j]);
				used.add(posts[j].id);
			}
		}
		if (cluster.length > 1)
			groups.push({
				count: cluster.length,
				category: cluster[0].category || "General",
				posts: cluster.map((p) => ({ id: p.id, title: p.title, created_at: p.created_at })),
			});
	}
	groups.sort((a, b) => b.count - a.count);
	return { groups, scanned: posts.length, note: "Grouped by title/description similarity within the same category." };
}

// 2 — explainable priority
async function priorities(params) {
	const posts = await recentPosts(Math.min(Number(params.days) || 30, 90), 300);
	const ids = posts.map((p) => p.id);
	let reports = [];
	if (ids.length) {
		const { data } = await supabase
			.from("reports")
			.select("target_id,reason,status")
			.in("target_id", ids)
			.eq("status", "open")
			.limit(1000);
		reports = data || [];
	}
	const reportCounts = new Map();
	for (const r of reports) reportCounts.set(r.target_id, (reportCounts.get(r.target_id) || 0) + 1);
	const scored = posts
		.filter((p) => !["solved", "archived"].includes(p.status))
		.map((p) => {
			const weight = CATEGORY_WEIGHT[p.category] || 5;
			const rc = reportCounts.get(p.id) || 0;
			const ageDays = Math.max(0, (Date.now() - +new Date(p.created_at)) / 86400000);
			const score = weight + rc * 10 + Math.min(ageDays, 14) * 2 + (p.priority === "high" ? 15 : 0);
			return {
				id: p.id, title: p.title, category: p.category, status: p.status,
				score, reasons: [`category ${p.category || "General"}: ${weight}`, `${rc} open report(s)`, `age ${Math.round(ageDays)} day(s)`],
			};
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, Number(params.limit) || 10);
	return { ranked: scored, note: "Heuristic score from real category, open reports, age and priority." };
}

// 3 — moderation triage (never auto-hides)
async function moderation(params) {
	const id = clean(params.post_id, 80);
	if (!id) return { error: "post_id required" };
	const [post, reports] = await Promise.all([
		supabase.from("posts").select("id,title,description,category,status,hidden,deleted").eq("id", id).maybeSingle(),
		supabase.from("reports").select("reason,status,created_at").eq("target_id", id).order("created_at", { ascending: false }).limit(30),
	]);
	if (post.error) throw post.error;
	if (!post.data) return { error: "Post not found" };
	const r = await llm(
		"You are a moderation triage assistant. Decide whether a reported school post is a legitimate complaint or spam. Never recommend hiding solely because it was reported. Return JSON: {\"verdict\":\"legitimate|spam|uncertain\",\"reason\":\"short evidence-based reason\"}.",
		`Post: ${post.data.title}\nCategory: ${post.data.category}\nContent: ${String(post.data.description || "").slice(0, 1500)}\nReport reasons: ${(reports.data || []).map((x) => x.reason).join(" | ").slice(0, 1200)}`,
	);
	let verdict = { verdict: "uncertain", reason: "Automated triage unavailable — requires human review." };
	if (r.ok) {
		try {
			const m = r.text.match(/\{[\s\S]*\}/);
			if (m) verdict = JSON.parse(m[0]);
		} catch { /* keep uncertain */ }
	}
	return { post: post.data, reports: reports.data || [], verdict, auto_hidden: false, note: "No moderation action was taken." };
}

// 4 — grounded reply draft (never published here)
async function replyDraft(params) {
	const id = clean(params.post_id, 80);
	if (!id) return { error: "post_id required" };
	const [post, reports] = await Promise.all([
		supabase.from("posts").select("id,title,description,category,status,admin_reply").eq("id", id).maybeSingle(),
		supabase.from("reports").select("reason").eq("target_id", id).limit(20),
	]);
	if (!post.data) return { error: "Post not found" };
	const r = await llm(
		"Write a short, empathetic, official admin reply to a student. Reference only facts given. Do not promise timelines that are not stated. Do not mention AI, SQL or internal systems.",
		`Post: ${post.data.title}\nConcern: ${String(post.data.description || "").slice(0, 1200)}\nReports: ${(reports.data || []).map((x) => x.reason).join(", ")}`,
	);
	if (!r.ok) return { error: r.error, post: post.data };
	return { post: post.data, draft: r.text.trim().slice(0, 1200), published: false, note: "Draft only — publishing requires explicit approval." };
}

// 5 — daily briefing (reuses the verified, persisted briefing builder)
async function briefing() {
	const result = await generateBriefing();
	return result;
}

// 6 — trend and anomaly alerts
async function trends(params) {
	const current = await recentPosts(7, 500);
	const previousRaw = await recentPosts(14, 800);
	const prevStart = Date.now() - 14 * 86400000;
	const prevEnd = Date.now() - 7 * 86400000;
	const previous = previousRaw.filter((p) => {
		const t = +new Date(p.created_at);
		return t >= prevStart && t < prevEnd;
	});
	const tally = (rows) => {
		const m = new Map();
		for (const r of rows) m.set(r.category || "General", (m.get(r.category || "General") || 0) + 1);
		return m;
	};
	const now = tally(current);
	const before = tally(previous);
	const alerts = [];
	for (const [cat, count] of now) {
		const prior = before.get(cat) || 0;
		if (prior === 0 && count >= 3) alerts.push({ category: cat, count, prior, change: "new", severity: "medium" });
		else if (prior > 0 && ((count - prior) / prior) * 100 >= 50)
			alerts.push({ category: cat, count, prior, change: `+${Math.round(((count - prior) / prior) * 100)}%`, severity: "high" });
	}
	alerts.sort((a, b) => b.count - a.count);
	return { alerts, current_count: current.length, previous_count: previous.length, note: "7-day vs previous 7-day category counts from live posts." };
}

// 7 — semantic-leaning search: expand the query with a real model, then search
async function search(params) {
	const q = clean(params.query, 200);
	if (!q) return { error: "query required" };
	let terms = [q];
	const r = await llm(
		"Return only 3-6 short search keywords for this query, comma separated. No explanation.",
		q,
		8000,
	);
	if (r.ok) terms = [...new Set([q, ...r.text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 6)])];
	const results = [];
	for (const term of terms) {
		const safe = term.replace(/[%_,()\\]/g, " ").trim();
		if (!safe) continue;
		const like = `%${safe}%`;
		const { data } = await supabase
			.from("posts")
			.select("id,title,description,category,status,created_at")
			.eq("deleted", false)
			.or(`title.ilike.${like},description.ilike.${like}`)
			.order("created_at", { ascending: false })
			.limit(20);
		for (const row of data || []) if (!results.some((x) => x.id === row.id)) results.push(row);
	}
	return { results: results.slice(0, 25), terms, expanded: r.ok, note: r.ok ? "Query expanded by the model, then searched live posts." : "Model unavailable — searched the literal query." };
}

// 8 — thread summarisation
async function summary(params) {
	const id = clean(params.post_id, 80);
	if (!id) return { error: "post_id required" };
	const [post, comments] = await Promise.all([
		supabase.from("posts").select("id,title,description").eq("id", id).maybeSingle(),
		supabase.from("comments").select("body,is_admin,created_at").eq("post_id", id).eq("deleted", false).order("created_at", { ascending: true }).limit(200),
	]);
	if (!post.data) return { error: "Post not found" };
	const rows = comments.data || [];
	if (!rows.length) return { post: post.data, summary: "No comments to summarise.", comment_count: 0 };
	const r = await llm(
		"Summarise this discussion into: key facts, disagreements, and unresolved questions. Use only the text provided. No invented details.",
		`Post: ${post.data.title}\nComments:\n${rows.map((c, i) => `${i + 1}. ${String(c.body || "").slice(0, 500)}`).join("\n").slice(0, 6000)}`,
	);
	if (!r.ok) return { error: r.error, post: post.data, comment_count: rows.length };
	return { post: post.data, summary: r.text.trim().slice(0, 2000), comment_count: rows.length };
}

// 9 — student status explainer (deterministic, honest)
async function studentStatus(params) {
	const id = clean(params.post_id, 80);
	if (!id) return { error: "post_id required" };
	const { data } = await supabase
		.from("posts")
		.select("id,title,status,priority,created_at,updated_at,admin_reply,solved_at")
		.eq("id", id)
		.maybeSingle();
	if (!data) return { error: "Post not found" };
	return {
		post: { id: data.id, title: data.title },
		status: data.status,
		explanation: STATUS_EXPLAIN[data.status] || "Your report is being reviewed by the platform team.",
		has_admin_reply: !!data.admin_reply,
		note: "Plain-language status from the live record. No dates are promised beyond what is stored.",
	};
}

// 10 — free-tier quota / provider watchdog
async function quota() {
	const usable = await hasUsableLLM();
	const chain = usable ? await buildChain() : [];
	return {
		model_available: usable,
		configured_providers: chain.length,
		providers: chain.map((p) => ({ id: p.id, model: p.model })),
		warning: usable
			? "Free-tier providers can be rate-limited. Responses degrade honestly when exhausted."
			: "No AI provider is currently usable — AI-backed features will report unavailability.",
		note: "Derived from live provider configuration, not an estimate.",
	};
}

const ACTIONS = {
	duplicates, priorities, moderation, briefing,
	trends, search, summary, quota,
	reply_draft: replyDraft,
	student_status: studentStatus,
};

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	try {
		if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });
		const b = req.body || {};
		const action = b.action || (req.method === "GET" ? req.query.action : null);
		if (action === "list")
			return res.status(200).json({ features: Object.keys(ACTIONS) });
		if (!action || !ACTIONS[action])
			return res.status(400).json({ error: "Unknown feature", available: Object.keys(ACTIONS) });
		const result = await ACTIONS[action](b);
		await auditLog("admin", `smart_${action}`, `Smart feature ${action} executed`);
		if (result?.error) return res.status(400).json(result);
		return res.status(200).json({ feature: action, ...result });
	} catch (err) {
		return sanitizeError(res, err, "smart-features");
	}
}
