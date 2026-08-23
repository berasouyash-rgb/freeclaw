// Image upload to Supabase Storage (anonymous, size-capped)
// FALLBACK: If Supabase Storage fails, returns a data-URL so images always work.

import { checkUser, clean, cors, rateLimited, rateLimitResponse } from "./_auth.js";
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

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		const { fileBase64, contentType, author_id } = req.body || {};
		const gate = await checkUser(clean(author_id, 40));
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

		// FALLBACK: All storage buckets failed — return data URL so the image still works
		console.warn("All storage buckets failed — falling back to data URL");
		const dataUrl = `data:${contentType || "image/png"};base64,${fileBase64}`;
		return res.status(200).json({ url: dataUrl, storage: "fallback-data-url" });
	} catch (err) {
		console.error("upload API error:", err);
		// Last-resort fallback: return data URL
		try {
			const { fileBase64: fb64, contentType: ct } = req.body || {};
			if (fb64) {
				const dataUrl = `data:${ct || "image/png"};base64,${fb64}`;
				return res
					.status(200)
					.json({ url: dataUrl, storage: "fallback-data-url" });
			}
		} catch {
			console.error("[upload] Last-resort data URL fallback also failed");
		}
		return sanitizeError(res, err, "upload");
	}
}
