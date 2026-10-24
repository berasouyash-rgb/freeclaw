// Image upload to Supabase Storage (anonymous, size-capped)
// FALLBACK: If Supabase Storage fails, returns a data-URL so images always work.

import { auditLog, checkUser, clean, cors, isAdmin, rateLimited, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// Primary bucket — if it doesn't exist, try alternatives
const BUCKETS = ["chat-media", "voicebox-media"];

/** Magic-byte sniffing: verify decoded bytes match the declared image type.
 *  Content-Type is client-declared, so without this any binary could be
 *  stored under an image name/content-type. */
function matchesImageMagic(buffer, contentType) {
	const b = buffer;
	if (b.length < 12) return false;
	if (/^image\/png$/.test(contentType))
		return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
	if (/^image\/jpe?g$/.test(contentType))
		return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
	if (/^image\/gif$/.test(contentType)) {
		const sig = b.subarray(0, 6).toString("latin1");
		return sig === "GIF87a" || sig === "GIF89a";
	}
	if (/^image\/webp$/.test(contentType)) {
		return (
			b.subarray(0, 4).toString("latin1") === "RIFF" &&
			b.subarray(8, 12).toString("latin1") === "WEBP"
		);
	}
	return false;
}

/** Deep inspection for executable code, webshells, script injection, and polyglots. */
function containsMaliciousPayload(buffer) {
	if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return "executable_pe";
	if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return "executable_elf";

	const str = buffer.toString("latin1");
	const lower = str.toLowerCase();

	const MALICIOUS_PATTERNS = [
		/<\?php/i,
		/<\?=/i,
		/<script\b/i,
		/javascript\s*:/i,
		/<html\b/i,
		/<svg\b/i,
		/<!doctype\s+html/i,
		/<!entity\s+/i,
		/\bonerror\s*=/i,
		/\bonload\s*=/i,
		/\bdocument\.cookie\b/i,
		/\bwindow\.location\b/i,
		/\beval\s*\(/i,
		/\bbase64_decode\s*\(/i,
		/\bsystem\s*\(/i,
		/\bshell_exec\s*\(/i,
		/\bpassthru\s*\(/i,
		/<%[\s\S]*%>/i,
		/<jsp:/i,
		/powershell(\.exe)?\b/i,
		/cmd(\.exe)?\s+\/c/i,
	];

	for (const pattern of MALICIOUS_PATTERNS) {
		if (pattern.test(lower)) {
			return pattern.source;
		}
	}
	return null;
}

/** Check image text chunks, metadata, and captions for inappropriate/NSFW content */
function checkImageAppropriateness(buffer, meta = {}) {
	// 1. Check user-supplied metadata fields (caption, filename, altText)
	const userTexts = [meta.caption, meta.altText, meta.filename, meta.title]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

	// 2. Extract printable strings from buffer (EXIF tags, PNG tEXt chunks, comments)
	const str = buffer.toString("latin1");
	const printable = str.replace(/[^\x20-\x7E]/g, " ").toLowerCase();
	const combined = `${userTexts} ${printable}`;

	const INAPPROPRIATE_PATTERNS = [
		/\b(?:porn|nsfw|xxx|nude|nudes|nudity|striptease|hentai|erotic|gore|snuff)\b/i,
		/\b(?:kill\s+your\s*self|kys|i\s+will\s+kill\s+you|hang\s+your\s*self)\b/i,
		/\b(?:i\s+will\s+not\s+leave\s+you|watch\s+your\s+back|tujhe\s+chhodunga\s+nahi|dekh\s+lunga)\b/i,
		/\b(?:nigger|faggot|chink|kike|retard)\b/i,
		/\b(?:post\s+your\s+nudes|leak\s+your\s+nudes)\b/i,
	];

	for (const pattern of INAPPROPRIATE_PATTERNS) {
		if (pattern.test(combined)) {
			return pattern.source;
		}
	}
	return null;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		const { fileBase64, contentType } = req.body || {};
		// H6: Trust session / x-anon-id over body for uploads
		const headerId = clean(req.headers["x-anon-id"] || "", 40);
		const admin = await isAdmin(req);
		const author_id = headerId || (admin ? "ADMIN" : "");
		if (!author_id) {
			return res.status(403).json({ error: "Missing session identity (x-anon-id header)" });
		}
		if (!admin) {
			const caller = await verifyCallerIdentity(req, res, author_id);
			if (!caller.ok) {
				return res.status(caller.status || 403).json({ error: caller.error, code: caller.code });
			}
		}
		const gate = await checkUser(author_id);
		if (!gate.ok) return res.status(403).json({ error: gate.error });
		if (!fileBase64) return res.status(400).json({ error: "No file" });
		if (!/^image\/(png|jpe?g|gif|webp)$/.test(contentType || "")) {
			return res
				.status(400)
				.json({ error: "Only PNG, JPG, GIF or WebP images allowed." });
		}
		const buffer = Buffer.from(fileBase64, "base64");
		if (buffer.length > 3 * 1024 * 1024)
			return res.status(400).json({ error: "Image must be under 3 MB." });
		// Per-author throttle — uploads were the ONLY unthrottled write surface.
		// Each request decodes up to ~3MB and writes to storage; spamming them
		// fills the bucket and burns function time. (6/min matches chat-image use.)
		if (await rateLimited("uploads", clean(author_id, 40), 60, 6)) {
			return rateLimitResponse(res, 60, "Too many uploads — please wait a minute.");
		}
		// Reject payloads whose bytes don't match the declared image type.
		if (!matchesImageMagic(buffer, contentType)) {
			return res
				.status(400)
				.json({ error: "File content does not match its declared image type." });
		}

		// Deep malware and polyglot scan: reject files containing executable or script payloads
		const threat = containsMaliciousPayload(buffer);
		if (threat) {
			try {
				await auditLog(
					"security",
					"malicious_upload_blocked",
					`${clean(author_id, 40)}: detected ${threat}`,
				);
			} catch {
				/* best effort audit */
			}
			return res.status(400).json({
				error: "Security violation: Malicious or executable content detected in file.",
				code: "MALICIOUS_FILE_BLOCKED",
			});
		}

		// Appropriate image check: reject files with inappropriate or abusive metadata / text chunks
		const inappropriate = checkImageAppropriateness(buffer, req.body || {});
		if (inappropriate) {
			try {
				await auditLog(
					"moderation",
					"inappropriate_image_blocked",
					`${clean(author_id, 40)}: detected ${inappropriate}`,
				);
			} catch {
				/* best effort audit */
			}
			return res.status(400).json({
				error: "Image rejected: Content or metadata violates school safety policy. Only appropriate school-related images are permitted.",
				code: "INAPPROPRIATE_IMAGE",
			});
		}

		// Try each available bucket
		for (const bucket of BUCKETS) {
			try {
				const ext = (contentType.split("/")[1] || "png").replace("jpeg", "jpg");
				const fileName = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
				const { error } = await supabase.storage
					.from(bucket)
					.upload(fileName, buffer, { contentType, upsert: true });
				if (error) {
					console.warn(`Upload to bucket '${bucket}' failed:`, error.message);
					continue; // try next bucket
				}
				const { data: urlData } = supabase.storage
					.from(bucket)
					.getPublicUrl(fileName);
				return res
					.status(200)
					.json({ url: urlData.publicUrl, storage: bucket });
			} catch (e) {
				console.warn(`Bucket '${bucket}' error:`, e.message);
			}
		}

		// FIX #14: Storage unavailable — reject instead of data-URL fallback (blows up DB storage)
		console.error("All storage buckets failed — rejecting upload (no data-URL fallback)");
		return res.status(503).json({ error: "Image storage is temporarily unavailable. Please try again shortly.", code: "STORAGE_UNAVAILABLE" });
	} catch (err) {
		console.error("upload API error:", err);
		return sanitizeError(res, err, "upload");
	}
}
