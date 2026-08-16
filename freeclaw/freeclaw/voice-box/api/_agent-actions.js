// Real-Work Action Layer
// Shared audited, budgeted, idempotent actions that the agent team performs on
// real platform data (moderation, curation, triage, support). Every action is:
//   - budgeted:  a per-run cap so one agent cycle can never spam the database
//   - audited:   each attempt is recorded in the agent's `actions` array, which
//                flows into the result data, agent_reports, and the admin UI
//   - idempotent: re-running the same scan will not duplicate flags/replies
//   - kill-switchable: settings key `agent_actions_enabled` -> { enabled: false }
//                disables all writes while keeping analysis read-only
// Imported by api/_agent-team.js and api/_agents-cron.js (ESM only).
import { clean, maskProfanity } from "./_auth.js";

export const AGENT_ACTIONS_KEY = "agent_actions_enabled";
export const ACTION_BUDGET_MAX = 12;

export function createActionBudget(max = ACTION_BUDGET_MAX) {
	return { used: 0, max };
}

export function budgetLeft(budget) {
	return budget.used < budget.max;
}

// Kill switch: read settings `agent_actions_enabled`. Absent value -> enabled.
export async function agentActionsEnabled(supabase) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", AGENT_ACTIONS_KEY)
			.single();
		const val = data?.value;
		if (val == null) return true;
		const parsed = typeof val === "string" ? JSON.parse(val) : val;
		return parsed?.enabled !== false;
	} catch {
		return true;
	}
}

// Core tracked write. `fn` returns { ok, skipped?, error? } or a truthy value.
// Budget increments only on successful, non-skipped actions; every attempt is
// recorded for observability.
async function act(budget, actions, entry, fn) {
	if (!budgetLeft(budget)) return null;
	try {
		const res = await fn();
		const ok = res?.ok ?? !!res;
		const rec = {
			...entry,
			ok,
			skipped: res?.skipped || false,
			at: new Date().toISOString(),
		};
		if (res?.error) rec.error = res.error;
		actions.push(rec);
		if (ok && !res?.skipped) budget.used += 1;
		return rec;
	} catch (err) {
		const rec = {
			...entry,
			ok: false,
			error: err.message || String(err),
			at: new Date().toISOString(),
		};
		actions.push(rec);
		return rec;
	}
}

const touch = () => ({ updated_at: new Date().toISOString() });

// Hide a post (soft, reversible). Skips if already hidden is handled by caller.
export function agentHidePost(
	supabase,
	budget,
	actions,
	agent,
	postId,
	reason,
) {
	return act(
		budget,
		actions,
		{ type: "hide_post", agent: agent.id, target_id: postId, reason },
		async () => {
			const { error } = await supabase
				.from("posts")
				.update({ hidden: true, ...touch() })
				.eq("id", postId);
			return { ok: !error, error: error?.message };
		},
	);
}

// Insert a moderation-queue flag (reports row). Dedupes against existing
// pending reports with the same target+reason, so repeated scans don't pile up.
export function agentFlagTarget(supabase, budget, actions, agent, target) {
	return act(
		budget,
		actions,
		{
			type: "flag_target",
			agent: agent.id,
			target_id: target.target_id,
			target_type: target.target_type || "post",
			reason: target.reason,
		},
		async () => {
			const { data: existing } = await supabase
				.from("reports")
				.select("id,status")
				.eq("target_id", target.target_id)
				.eq("target_type", target.target_type || "post")
				.eq("reason", target.reason)
				.limit(20);
			if ((existing || []).some((r) => r.status === "pending"))
				return { ok: true, skipped: true };
			const { error } = await supabase.from("reports").insert({
				target_id: target.target_id,
				target_type: target.target_type || "post",
				reason: target.reason,
				author_id: `agent_${agent.id}`,
				status: "pending",
			});
			return { ok: !error, error: error?.message };
		},
	);
}

// Resolve a batch of reports (spam confirmed, target hidden, etc.)
export function agentResolveReports(
	supabase,
	budget,
	actions,
	agent,
	reportIds,
	status = "auto_resolved",
) {
	const ids = Array.isArray(reportIds) ? reportIds.filter(Boolean) : [];
	if (!ids.length) return null;
	return act(
		budget,
		actions,
		{
			type: "resolve_reports",
			agent: agent.id,
			report_ids: ids,
			count: ids.length,
			status,
		},
		async () => {
			const { error } = await supabase
				.from("reports")
				.update({ status })
				.in("id", ids);
			return { ok: !error, error: error?.message };
		},
	);
}

// Generic single-row post patch with audit trail.
function agentPatchPost(
	supabase,
	budget,
	actions,
	agent,
	postId,
	patch,
	type,
	detail,
) {
	return act(
		budget,
		actions,
		{ type, agent: agent.id, target_id: postId, ...detail },
		async () => {
			const { error } = await supabase
				.from("posts")
				.update({ ...patch, ...touch() })
				.eq("id", postId);
			return { ok: !error, error: error?.message };
		},
	);
}

export const agentPinPost = (supabase, budget, actions, agent, postId) =>
	agentPatchPost(
		supabase,
		budget,
		actions,
		agent,
		postId,
		{ pinned: true },
		"pin_post",
		{},
	);

export const agentFeaturePost = (supabase, budget, actions, agent, postId) =>
	agentPatchPost(
		supabase,
		budget,
		actions,
		agent,
		postId,
		{ featured: true },
		"feature_post",
		{},
	);

export const agentSetPriority = (
	supabase,
	budget,
	actions,
	agent,
	postId,
	priority,
) =>
	agentPatchPost(
		supabase,
		budget,
		actions,
		agent,
		postId,
		{ priority },
		"set_priority",
		{ priority },
	);

export const agentAssignPost = (
	supabase,
	budget,
	actions,
	agent,
	postId,
	assignedTo,
) =>
	agentPatchPost(
		supabase,
		budget,
		actions,
		agent,
		postId,
		{ assigned_to: clean(assignedTo, 100) },
		"assign_post",
		{ assigned_to: assignedTo },
	);

export const agentSetEta = (supabase, budget, actions, agent, postId, eta) =>
	agentPatchPost(
		supabase,
		budget,
		actions,
		agent,
		postId,
		{ eta: clean(eta, 100) },
		"set_eta",
		{ eta },
	);

export function agentAdminReply(
	supabase,
	budget,
	actions,
	agent,
	postId,
	reply,
) {
	const body = maskProfanity(clean(reply, 1000));
	return agentPatchPost(
		supabase,
		budget,
		actions,
		agent,
		postId,
		{ admin_reply: body },
		"admin_reply",
		{ body: body.slice(0, 60) },
	);
}

// Post a public admin comment on a thread (visible in the product, is_admin: true).
export function agentCommentReply(
	supabase,
	budget,
	actions,
	agent,
	postId,
	body,
) {
	const safe = maskProfanity(clean(body, 500));
	return act(
		budget,
		actions,
		{
			type: "comment_reply",
			agent: agent.id,
			target_id: postId,
			body: safe.slice(0, 80),
		},
		async () => {
			const commentId = `cmt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
			const { error } = await supabase.from("comments").insert({
				id: commentId,
				post_id: postId,
				parent_id: null,
				author_id: `agent_${agent.id}`,
				body: safe,
				is_admin: true,
			});
			if (error) return { ok: false, error: error.message };
			await supabase.from("posts").update(touch()).eq("id", postId);
			return { ok: true };
		},
	);
}

// Compact summary for embedding in rawData: count of real (non-skipped) actions.
export function summarizeActions(actions) {
	const done = (actions || []).filter((a) => a.ok && !a.skipped);
	const byType = {};
	done.forEach((a) => {
		byType[a.type] = (byType[a.type] || 0) + 1;
	});
	return { actions_taken: done.length, action_breakdown: byType };
}
