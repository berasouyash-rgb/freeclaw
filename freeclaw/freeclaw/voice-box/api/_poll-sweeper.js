// Poll sweeper — closes the loop on expired polls nobody opened.
// _polls.js only sends the poll_closed notification when a client calls
// action:"closed" (i.e. someone views the poll), so an expired poll nobody
// opens never notifies its author. This deterministic pass runs inside the
// agent-cron tick: find expired polls, send the idempotent notification +
// email exactly once each, never touch votes or visibility.
//
// Design: same idempotency key as _polls.js action:"closed" (a poll_closed
// notification row for that poll), same email helper, same 100-item cap.
// Bounded (50 polls/tick) with per-poll try/catch so one bad row never
// aborts the sweep. No LLM — expiry is a timestamp comparison.
import supabase from "./_db-client.js";
import { sendPollClosedEmail } from "./_email.js";

const SWEEP_LIMIT = 50;

export async function sweepExpiredPolls(client = supabase) {
	const now = new Date().toISOString();
	const result = { checked: 0, notified: 0, skipped: 0, errors: [] };

	let polls = [];
	try {
		const { data, error } = await client
			.from("polls")
			.select("id,title,author_id,post_id,expires_at")
			.eq("archived", false)
			.eq("deleted", false)
			.not("expires_at", "is", null)
			.lt("expires_at", now)
			.limit(SWEEP_LIMIT);
		if (error) throw error;
		polls = data || [];
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}
	result.checked = polls.length;

	for (const poll of polls) {
		try {
			const key = `notifications:${poll.author_id}`;
			const { data: row } = await client
				.from("settings")
				.select("value")
				.eq("key", key)
				.maybeSingle();
			const existing = (row?.value?.notifications || []).find(
				(n) => n.type === "poll_closed" && n.poll_id === poll.id,
			);
			if (existing) {
				result.skipped += 1;
				continue;
			}
			const notification = {
				id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
				type: "poll_closed",
				title: "Your poll closed",
				body: `“${(poll.title || "").slice(0, 80)}” has closed — results are in.`,
				post_id: poll.post_id || null,
				poll_id: poll.id,
				read: false,
				created_at: new Date().toISOString(),
			};
			const notifications = [
				notification,
				...(row?.value?.notifications || []),
			].slice(0, 100);
			await client.from("settings").upsert(
				{
					key,
					value: { notifications, updated_at: new Date().toISOString() },
				},
				{ onConflict: "key" },
			);
			try {
				await sendPollClosedEmail({
					pollTitle: poll.title,
					pollId: poll.id,
					authorId: poll.author_id,
					postId: poll.post_id,
				});
			} catch {
				/* email is best-effort; the in-app notification already landed */
			}
			result.notified += 1;
		} catch (err) {
			result.errors.push({ poll_id: poll.id, error: err.message });
		}
	}

	return { ok: true, ...result };
}
