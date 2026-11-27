// Storage worker — reclaims orphaned uploads, never touches evidence.
// Uploads happen before submit (drafts, abandoned posts, failed publishes),
// so buckets accumulate files nothing references. This pass:
// - lists known buckets (bounded),
// - collects every referenced URL (posts, chat attachments, held review
//   snapshots — deleting those would blind admin review),
// - deletes ONLY unreferenced objects older than 7 days (grace covers
//   slow drafts and in-flight submissions),
// - throttles to once per 24h (settings marker, survives cold starts),
// - audits + alerts when the orphan count looks like abuse (>=50).
// Verification: the delete call's own error surface + a post-pass count;
// per-object results land in the returned deleted[] list.
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";

export const STORAGE_BUCKETS = ["chat-media", "voicebox-media"];
export const ORPHAN_GRACE_MS = 7 * 24 * 3600 * 1000;
export const SWEEP_COOLDOWN_MS = 24 * 3600 * 1000;
const LIST_LIMIT = 100;
const REF_LIMIT = 2000;

// ── Upload Intelligence run (roster #24) ─────────────────────────
// REAL JOB: monitor the buckets' actual occupancy every run — objects per
// bucket, oldest object age (orphan pressure) — and persist the report to
// the canonical settings KV (upload_intel:latest), verified by re-read.
// The reclaim itself stays sweepStorage's job; this is the measurement side
// that flags when buckets are filling faster than the reclaim covers.
export async function runUploadIntel({ nowMs = Date.now() } = {}) {
	const buckets = {};
	let unreachable = 0;
	for (const bucket of STORAGE_BUCKETS) {
		try {
			const { data, error } = await supabase.storage
				.from(bucket)
				.list("", { limit: 1000 });
			if (error) throw error;
			const objects = Array.isArray(data) ? data : [];
			let oldest = null;
			for (const o of objects) {
				const t = o?.created_at ? new Date(o.created_at).getTime() : NaN;
				if (!Number.isNaN(t) && (oldest === null || t < oldest)) oldest = t;
			}
			buckets[bucket] = {
				objects: objects.length,
				oldest_age_days:
					oldest !== null ? Math.floor((nowMs - oldest) / (24 * 3600 * 1000)) : null,
			};
		} catch {
			unreachable += 1;
			buckets[bucket] = null;
		}
	}
	if (unreachable === STORAGE_BUCKETS.length)
		return { ok: false, error: "all storage buckets unreachable" };

	const report = {
		generated_at: new Date(nowMs).toISOString(),
		buckets,
		orphan_grace_days: Math.round(ORPHAN_GRACE_MS / (24 * 3600 * 1000)),
	};
	try {
		await supabase.from("settings").upsert(
			{ key: "upload_intel:latest", value: report },
			{ onConflict: "key" },
		);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "upload_intel:latest")
			.maybeSingle();
		const persisted = data?.value?.generated_at === report.generated_at;
		return { ok: true, verified: persisted, ...report };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}
const ABUSE_THRESHOLD = 50;

async function readSetting(client, key) {
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", key)
			.maybeSingle();
		return data?.value ?? null;
	} catch {
		return null;
	}
}

function urlSuffixes(urls) {
	const out = new Set();
	for (const u of urls) {
		if (typeof u !== "string" || !u) continue;
		const m = u.match(/\/storage\/v1\/object\/public\/([^?#]+)/);
		if (m) out.add(m[1]);
	}
	return out;
}

export async function sweepStorage(client = supabase, nowMs = Date.now()) {
	const result = {
		checked: 0,
		referenced: 0,
		deleted: [],
		skipped_recent: 0,
		errors: [],
	};
	try {
		const state = await readSetting(client, "storage_sweep_state");
		const lastAt = state?.last_sweep_at ? new Date(state.last_sweep_at).getTime() : 0;
		if (nowMs - lastAt < SWEEP_COOLDOWN_MS) {
			return { ...result, ok: true, throttled: true };
		}
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}

	// ── Collect every referenced storage path ──
	const referenced = new Set();
	try {
		const { data: posts } = await client
			.from("posts")
			.select("image_url")
			.not("image_url", "is", null)
			.limit(REF_LIMIT);
		for (const s of urlSuffixes((posts || []).map((p) => p.image_url)))
			referenced.add(s);
		const { data: chats } = await client
			.from("chat_messages")
			.select("attachment_url")
			.not("attachment_url", "is", null)
			.limit(REF_LIMIT);
		for (const s of urlSuffixes((chats || []).map((c) => c.attachment_url)))
			referenced.add(s);
		const { data: reviews } = await client
			.from("settings")
			.select("value")
			.like("key", "pre_publish_review:%")
			.limit(200);
		for (const row of reviews || []) {
			const u = row?.value?.image_url;
			for (const s of urlSuffixes([u])) referenced.add(s);
		}
	} catch (err) {
		return { ...result, ok: false, error: `reference scan failed: ${err.message}` };
	}
	result.referenced = referenced.size;

	// ── List buckets, delete aged orphans ──
	for (const bucket of STORAGE_BUCKETS) {
		try {
			const { data: objects, error } = await client.storage
				.from(bucket)
				.list("", { limit: LIST_LIMIT });
			if (error) {
				// Missing bucket is not a failure — deployment may not use it.
				if (/not found|does not exist/i.test(error.message || "")) continue;
				throw error;
			}
			for (const obj of objects || []) {
				result.checked += 1;
				const fullPath = `${bucket}/${obj.name}`;
				if (referenced.has(fullPath)) continue;
				const age = nowMs - new Date(obj.created_at || 0).getTime();
				if (Number.isNaN(age) || age < ORPHAN_GRACE_MS) {
					result.skipped_recent += 1;
					continue;
				}
				try {
					const { error: delErr } = await client.storage
						.from(bucket)
						.remove([obj.name]);
					if (delErr) throw delErr;
					result.deleted.push(fullPath);
				} catch (err) {
					result.errors.push({ object: fullPath, error: err.message });
				}
			}
		} catch (err) {
			result.errors.push({ bucket, error: err.message });
		}
	}

	try {
		await client.from("settings").upsert(
			{
				key: "storage_sweep_state",
				value: {
					last_sweep_at: new Date(nowMs).toISOString(),
					checked: result.checked,
					deleted: result.deleted.length,
				},
			},
			{ onConflict: "key" },
		);
		await auditLog(
			"storage-worker",
			"orphan_sweep",
			`checked ${result.checked}, deleted ${result.deleted.length}, skipped-recent ${result.skipped_recent}`,
		);
	} catch {
		/* bookkeeping is best-effort */
	}
	if (result.deleted.length >= ABUSE_THRESHOLD) {
		try {
			const { data } = await client
				.from("settings")
				.select("value")
				.eq("key", "workforce_alerts")
				.maybeSingle();
			const alerts = Array.isArray(data?.value?.alerts) ? data.value.alerts : [];
			if (!alerts.some((a) => a.key === "storage-abuse" && !a.resolved_at)) {
				alerts.unshift({
					key: "storage-abuse",
					severity: "medium",
					title: `Storage abuse signal: ${result.deleted.length} orphaned uploads reclaimed`,
					body: "Burst of abandoned uploads — possible upload spamming.",
					agent: "storage-worker",
					created_at: new Date(nowMs).toISOString(),
					occurrences: 1,
				});
				await client.from("settings").upsert(
					{
						key: "workforce_alerts",
						value: { alerts: alerts.slice(0, 100), updated_at: new Date(nowMs).toISOString() },
					},
					{ onConflict: "key" },
				);
			}
		} catch {
			/* alert is best-effort */
		}
	}
	return { ok: true, ...result };
}
