// Admin auth (hashed password + session timeout), user management, logs, settings

import crypto from "crypto";
import {
	auditLog,
	clientIp,
	clean,
	cors,
	invalidateAdminTokenCache,
	isAdmin,
	notifyUser,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { getSpamConfig, normalizeSpamConfig } from "./_moderation.js";
import { scanSlang } from "./_slang.js";

const SESSION_MS = 60 * 60 * 1000; // 60 minute session timeout

// ─── Env-secret admin auth (recommended over a shared password) ──────────
// Set ADMIN_SESSION_SECRET (plaintext) or ADMIN_SESSION_SECRET_SHA256 (its
// SHA-256 hex) in the deployment environment. The secret then REPLACES the
// shared password as the login credential: it never lives in the database,
// rotate it by changing the env var, and it can differ per environment.
// Sessions are still 60-minute, DB-backed, revocable tokens — env auth only
// changes who may MINT a session, not how sessions work.
function envSecretHash() {
	const raw = process.env.ADMIN_SESSION_SECRET;
	if (raw && raw.trim().length >= 16) {
		return crypto.createHash("sha256").update(raw.trim()).digest("hex");
	}
	const hashed = process.env.ADMIN_SESSION_SECRET_SHA256;
	if (hashed && /^[0-9a-f]{64}$/.test(hashed.trim().toLowerCase())) {
		return hashed.trim().toLowerCase();
	}
	return null;
}
function timingSafeHexEqual(a, b) {
	if (!a || !b || a.length !== b.length) return false;
	try {
		return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
	} catch {
		return false;
	}
}

/** Mint a session and persist it; shared by password and env login. */
async function mintSession(ip) {
	resetLoginAttempts(ip);
	const token = crypto.randomBytes(24).toString("hex");
	const sessions = (await getSetting("admin_sessions")) || { tokens: [] };
	const now = Date.now();
	sessions.tokens = [
		...sessions.tokens.filter((t) => t.exp > now),
		{ t: token, exp: now + SESSION_MS },
	].slice(-10);
	await setSetting("admin_sessions", sessions);
	await auditLog("admin", "login", "Admin signed in");
	return { token, expires_at: now + SESSION_MS };
}

// ─── Failed-login throttle (in-memory, mirrors _auth.js _rateLimitState) ─────
// The admin password is the single auth root for every admin endpoint, so an
// online brute-force guard is required. Keyed by client IP; survives warm
// invocations only (same durability contract as the other rate limiters).
const _loginAttempts = new Map(); // ip → { count, windowStart }
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minute window
const LOGIN_MAX_ATTEMPTS = 10; // 10 failed tries per window

function isLoginBlocked(ip) {
	const now = Date.now();
	const s = _loginAttempts.get(ip);
	if (!s) return false;
	if (now - s.windowStart >= LOGIN_WINDOW_MS) {
		_loginAttempts.delete(ip);
		return false;
	}
	return s.count >= LOGIN_MAX_ATTEMPTS;
}
function recordLoginFailure(ip) {
	const now = Date.now();
	const s = _loginAttempts.get(ip);
	if (!s || now - s.windowStart >= LOGIN_WINDOW_MS)
		_loginAttempts.set(ip, { count: 1, windowStart: now });
	else _loginAttempts.set(ip, { count: s.count + 1, windowStart: now });
	// Prune stale entries so the map can't grow unbounded
	if (_loginAttempts.size > 5000) {
		for (const [k, v] of _loginAttempts) {
			if (now - v.windowStart >= LOGIN_WINDOW_MS) _loginAttempts.delete(k);
		}
	}
}
function resetLoginAttempts(ip) {
	_loginAttempts.delete(ip);
}

async function getSetting(key) {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", key)
		.maybeSingle();
	return data?.value ?? null;
}
function normalizeRetentionHours(v) {
	if (v === undefined || v === null || v === "") return null;
	const n = typeof v === "string" ? Number(v) : v;
	if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
	if (n < 1 || n > 168) return null;
	return n;
}

async function setSetting(key, value) {
	const { data } = await supabase
		.from("settings")
		.select("key")
		.eq("key", key)
		.maybeSingle();
	if (data) await supabase.from("settings").update({ value }).eq("key", key);
	else await supabase.from("settings").insert({ key, value });
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		const b = req.body || {};
		const action = req.method === "GET" ? req.query.action : b.action;

		// ---------- AUTH ----------
		// auth_mode tells the login UI which credential to collect (and which
		// controls make sense in Settings) without leaking anything sensitive.
		if (action === "auth_mode") {
			return res.status(200).json({
				env_secret: envSecretHash() !== null,
			});
		}

		if (action === "login") {
			const ip = clientIp(req);
			if (isLoginBlocked(ip)) {
				return rateLimitResponse(
					res,
					LOGIN_WINDOW_MS / 1000,
					"Too many login attempts. Try again in 5 minutes.",
				);
			}
			const hash = clean(b.password_hash, 128);
			const envHash = envSecretHash();
			let ok = false;
			let how = "password";
			if (envHash) {
				// Env-secret mode: the env credential is the ONLY login root.
				// The DB password is ignored so a leaked/old DB hash grants nothing.
				how = "env_secret";
				ok = timingSafeHexEqual(envHash, hash);
				if (!ok) {
					recordLoginFailure(ip);
					await auditLog("system", "failed_login", "Bad admin secret attempt");
					return res.status(401).json({ error: "Incorrect admin secret." });
				}
			} else {
				// Password mode: SHA-256 hex comparison against the settings table.
				const stored = await getSetting("admin_password");
				let hashMatch = false;
				if (stored?.hash && hash && stored.hash.length === hash.length) {
					try {
						const storedBuf = Buffer.from(stored.hash, "hex");
						const inputBuf = Buffer.from(hash, "hex");
						if (storedBuf.length === inputBuf.length) {
							hashMatch = crypto.timingSafeEqual(storedBuf, inputBuf);
						}
					} catch {
						/* hex parse failure = no match */
					}
				}
				ok = hashMatch;
				if (!ok) {
					recordLoginFailure(ip);
					await auditLog("system", "failed_login", "Bad password attempt");
					return res.status(401).json({ error: "Incorrect password." });
				}
			}
			const session = await mintSession(ip);
			return res.status(200).json({ ...session, mode: how });
		}

		if (action === "revoke_all_sessions") {
			// Admin-initiated kill switch: drop every outstanding admin session.
			//
			// SECURITY: this branch sits ABOVE the shared isAdmin gate further
			// down, so it must authenticate itself. It did not: any anonymous
			// caller could wipe every admin session (platform-wide admin
			// lockout) and write a forged `admin` audit entry claiming a
			// legitimate admin did it.
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			await setSetting("admin_sessions", { tokens: [] });
			invalidateAdminTokenCache();
			await auditLog("admin", "revoke_all_sessions", "All admin sessions revoked");
			return res.status(200).json({ ok: true });
		}

		if (action === "verify") {
			return res.status(200).json({ valid: await isAdmin(req) });
		}

		if (action === "logout") {
			const token = req.headers["x-admin-token"];
			const sessions = (await getSetting("admin_sessions")) || { tokens: [] };
			sessions.tokens = sessions.tokens.filter((t) => t.t !== token);
			await setSetting("admin_sessions", sessions);
			// The token cache holds verified tokens for 30s per warm
			// instance: without this, a logged-out token keeps passing
			// isAdmin until the entry expires.
			invalidateAdminTokenCache();
			return res.status(200).json({ ok: true });
		}

		// ---------- everything below requires admin ----------
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		if (action === "get_leaderboard_config") {
			const cfg = await getSetting("leaderboard_config");
			return res.status(200).json(cfg || {});
		}

		if (action === "set_leaderboard_config") {
			const c = b.config;
			if (typeof c !== "object" || c === null || Array.isArray(c))
				return res.status(400).json({ error: "Invalid config" });
			const cfg = {
				enabled: c.enabled !== false,
				hide_empty: !!c.hide_empty,
				page_size: Math.min(100, Math.max(5, Number(c.page_size) || 25)),
				pinned_ids: Array.isArray(c.pinned_ids)
					? c.pinned_ids.map((x) => clean(x, 64)).filter(Boolean).slice(0, 10)
					: [],
			};
			await setSetting("leaderboard_config", cfg);
			await auditLog("admin", "leaderboard_config", JSON.stringify(cfg));
			return res.status(200).json(cfg);
		}

		// ── Agent-actions kill switch ────────────────────────────────
		// Mirrors AGENT_ACTIONS_KEY in _agent-actions.js. Reading the same
		// settings key keeps one source of truth; the UI switch is the
		// emergency stop the backend always supported but never exposed.
		if (action === "get_agent_actions") {
			const v = await getSetting("agent_actions_enabled");
			return res.status(200).json({ enabled: v?.enabled !== false });
		}

		if (action === "set_agent_actions") {
			const enabled = b.enabled === true;
			if (typeof b.enabled !== "boolean")
				return res.status(400).json({ error: "enabled must be a boolean" });
			await setSetting("agent_actions_enabled", { enabled });
			await auditLog(
				"admin",
				"agent_actions_kill_switch",
				enabled ? "Agent actions RESUMED" : "Agent actions KILLED",
			);
			return res.status(200).json({ enabled });
		}

		// ── Spam sensitivity ─────────────────────────────────────────
		// Backed by getSpamConfig/normalizeSpamConfig in _moderation.js, which
		// /api/posts uses at submission time. Validation is centralized there.
		if (action === "get_spam_config") {
			return res.status(200).json(await getSpamConfig(supabase));
		}

		if (action === "set_spam_config") {
			const cfg = normalizeSpamConfig(b.config);
			await setSetting("spam_config", cfg);
			await auditLog("admin", "spam_config", JSON.stringify(cfg));
			return res.status(200).json(cfg);
		}

		// ── User-deleted retention (hours until hard auto-purge) ──────
		// Real setting, not a label: purgeExpired (_posts.js) and runCleanup
		// (_cleanup.js) read this key with a 5h default. 1h minimum prevents
		// accidental instant purges; 168h (7d) maximum keeps the table bounded.
		if (action === "get_retention_config") {
			const v = await getSetting("retention_config");
			const hours = normalizeRetentionHours(v?.user_delete_hours);
			const autoDelete = v?.auto_delete_enabled !== false;
			const classes = {};
			for (const k of ["comments","reactions","chat_messages","activity_logs","agent_conversations","archived_polls","agent_history"]) classes[k] = v?.classes?.[k] !== false;
			return res.status(200).json({ user_delete_hours: hours ?? 5, auto_delete_enabled: autoDelete, classes });
		}

		if (action === "set_retention_config") {
			const hours = normalizeRetentionHours(b.user_delete_hours);
			if (hours === null) {
				return res.status(400).json({ error: "Retention must be 1–168 hours." });
			}
			if (b.auto_delete_enabled !== undefined && typeof b.auto_delete_enabled !== "boolean") {
				return res.status(400).json({ error: "auto_delete_enabled must be true or false." });
			}
			const autoDelete = b.auto_delete_enabled !== undefined ? b.auto_delete_enabled : true;
			let classes;
			if (b.classes !== undefined) {
				if (!b.classes || typeof b.classes !== "object" || Array.isArray(b.classes)) {
					return res.status(400).json({ error: "classes must be an object of class-name to boolean." });
				}
				classes = {};
				for (const k of ["comments","reactions","chat_messages","activity_logs","agent_conversations","archived_polls","agent_history"]) {
					if (b.classes[k] === undefined) continue;
					if (typeof b.classes[k] !== "boolean") {
						return res.status(400).json({ error: `classes.${k} must be true or false.` });
					}
					classes[k] = b.classes[k];
				}
				// Merge over stored classes so one toggle never wipes the rest.
				const prev = await getSetting("retention_config");
				const prevClasses = prev?.classes && typeof prev.classes === "object" ? prev.classes : {};
				classes = { ...prevClasses, ...classes };
			}
			const prevFull = await getSetting("retention_config");
			const prevFullClasses = prevFull?.classes && typeof prevFull.classes === "object" ? prevFull.classes : {};
			const merged = classes === undefined ? prevFullClasses : { ...prevFullClasses, ...classes };
			// Normalized full map (same shape get returns): absent key = on.
			const storedClasses = {};
			for (const k of ["comments","reactions","chat_messages","activity_logs","agent_conversations","archived_polls","agent_history"]) storedClasses[k] = merged[k] !== false;
			await setSetting("retention_config", { user_delete_hours: hours, auto_delete_enabled: autoDelete, classes: storedClasses });
			await auditLog("admin", "retention_config", `user_delete_hours=${hours} auto_delete=${autoDelete}`);
			return res.status(200).json({ user_delete_hours: hours, auto_delete_enabled: autoDelete, classes: storedClasses });
		}

		// ── Feed page size (posts loaded per feed fetch) ────
		// Default 30 = today's behavior when unset. 5–100 keeps payloads fast
		// on school networks while capping DB read size. /api/posts applies
		// this when the client sends no explicit limit. Change is audited.
		function normalizeFeedPageSize(v) {
			if (v === undefined || v === null || v === "") return null;
			const n = typeof v === "string" ? Number(v) : v;
			if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
			if (n < 5 || n > 100) return null;
			return n;
		}
		if (action === "get_feed_config") {
			const v = await getSetting("feed_config");
			const size = normalizeFeedPageSize(v?.page_size) ?? 30;
			return res.status(200).json({ page_size: size });
		}

		if (action === "set_feed_config") {
			const size = normalizeFeedPageSize(b.page_size);
			if (size === null) {
			return res.status(400).json({ error: "page_size must be 5–100." });
			}
			await setSetting("feed_config", { page_size: size });
			await auditLog("admin", "feed_config", `page_size=${size}`);
			return res.status(200).json({ page_size: size });
		}

		// ── Slang leaders (top slang-using authors + their strikes) ────
		// Bounded on-demand scan: recent posts + comments aggregated by author.
		// No new tables; counts come from the same scanSlang finder the gates
		// use, so the page can never drift from enforcement. Admin-only.
		if (action === "slang_leaders") {
			const LIM = 400;
			const [{ data: posts }, { data: comments }] = await Promise.all([
				supabase.from("posts").select("author_id,title,description").order("created_at", { ascending: false }).limit(LIM),
				supabase.from("comments").select("author_id,body").order("created_at", { ascending: false }).limit(LIM),
			]);
			const byAuthor = {};
			const addHits = (author, text, kind) => {
				if (!author || author === "ADMIN") return;
				const terms = scanSlang(String(text || "")).map((h) => h.term);
				if (!terms.length) return;
				const e = (byAuthor[author] = byAuthor[author] || { anon_id: author, hits: 0, terms: [], items: 0 });
				e.hits += terms.length;
				e.items += 1;
				for (const t of terms) if (!e.terms.includes(t)) e.terms.push(t);
			};
			for (const p of posts || []) addHits(p.author_id, `${p.title || ""} ${p.description || ""}`, "post");
			for (const c of comments || []) addHits(c.author_id, c.body, "comment");
			const leaders = Object.values(byAuthor)
				.sort((a, b) => b.hits - a.hits || b.items - a.items)
				.slice(0, 50);
			// Attach live strike/suspension state for the listed authors only.
			if (leaders.length) {
				const { data: metas } = await supabase
				.from("users_meta")
				.select("anon_id,strikes,suspended_until,banned")
				.in("anon_id", leaders.map((l) => l.anon_id));
				const metaById = {};
				for (const m of metas || []) metaById[m.anon_id] = m;
				for (const l of leaders) {
					const m = metaById[l.anon_id] || {};
					l.strikes = m.strikes || 0;
					l.suspended = !!(m.suspended_until && new Date(m.suspended_until) > new Date());
					l.banned = !!m.banned;
				}
			}
			return res.status(200).json({
				leaders,
				scanned: { posts: (posts || []).length, comments: (comments || []).length },
				strike_terms_threshold: 4,
			});
		}
				// ── Cleanup/purge run stats (measured, never estimated) ────
		// Reads the persisted run state the sweeps write: last run time,
		// duration, rows removed. The settings UI renders exactly this.
		if (action === "get_cleanup_stats") {
			const cleanup = await getSetting("cleanup_state");
			const purge = await getSetting("purge_state");
			return res.status(200).json({ cleanup: cleanup ?? null, purge: purge ?? null });
		}

		if (action === "change_password") {
			// In env-secret mode the DB hash is not consulted at login, so
			// "changing the password" would silently change nothing the admin
			// could use. Refuse instead of pretending (no fake success).
			if (envSecretHash()) {
				return res.status(400).json({
					error: "Password login is disabled — this deployment signs in with the ADMIN_SESSION_SECRET environment variable. Rotate it there.",
				});
			}
			const newHash = clean(b.new_hash, 128);
			if (!newHash || newHash.length < 32)
				return res.status(400).json({ error: "Invalid hash" });
			await setSetting("admin_password", { hash: newHash });
			// Invalidate ALL existing sessions: a password change implies the old
			// credential may be compromised, so outstanding tokens (valid up to
			// SESSION_MS) must not survive it. Callers re-login immediately.
			await setSetting("admin_sessions", { tokens: [] });
			invalidateAdminTokenCache();
			await auditLog("admin", "change_password", "Admin password updated");
			return res.status(200).json({ ok: true });
		}

		if (action === "logs") {
			const { cursor, limit: limitParam, paginate } = req.query;
			const isPaginated = paginate === "1" || paginate === "true";
			const PAGE_LIMIT = Math.max(1, Math.min(parseInt(limitParam) || 30, 100));

			let q = supabase
				.from("activity_logs")
				.select("*")
				.order("created_at", { ascending: false });
			if (isPaginated) {
				if (cursor) q = q.lt("created_at", cursor);
				q = q.limit(PAGE_LIMIT + 1);
			} else {
				q = q.limit(300);
			}
			const { data, error } = await q;
			if (error) throw error;

			if (isPaginated) {
				const rows = data || [];
				const hasMore = rows.length > PAGE_LIMIT;
				const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
				const nextCursor = hasMore
					? sliced[sliced.length - 1]?.created_at
					: null;
				const { count } = await supabase
					.from("activity_logs")
					.select("id", { count: "exact", head: true });
				return res
					.status(200)
					.json({ data: sliced, nextCursor, total: count || 0 });
			}

			return res.status(200).json(data || []);
		}

		if (action === "log") {
			await auditLog("admin", clean(b.log_action, 60), b.detail);
			return res.status(200).json({ ok: true });
		}

		// ---------- USER MANAGEMENT ----------
	if (action === "users") {
		const { cursor, limit: limitParam, paginate, search } = b;
		const isPaginated = !!paginate;
		const PAGE_LIMIT = Math.max(1, Math.min(parseInt(limitParam) || 30, 100));

		let q = supabase
			.from("users_meta")
			.select("*")
			.order("created_at", { ascending: false });
		// Server-side search: filter by anon_id if search query provided
		if (search && typeof search === "string" && search.trim()) {
			q = q.ilike("anon_id", `%${search.trim()}%`);
		}
		if (isPaginated && cursor) q = q.lt("created_at", cursor);
			if (isPaginated) q = q.limit(PAGE_LIMIT + 1);
			else q = q.limit(500);
			const { data: users, error } = await q;
			if (error) throw error;

			const rows = users || [];

			if (isPaginated) {
				const hasMore = rows.length > PAGE_LIMIT;
				const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
				const nextCursor = hasMore
					? sliced[sliced.length - 1]?.created_at
					: null;
				const anonIds = sliced.map((u) => u.anon_id);
				// `.in()` with an empty array is an invalid PostgREST filter — skip
				// the count queries entirely on an empty page instead of erroring.
				const counts =
					anonIds.length > 0
						? await Promise.all([
								// Counts must reflect REAL content: soft-deleted posts and
								// deleted/hidden comments are invisible to users, so they
								// must not inflate admin stats either.
								supabase
									.from("posts")
									.select("author_id")
									.eq("deleted", false)
									.in("author_id", anonIds),
								supabase
									.from("comments")
									.select("author_id")
									.eq("deleted", false)
									.eq("hidden", false)
									.in("author_id", anonIds),
								supabase
									.from("reactions")
									.select("author_id")
									.in("author_id", anonIds),
							])
						: [{ data: [] }, { data: [] }, { data: [] }];
				const [{ data: posts }, { data: comments }, { data: reactions }] =
					counts;
				const count = (rows2, id) =>
					(rows2 || []).filter((r) => r.author_id === id).length;
				const { count: total } = await supabase
					.from("users_meta")
					.select("anon_id", { count: "exact", head: true });
				return res.status(200).json({
					data: sliced.map((u) => ({
						...u,
						post_count: count(posts, u.anon_id),
						comment_count: count(comments, u.anon_id),
						reaction_count: count(reactions, u.anon_id),
					})),
					nextCursor,
					total: total || 0,
				});
			}

			// Non-paginated: fetch user counts per-user without loading all reactions/comments into memory
			// The 500-row cap is a display cap, not a total: without the exact
			// count the dashboard presented "500" as "seen by platform" while
			// ~1446 accounts existed. A head-count here returns count=null
			// (verified live), so select one real row to get the true count.
			const { count: usersTotal } = await supabase
				.from("users_meta")
				.select("anon_id", { count: "exact" })
				.limit(1);
			const anonIds = (rows || []).map((u) => u.anon_id);
			// Same visibility semantics as the paginated path: only real content.
			const TABLE_FILTERS = {
				posts: (q) => q.eq("deleted", false),
				comments: (q) => q.eq("deleted", false).eq("hidden", false),
				reactions: (q) => q,
			};
			const countForUser = async (table, ids) => {
				if (!ids.length) return {};
				let query = supabase.from(table).select("author_id").in("author_id", ids);
				query = TABLE_FILTERS[table]?.(query) ?? query;
				const { data } = await query;
				const map = {};
				(data || []).forEach((r) => {
					map[r.author_id] = (map[r.author_id] || 0) + 1;
				});
				return map;
			};
			const [postCounts, commentCounts, reactionCounts] = await Promise.all([
				countForUser("posts", anonIds),
				countForUser("comments", anonIds),
				countForUser("reactions", anonIds),
			]);
			return res.status(200).json(
				(rows || []).map((u) => ({
					...u,
					post_count: postCounts[u.anon_id] || 0,
					comment_count: commentCounts[u.anon_id] || 0,
					reaction_count: reactionCounts[u.anon_id] || 0,
					// Surface the real population size so the dashboard can say
					// "1446 accounts" instead of presenting the 500-row cap as a
					// total. null when the count failed — never fabricate.
					...(typeof usersTotal === "number" ? { total: usersTotal } : {}),
				})),
			);
		}

		if (action === "user_detail") {
			const id = clean(b.anon_id, 40).toLowerCase();
			const [
				{ data: meta },
				{ data: posts },
				{ data: comments },
				{ data: reactions },
				{ data: reports },
			] = await Promise.all([
				supabase.from("users_meta").select("*").eq("anon_id", id).maybeSingle(),
				supabase
					.from("posts")
					.select("*")
					.eq("author_id", id)
					.order("created_at", { ascending: false }),
				supabase
					.from("comments")
					.select("*")
					.eq("author_id", id)
					.order("created_at", { ascending: false }),
				supabase.from("reactions").select("*").eq("author_id", id),
				supabase.from("reports").select("*").eq("author_id", id),
			]);
			return res
				.status(200)
				.json({
					meta,
					posts: posts || [],
					comments: comments || [],
					reactions: reactions || [],
					reports: reports || [],
				});
		}

		if (action === "update_user") {
			const id = clean(b.anon_id, 40).toLowerCase();
			const { data: existing } = await supabase
				.from("users_meta")
				.select("anon_id,warnings,strikes,suspended_until,banned")
				.eq("anon_id", id)
				.maybeSingle();
			if (!existing)
				await supabase.from("users_meta").insert({ anon_id: id, warnings: [] });
			const patch = {};
			if (b.warn) {
				patch.warnings = [
					...(existing?.warnings || []),
					{ text: clean(b.warn, 300), at: new Date().toISOString() },
				];
				patch.strikes = (existing?.strikes || 0) + 1;
			}
			if (b.suspend_days !== undefined) {
				patch.suspended_until =
					b.suspend_days === 0
						? null
						: new Date(Date.now() + b.suspend_days * 86400000).toISOString();
			}
			if (typeof b.banned === "boolean") patch.banned = b.banned;
			if (b.notes !== undefined) patch.notes = clean(b.notes, 2000);
			if (typeof b.spam_score === "number") patch.spam_score = b.spam_score;
			if (typeof b.strikes === "number") patch.strikes = b.strikes;
			// An empty PATCH body is rejected by PostgREST (400) — a no-op admin
			// request must return the current row instead of surfacing a 500.
			if (!Object.keys(patch).length) {
				const { data: current } = await supabase
					.from("users_meta")
					.select("*")
					.eq("anon_id", id)
					.maybeSingle();
				return res.status(200).json(current || { anon_id: id });
			}
			const { data, error } = await supabase
				.from("users_meta")
				.update(patch)
				.eq("anon_id", id)
				.select()
				.single();
			if (error) throw error;
			await auditLog(
				"admin",
				"update_user",
				`${id}: ${Object.keys(patch).join(", ")}`,
			);
			// ── Notify the affected user — the warning popup must reach their app ──
			// Only fire when the state actually changed (no-op actions don't spam the user).
			if (b.warn)
				await notifyUser(
					id,
					"warning",
					"Official warning issued",
					clean(b.warn, 300),
				);
			if (b.suspend_days !== undefined && b.suspend_days > 0)
				await notifyUser(
					id,
					"suspension",
					"Account temporarily suspended",
					`Your anonymous ID is suspended for ${b.suspend_days} day(s).`,
				);
			if (b.suspend_days === 0 && existing?.suspended_until)
				await notifyUser(
					id,
					"suspension_lifted",
					"Suspension lifted",
					"Your account is active again.",
				);
			if (b.banned === true && !existing?.banned)
				await notifyUser(
					id,
					"ban",
					"Account permanently banned",
					"This anonymous ID has been permanently banned from posting.",
				);
			if (b.banned === false && existing?.banned)
				await notifyUser(
					id,
					"unban",
					"Ban lifted",
					"Your anonymous ID is active again.",
				);
			return res.status(200).json(data);
		}

		return res.status(400).json({ error: "Unknown action" });
	} catch (err) {
		return sanitizeError(res, err, "admin");
	}
}
