// ═══════════════════════════════════════════════════════════════════
// REAL OUTBOUND CHANNEL DISPATCH — SMS (MessageBird) + Email (Resend)
// ═══════════════════════════════════════════════════════════════════
// Fires real SMS / email when a followed post is solved or updated.
//
//   SMS   → MessageBird REST API   (env: MESSAGEBIRD_API_KEY)
//   Email → Resend REST API        (env: RESEND_API_KEY)
//
// Rules:
//   - Env-gated: no API key configured → { ok:false, error:"not_configured" }.
//     The platform still delivers the in-app notification; SMS/email are
//     best-effort extras. Never throws — callers treat this fire-and-forget.
//   - Provider responses are read, not assumed. A 2xx is required for ok:true.
//   - No HTML templating / no secret logging.
// ═══════════════════════════════════════════════════════════════════

const MB_URL = "https://rest.messagebird.com/messages";
const RESEND_URL = "https://api.resend.com/emails";

// Keep phone numbers E.164-ish: optional leading +, 8–15 digits total.
// Returns the cleaned number or null when it can't possibly be a phone.
export function normalizePhone(raw) {
	if (typeof raw !== "string") return null;
	let s = raw.trim();
	if (!s) return null;
	const hasPlus = s.startsWith("+");
	const digits = s.replace(/\D/g, "");
	if (digits.length < 8 || digits.length > 15) return null;
	return (hasPlus ? "+" : "") + digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validEmail(raw) {
	return (
		typeof raw === "string" &&
		raw.length <= 120 &&
		EMAIL_RE.test(raw.trim())
	);
}

// Short human-safe helper so dispatch reads like a sentence.
function truncate(text, max) {
	const s = String(text ?? "").trim();
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── SMS ─────────────────────────────────────────────────────────────
export async function sendSms(phone, body) {
	try {
		const key = process.env.MESSAGEBIRD_API_KEY;
		if (!key) return { ok: false, provider: "messagebird", error: "not_configured" };
		const number = normalizePhone(phone);
		if (!number)
			return { ok: false, provider: "messagebird", error: "invalid_phone" };
		const text = truncate(body, 150);
		if (!text) return { ok: false, provider: "messagebird", error: "empty_body" };
		const originator = truncate(process.env.SMS_ORIGINATOR || "VoiceBox", 11) || "VoiceBox";
		const res = await fetch(MB_URL, {
			method: "POST",
			headers: {
				Authorization: `AccessKey ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				originator,
				recipients: [number],
				body: text,
			}),
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			return {
				ok: false,
				provider: "messagebird",
				error: `provider_${res.status}`,
				detail: truncate(detail, 200),
			};
		}
		return { ok: true, provider: "messagebird" };
	} catch (err) {
		return { ok: false, provider: "messagebird", error: err?.message || "error" };
	}
}

// ── Email ───────────────────────────────────────────────────────────
export async function sendEmail(to, subject, body) {
	try {
		const key = process.env.RESEND_API_KEY;
		if (!key) return { ok: false, provider: "resend", error: "not_configured" };
		if (!validEmail(to))
			return { ok: false, provider: "resend", error: "invalid_email" };
		const text = truncate(body, 4000);
		if (!text) return { ok: false, provider: "resend", error: "empty_body" };
		const from =
			process.env.EMAIL_FROM || "VoiceBox <notifications@resend.dev>";
		const res = await fetch(RESEND_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [to.trim()],
				subject: truncate(subject, 100) || "VoiceBox update",
				text,
			}),
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			return {
				ok: false,
				provider: "resend",
				error: `provider_${res.status}`,
				detail: truncate(detail, 200),
			};
		}
		return { ok: true, provider: "resend" };
	} catch (err) {
		return { ok: false, provider: "resend", error: err?.message || "error" };
	}
}
