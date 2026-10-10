// Shared helpers for Voice Flow API routes (underscore prefix = not exposed as a route)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import supabase from "./_db-client.js";
import { recordPendingDelivery } from "./_notification-delivery.js";
import { PROFANITY, SLANG } from "./_wordlists.js";

// ─── isAdmin() cache: avoid DB query on every request ─────────────
const _adminTokenCache = new Map(); // token → { valid: boolean, expiresAt: number }
const ADMIN_CACHE_TTL_MS = 30_000; // 30 seconds
// Hard cap: every probed token creates an entry, so an attacker spamming
// random tokens must not grow the map without bound on a warm instance.
const ADMIN_CACHE_MAX_ENTRIES = 1000;

function cacheAdminToken(token, valid, now) {
	if (_adminTokenCache.size >= ADMIN_CACHE_MAX_ENTRIES) {
		// Drop expired entries first to reclaim space.
		for (const [k, v] of _adminTokenCache) {
			if (v.expiresAt <= now) _adminTokenCache.delete(k);
		}
		// If still full (no expired entries), evict oldest insertions
		// until there is room. Map preserves insertion order, so the
		// first key is always the oldest.
		while (_adminTokenCache.size >= ADMIN_CACHE_MAX_ENTRIES) {
			const oldest = _adminTokenCache.keys().next();
			if (oldest.done) break;
			_adminTokenCache.delete(oldest.value);
		}
	}
	_adminTokenCache.set(token, { valid, expiresAt: now + ADMIN_CACHE_TTL_MS });
}

/** Drop every cached admin-token verdict (password change / mass logout). */
export function invalidateAdminTokenCache() {
	_adminTokenCache.clear();
}

// ─── Rate limit state: persists across warm invocations ───────────
// Maps key → { count: number, windowStart: number }
const _rateLimitState = new Map();

// Allowed origins for CORS — production domain + Vercel preview + localhost dev
// plus native shells: Electron loads over file:// (Origin "null"/absent),
// legacy Capacitor schemes (capacitor://localhost / ionic://localhost), and
// modern Capacitor (v7 default: androidScheme=https, hostname=localhost, so
// the APK fetches with Origin: https://localhost — verified in
// node_modules/@capacitor/android CapConfig.java). Without these the
// desktop/mobile apps boot but every API call dies as "Failed to fetch".
const ALLOWED_ORIGINS = [
	"https://voice-box.vercel.app",
	"https://voice-box-psi.vercel.app",
	"https://voice-box-ballyvisiontutorial-hues-projects.vercel.app",
	"http://localhost:5173",
	"http://localhost:4173",
	"http://localhost:3000",
	"https://localhost",
	"http://localhost",
	"capacitor://localhost",
	"ionic://localhost",
];

// Origins that carry no meaningful host but are the app itself (Electron
// file:// sends `Origin: null` or no Origin at all). Echoed back so the
// browser/Electron CORS check passes with credentials.
function isNativeOrigin(origin) {
	if (!origin) return true; // no Origin header: curl, Electron file:// GET, same-origin
	if (origin === "null") return true; // Electron file:// fetch
	if (origin === "file://") return true;
	return false;
}

export function cors(res, req) {
	const origin = req?.headers?.origin || "";
	if (origin && (ALLOWED_ORIGINS.includes(origin) || isNativeOrigin(origin))) {
		res.setHeader("Access-Control-Allow-Origin", origin === "null" ? "null" : origin || "null");
	} else if (!origin) {
		// file:// / curl with no Origin: answer with null so credentialed
		// cross-origin fetches from the desktop shell still pass the check.
		res.setHeader("Access-Control-Allow-Origin", "null");
	}
	res.setHeader(
		"Access-Control-Allow-Methods",
		"GET, POST, PUT, DELETE, OPTIONS",
	);
	res.setHeader(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, X-Admin-Token, x-anon-id, x-request-id, x-vercel-cron-secret, x-cron-secret",
	);
	res.setHeader("Access-Control-Allow-Credentials", "true");
	res.setHeader("Vary", "Origin");
	// FIX-#4: Cache preflight responses for 24h to reduce OPTIONS roundtrips
	res.setHeader("Access-Control-Max-Age", "86400");
	// FIX: header values must not contain CR/LF or other control characters —
	// Node's setHeader throws ERR_INVALID_CHAR on them, turning a crafted
	// x-request-id into a 500 on every route. Sanitize before echoing back.
	const rawRequestId = req?.headers?.["x-request-id"];
	const requestId =
		(typeof rawRequestId === "string" &&
			rawRequestId.replace(/[^\x20-\x7E]/g, "").slice(0, 64)) ||
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	res.setHeader("X-Request-Id", requestId);
}

/** Verify admin session token from x-admin-token header (uses 30s cache to avoid DB on every request) */
export async function isAdmin(req) {
	const token = req.headers["x-admin-token"];
	if (!token) return false;
	const now = Date.now();
	const cached = _adminTokenCache.get(token);
	if (cached && cached.expiresAt > now) return cached.valid;
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", "admin_sessions")
		.maybeSingle();
	const tokens = data?.value?.tokens || [];
	const valid = tokens.some((s) => s.t === token && s.exp > now);
	cacheAdminToken(token, valid, now);
	return valid;
}

/**
 * Authorize a SCHEDULED/CRON invocation.
 *
 * Shared so every cron route enforces the SAME rule instead of some
 * copying it and some (incident-cron) forgetting entirely. Accepts, in
 * order: a constant-time-verified `CRON_SECRET` (Vercel sends it as
 * `Authorization: Bearer <CRON_SECRET>`; x-vercel-cron-secret and
 * x-cron-secret are also accepted for other schedulers), then a real
 * admin session.
 *
 * Header PRESENCE is never authentication — the value is compared
 * constant-time against the server-side secret.
 */
export async function isCronAuthorized(req) {
	let authorized = false;
	const authHeader = String(req?.headers?.["authorization"] || "");
	const bearerToken = authHeader.startsWith("Bearer ")
		? authHeader.slice(7)
		: null;
	const presented =
		req?.headers?.["x-vercel-cron-secret"] ||
		req?.headers?.["x-cron-secret"] ||
		bearerToken;
	const expected = process.env.CRON_SECRET;
	if (presented && expected) {
		const a = Buffer.from(String(presented));
		const b = Buffer.from(String(expected));
		authorized = a.length === b.length && timingSafeEqual(a, b);
	}
	if (!authorized) authorized = await isAdmin(req);
	return authorized;
}

/** Standard 401 body for a cron route that failed {@link isCronAuthorized}. */
export const CRON_UNAUTHORIZED_BODY = {
	error:
		"Unauthorized - requires valid Authorization: Bearer CRON_SECRET, x-vercel-cron-secret, or x-admin-token",
};

/** Check whether an anonymous user is allowed to write (not banned / suspended) */
export async function checkUser(authorId) {
	if (!authorId || typeof authorId !== "string" || authorId.length > 40) {
		return { ok: false, error: "Missing or invalid anonymous ID." };
	}
	// Case-insensitive: IDs are stored lowercase; normalize incoming values
	const id = authorId.toLowerCase();
	const { data } = await supabase
		.from("users_meta")
		.select("*")
		.eq("anon_id", id)
		.maybeSingle();
	if (data?.banned)
		return {
			ok: false,
			error: "This anonymous ID has been permanently banned.",
		};
	if (data?.suspended_until && new Date(data.suspended_until) > new Date()) {
		return {
			ok: false,
			error: `This anonymous ID is suspended until ${new Date(data.suspended_until).toLocaleDateString()}.`,
		};
	}
	return { ok: true, meta: data };
}

/** Ensure a users_meta row exists for an anonymous id */
export async function ensureUser(authorId) {
	try {
		const id = String(authorId).toLowerCase();
		const { data } = await supabase
			.from("users_meta")
			.select("anon_id")
			.eq("anon_id", id)
			.maybeSingle();
		if (!data)
			await supabase
				.from("users_meta")
				.insert({
					anon_id: id,
					warnings: [],
					last_seen: new Date().toISOString(),
				});
	} catch {
		/* non-fatal */
	}
}

/** Push an in-app notification to a user (same store the _notifications.js API reads).
 *  Used by the report auto-strike path, admin user actions, and pre-publish review
 *  so warnings/ban/strike popups reach the user immediately, not on the next
 *  heartbeat. Single canonical copy — do not re-implement per-file.
 *  Returns true on success, false when the notification could not be stored. */
export let notifyFailedCount = 0;
export async function notifyUser(anonId, type, title, body) {
	if (!anonId || anonId === "anonymous" || anonId === "ADMIN") return true;
	const key = `notifications:${anonId}`;
	const entry = {
		id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
		type,
		title,
		body,
		read: false,
		created_at: new Date().toISOString(),
	};
	async function storeOnce() {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", key)
			.maybeSingle();
		const notifications = data?.value?.notifications || [];
		notifications.unshift(entry);
		await supabase
			.from("settings")
			.upsert(
				{
					key,
					value: {
						notifications: notifications.slice(0, 100),
						updated_at: new Date().toISOString(),
					},
				},
				{ onConflict: "key" },
			);
	}
	try {
		await storeOnce();
		return true;
	} catch (e) {
		notifyFailedCount += 1;
		console.error("[auth] notifyUser failed", { anonId, type, error: e?.message || String(e) });
		// One immediate retry of the FULL read+append flow for transient blips.
		// Never blind-overwrite with a single-item array — that would drop history.
		try {
			await storeOnce();
			return true;
		} catch (e2) {
			console.error("[auth] notifyUser retry failed", { anonId, type, error: e2?.message || String(e2) });
			// Both immediate attempts failed. Hand the delivery to the bounded,
			// independently-verified retry ledger instead of dropping it. Best
			// effort: if the DB is fully down this write fails too, which is
			// honest — nothing is recorded that did not actually happen.
			await recordPendingDelivery(anonId, entry, "notifyUser_write_failed").catch(
				() => {},
			);
			return false;
		}
	}
}

/** Append to the audit / activity log. Returns true on success. */
export let auditFailedCount = 0;
export async function auditLog(actor, action, detail) {
	try {
		// PostgREST reports a rejected insert through the returned `{ error }`
		// — it never throws. Ignoring it meant this function returned `true`
		// for rows that never landed, so callers believed the audit succeeded
		// and `auditFailedCount` could never move.
		const { error } = await supabase
			.from("activity_logs")
			.insert({ actor, action, detail: String(detail || "").slice(0, 500) });
		if (error) {
			auditFailedCount += 1;
			console.error("[auth] auditLog failed", {
				actor,
				action,
				error: error.message || String(error),
			});
			return false;
		}
		return true;
	} catch (err) {
		auditFailedCount += 1;
		console.error("[auth] auditLog failed", { actor, action, error: err?.message || String(err) });
		return false;
	}
}

/** Basic server-side text sanitation: strip control chars + trim + cap length */
export function clean(str, max = 2000) {
	if (typeof str !== "string") return "";
	return str
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
		.trim()
		.slice(0, max);
}

// Re-exported so existing importers keep working; canonical home is _wordlists.js.
export { PROFANITY, SLANG };

const SLURS = [
	"nigger",
	"nigga",
	"niggas",
	"niggers",
	"faggot",
	"faggots",
	"fag",
	"fags",
	"kike",
	"kikes",
	"spic",
	"spics",
	"chink",
	"chinks",
	"wetback",
	"wetbacks",
	"beaner",
	"beaners",
	"tranny",
	"trannies",
	"dyke",
	"dykes",
	"paki",
	"pakis",
	"nazi",
	"nazis",
	"coon",
	"coons",
	"gook",
	"gooks",
	"towelhead",
	"raghead",
];

const DANGEROUS = [
	{
		pattern:
			/kill\s+(?:my\s+)?self|suicide|suicidal|end\s+(?:my\s+)?life|want\s+to\s+die|going\s+to\s+kill|overdose/i,
		severity: "critical",
	},
	{
		pattern:
			/kill\s+you|gonna\s+kill|going\s+to\s+kill|murder\s+you|shoot\s+you|stab\s+you|beat\s+you\s+up|burn\s+(?:the\s+)?school|bomb\s+(?:the\s+)?school/i,
		severity: "critical",
	},
	{
		pattern:
			/bring(?:ing)?\s+(?:a\s+)?(?:gun|knife|weapon|blade|bomb|explosive)/i,
		severity: "high",
	},
	{
		pattern:
			/buying|selling|trafficking|deal(?:ing)?\s+(?:in\s+)?(?:drugs|cocaine|heroin|meth|weed|marijuana|lsd|ecstasy|xanax|fentanyl)/i,
		severity: "high",
	},
	{
		pattern:
			/blackmail|extort|extortion|pay\s+(?:me|us)\s+or|i(?:'ll| will)\s+(?:post|share|send|upload|expose)\s+(?:your|the)\s+(?:photos?|pics?|pictures?|videos?|nudes?|secrets?)/i,
		severity: "critical",
	},
	{
		pattern:
			/if\s+you\s+(?:don(?:'t|t)?|do\s+not)\s+(?:pay|give|send|do)\s+\w+.*?(?:i(?:'ll| will)|gonna|going\s+to)\s+(?:expose|share|post|leak|send)/i,
		severity: "critical",
	},
	{
		pattern:
			/dox(?:ing|ed)?|doxx(?:ing|ed)?|releasing?\s+(?:your|their|the)\s+(?:address|phone|real\s+name|info)/i,
		severity: "high",
	},
];

const SPAM_PATTERNS = [
	{
		pattern:
			/buy\s+now|click\s+here|free\s+money|easy\s+cash|earn\s+\$|make\s+\$\d|limited\s+time\s+offer|act\s+now|congratulations\s+you(?:'ve| have)\s+won/i,
		severity: "medium",
	},
	{ pattern: /(.)\1{5,}/, severity: "low" },
];

// FIX-#5: Reusable 429 response with Retry-After header
export function rateLimitResponse(
	res,
	retryAfterSeconds = 60,
	message = "Too many requests",
) {
	res.setHeader("Retry-After", String(retryAfterSeconds));
	return res
		.status(429)
		.json({ error: message, retry_after: retryAfterSeconds });
}

/** Check content for moderation issues. Returns { safe, flags, maskedText } */
export function moderateContent(text) {
	const flags = [];
	let masked = text;

	// Profanity
	for (const w of PROFANITY) {
		const regex = new RegExp(`\\b${w}\\b`, "gi");
		if (regex.test(text)) {
			flags.push({ category: "profanity", word: w, severity: "high" });
			masked = masked.replace(regex, (m) => m[0] + "*".repeat(m.length - 1));
		}
	}

	// Slurs
	for (const w of SLURS) {
		const regex = new RegExp(`\\b${w}\\b`, "gi");
		if (regex.test(masked)) {
			flags.push({ category: "hate_speech", word: w, severity: "critical" });
			masked = masked.replace(regex, (m) => m[0] + "*".repeat(m.length - 1));
		}
	}

	// Slang/insult abuse — still masked by maskProfanity wherever masking
	// applies (private surfaces, legacy rows, LLM redaction). Public
	// write surfaces block it outright via serverModerate instead.
	for (const w of SLANG) {
		const regex = new RegExp(`\\b${w}\\b`, "gi");
		if (regex.test(masked)) {
			flags.push({ category: "slang", word: w, severity: "medium" });
			masked = masked.replace(regex, (m) => m[0] + "*".repeat(m.length - 1));
		}
	}

	// Leet/obfuscation evasion (sh1t, b!tch, a$$, 5lut…) — normalize each token's
	// common substitutions, then re-test the profanity + slur lists token by
	// token. A hit means deliberate evasion, so it masks at the same severity
	// as the base word — and only the offending token is masked.
	const leetNorm = (tok) =>
		tok
			.toLowerCase()
			.replace(/1/g, "i")
			.replace(/3/g, "e")
			.replace(/4/g, "a")
			.replace(/5/g, "s")
			.replace(/0/g, "o")
			.replace(/\$/g, "s")
			.replace(/@/g, "a")
			.replace(/!/g, "i")
			.replace(/\+/g, "t")
			.replace(/7/g, "t");
	const profSet = new Set(PROFANITY.map((w) => w.toLowerCase()));
	const slurSet = new Set(SLURS.map((w) => w.toLowerCase()));
	masked = masked
		.split(/(\s+)/)
		.map((tok) => {
			if (/^\s+$/.test(tok)) return tok;
			const norm = leetNorm(tok.replace(/^[^a-z0-9$@!+]+|[^a-z0-9$@!+]+$/gi, ""));
			if (!norm || norm === tok.toLowerCase()) return tok;
			if (slurSet.has(norm)) {
				flags.push({ category: "hate_speech", word: `${norm} (obfuscated)`, severity: "critical" });
				return tok[0] + "*".repeat(Math.max(tok.length - 1, 1));
			}
			if (profSet.has(norm)) {
				flags.push({ category: "profanity", word: `${norm} (obfuscated)`, severity: "high" });
				return tok[0] + "*".repeat(Math.max(tok.length - 1, 1));
			}
			return tok;
		})
		.join("");

	// Dangerous content (self-harm, violence, threats, weapons, drugs, blackmail, doxxing)
	for (const { pattern, severity } of DANGEROUS) {
		if (pattern.test(masked)) {
			flags.push({ category: "dangerous", word: "[pattern]", severity });
		}
	}

	// Spam patterns
	for (const { pattern, severity } of SPAM_PATTERNS) {
		if (pattern.test(masked)) {
			flags.push({ category: "spam", word: "[pattern]", severity });
		}
	}

	// Repeated words (e.g. "bad bad bad bad")
	const words = masked.toLowerCase().split(/\s+/);
	let repeatCount = 1;
	for (let i = 1; i <= words.length; i++) {
		if (i < words.length && words[i] === words[i - 1] && words[i].length > 2) {
			repeatCount++;
		} else {
			if (repeatCount >= 4) {
				flags.push({
					category: "spam",
					word: words[i - 1],
					severity: "medium",
				});
			}
			repeatCount = 1;
		}
	}

	// PII (email / phone)
	if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/.test(masked)) {
		flags.push({ category: "privacy", word: "[email]", severity: "medium" });
	}

	return {
		safe: !flags.some(
			(f) => f.severity === "critical" || f.severity === "high",
		),
		flags,
		maskedText: masked,
	};
}

/** Backward-compatible: mask profanity only */
export function maskProfanity(text) {
	return moderateContent(text).maskedText;
}

/** Persistent rate limit: max `limit` writes by author in table within `seconds` (survives warm invocations) */
export async function rateLimited(table, authorId, seconds, limit) {
	const key = `${table}:${authorId}`;
	const now = Date.now();
	const windowMs = seconds * 1000;
	const state = _rateLimitState.get(key);
	if (state && now - state.windowStart < windowMs) {
		if (state.count >= limit) return true;
		state.count++;
		return false;
	}
	// New window — do a real DB count and seed the in-memory counter
	const since = new Date(now - windowMs).toISOString();
	const { count } = await supabase
		.from(table)
		.select("*", { count: "exact", head: true })
		.eq("author_id", authorId)
		.gte("created_at", since);
	const currentCount = count || 0;
	_rateLimitState.set(key, { count: currentCount + 1, windowStart: now });
	// Prune stale entries periodically (max 5000 keys)
	if (_rateLimitState.size > 5000) {
		for (const [k, v] of _rateLimitState) {
			if (now - v.windowStart > windowMs) _rateLimitState.delete(k);
		}
	}
	return currentCount >= limit;
}

// ─── Session-based caller verification ──────────────────────────
// AUDIT FIX #1: DB-backed HttpOnly cookie session.
//
// The x-anon-id header is the claimed-id SOURCE, never proof of
// possession — anyone can read someone's id off a shared screen. Proof
// is the vb_session cookie: a 32-byte random token whose sha256 hash is
// stored server-side (settings KV `session:<id>`), so the token itself
// never touches the database.
//
// Returns { ok: true, callerId } or { ok: false, status, error }.
const SESSION_COOKIE = "vb_session";
// Anonymous sessions NEVER expire server-side (continuity demand
// 2026-10-10: an "ID expired" death orphans every vote, comment and
// reaction the student made, and version updates correlate with long
// absences, so expiry always struck on return). Theft protection rests
// SOLELY on proof-of-possession: the 32-byte cookie token. A record row
// (live, ancient, any age) with no presented cookie is denied and left
// untouched — knowing the disclosed id alone never mints, rotates, or
// revives anything.
// Cookie Max-Age is 400 days (the most browsers honor); every valid
// presentation re-issues it, so an active device's cookie never lapses.
const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
// Ownership is proven EXCLUSIVELY by presenting the session token the server
// minted for that id — never by the id alone, which is disclosed by design
// (mentions, URLs). Consequences, all deliberate:
//   - A brand-new id (NO record row — session rows are never deleted, so this
//     means first contact) mints transparently: onboarding requires it, and
//     there is nothing to steal on an id the server has never seen (ids carry
//     ~72 bits of entropy; a victim's future id is unpredictable).
//   - An id WITH a record row — any age, records never expire — is NEVER
//     re-minted on claim. Minting over it would hand the identity to anyone
//     who can read the id AND lock the real owner out (their valid cookie
//     would then mismatch). A device that lost its cookie recovers through
//     the user's own link code (Settings → link this device), never through
//     re-minting: old content stays published under the same id.
//   - The only rotation path is presenting a PREVIOUSLY valid token
//     (record.th_prev, single slot): the losing side of a concurrent
//     first-visit mint. A random wrong cookie matches nothing and is denied.

function sha256Hex(value) {
	return createHash("sha256").update(value).digest("hex");
}

/** Timing-safe comparison of two hex/ascii digests of equal length. */
function safeStringEqual(a, b) {
	const bufA = Buffer.from(String(a));
	const bufB = Buffer.from(String(b));
	if (bufA.length !== bufB.length || bufA.length === 0) return false;
	return timingSafeEqual(bufA, bufB);
}

function readSessionCookie(cookieHeader) {
	if (!cookieHeader || typeof cookieHeader !== "string") return null;
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
		const raw = part.slice(eq + 1).trim();
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}
	return null;
}

/** Set the session cookie. Secure only when the request arrived over HTTPS.
 * Cross-site shells (Electron file:// with Origin null/absent, Capacitor in
 * any scheme) need SameSite=None + Secure or the browser never sends the
 * cookie back and every authed call 403s as session_unrecoverable after a
 * working mint. Exported for the desktop-cors regression tests. */
export function setSessionCookie(res, token, req) {
	const maxAge = SESSION_COOKIE_MAX_AGE_S;
	const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
	const origin = String(req?.headers?.origin || "");
	const crossSite =
		!origin ||
		origin === "null" ||
		origin === "file://" ||
		origin === "https://localhost" ||
		origin === "http://localhost" ||
		origin.startsWith("capacitor://") ||
		origin.startsWith("ionic://");
	// SameSite=None requires Secure, and Secure cookies are rejected over
	// plain http — so None is only used when the request actually arrived
	// over https (Vercel prod). Localhost http keeps Lax (dev only).
	const useNone = crossSite && proto === "https";
	const attrs = [
		`${SESSION_COOKIE}=${token}`,
		"HttpOnly",
		"Path=/",
		useNone ? "SameSite=None" : "SameSite=Lax",
		`Max-Age=${maxAge}`,
	];
	if (proto === "https") attrs.push("Secure");
	res.setHeader("Set-Cookie", attrs.join("; "));
}

function sessionKey(id) {
	return `session:${id}`;
}

async function loadSessionRecord(id) {
	const { data, error } = await supabase
		.from("settings")
		.select("value")
		.eq("key", sessionKey(id))
		.maybeSingle();
	if (error) throw new Error(error.message || "session lookup failed");
	return data?.value || null;
}

async function saveSessionRecord(id, record) {
	const { error } = await supabase
		.from("settings")
		.upsert({ key: sessionKey(id), value: record }, { onConflict: "key" });
	if (error) throw new Error(error.message || "session write failed");
}

/** Mint a fresh token, persist its hash, hand the cookie to the client. */
async function mintSession(res, req, id, now, prevRecord) {
	const token = randomBytes(32).toString("hex");
	// Preserve the prior hash (single slot) so the losing side of a
	// concurrent first-visit double-mint can still prove itself via th_prev.
	// created_at is inherited, never extended: the boot-race carve-out below
	// keys off FIRST creation, so concurrent mints cannot stretch the window.
	const prev = prevRecord && typeof prevRecord === "object" ? prevRecord : null;
	await saveSessionRecord(id, {
		th: sha256Hex(token),
		...(prev?.th ? { th_prev: prev.th } : {}),
		created_at: prev?.created_at || new Date(now).toISOString(),
	});
	setSessionCookie(res, token, req);
	return token;
}

export async function verifyCallerIdentity(req, res, claimedUserId, opts = {}) {
	// Admins bypass caller verification — they act on behalf of the system
	if (await isAdmin(req)) return { ok: true, callerId: claimedUserId };

	const headerId = (req.headers["x-anon-id"] || "").toString().trim().toLowerCase();
	const id = String(claimedUserId || "").trim().toLowerCase();

	// Header missing or malformed → cannot even identify the caller → deny
	if (!headerId || !validAnonId(headerId))
		return { ok: false, status: 403, error: "Invalid session identity", code: "invalid_identity" };

	// Header must match the claimed user_id (cheap pre-check; the cookie
	// below is what actually proves possession of this identity)
	if (headerId !== id)
		return { ok: false, status: 403, error: "Cannot operate on another user's data", code: "invalid_identity" };

	const now = Date.now();
	const cookieToken = readSessionCookie(req.headers?.cookie);

	let record;
	try {
		record = await loadSessionRecord(id);
	} catch (err) {
		console.error("[auth] session lookup failed:", err?.message || err);
		return { ok: false, status: 503, error: "Session service unavailable" };
	}

	// No record row at all: first contact for this id. Mint transparently —
	// onboarding requires it, and there is no prior session or data to steal
	// (ids are client-generated ~72-bit randoms; a victim's future id is
	// unpredictable). The mint re-reads first so a concurrent double-mint
	// preserves the loser's hash as th_prev instead of silently orphaning it.
	if (!record) {
		try {
			let prev = null;
			try {
				prev = await loadSessionRecord(id);
			} catch {
				prev = null;
			}
			await mintSession(res, req, id, now, prev);
			return { ok: true, callerId: id };
		} catch (err) {
			console.error("[auth] session mint failed:", err?.message || err);
			return { ok: false, status: 503, error: "Session service unavailable" };
		}
	}

	// A record EXISTS but no cookie was presented. The caller knows the
	// (disclosed) id without holding the session token, so this is denied —
	// minting or overwriting here would hand the identity to any reader of
	// the id and lock the real owner out (their valid cookie would then
	// mismatch). Records never expire, so age plays no part in this verdict.
	// Exception: a record minted seconds ago whose Set-Cookie is still in
	// flight — parallel first-load requests (heartbeat + notifications fired
	// together) otherwise 403 spuriously before the browser stores the
	// cookie. The window is 20s from FIRST mint (created_at is inherited,
	// never extended), so established records never qualify and stolen-ID
	// denial stays intact.
	if (!cookieToken) {
		const bornAt = Date.parse(record?.created_at || "") || 0;
		if (bornAt > 0 && now - bornAt <= 20_000)
			return { ok: true, callerId: id };
		return {
			ok: false,
			status: 403,
			error: "Invalid session identity",
			code: "session_unrecoverable",
		};
	}

	const presentedHash = sha256Hex(cookieToken);
	if (record?.th && safeStringEqual(presentedHash, record.th)) {
		// Valid session. Re-issue the cookie on every presentation so its
		// 400-day Max-Age slides forward while the device is active — an
		// idle return months later still holds a live cookie. No DB write:
		// there is no expiry left to extend.
		setSessionCookie(res, cookieToken, req);
		return { ok: true, callerId: id };
	}

	// Previous-token recovery — the ONLY rotation path. A presenter holding a
	// token the server itself minted earlier for this id (the losing side of
	// a concurrent first-visit double-mint) is re-issued a fresh token, and
	// th_prev advances so a replayed older token can never rotate twice. A
	// random wrong cookie matches neither hash and is denied: unlike the old
	// 60s grace window, mere knowledge of the id buys nothing here.
	if (record?.th_prev && safeStringEqual(presentedHash, record.th_prev)) {
		try {
			const token = randomBytes(32).toString("hex");
			await saveSessionRecord(id, {
				...record,
				th: sha256Hex(token),
				th_prev: record.th,
			});
			setSessionCookie(res, token, req);
			return { ok: true, callerId: id };
		} catch (err) {
			console.error("[auth] session rotate failed:", err?.message || err);
			return { ok: false, status: 503, error: "Session service unavailable" };
		}
	}

	return { ok: false, status: 403, error: "Invalid session identity", code: "session_unrecoverable" };
}

/**
 * Client IP for rate-limit keys (#11): x-real-ip when a proxy sets it,
 * otherwise the RIGHTMOST X-Forwarded-For hop (appended by the nearest
 * trusted proxy — the leftmost hops are client-controlled and spoofable),
 * otherwise the direct socket address. Never the raw header verbatim.
 */
export function clientIp(req) {
	const real = String(req?.headers?.["x-real-ip"] || "").trim();
	if (real) return real;
	const xff = String(req?.headers?.["x-forwarded-for"] || "").trim();
	if (xff) {
		const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
		if (hops.length) return hops[hops.length - 1];
	}
	return req?.socket?.remoteAddress || "unknown";
}

// Shared anon_id format validation (matches checkUser + users_meta)
function validAnonId(id) {
	return (
		typeof id === "string" &&
		id.length >= 5 &&
		id.length <= 40 &&
		/^anon_[a-z0-9]+$/.test(id)
	);
}
