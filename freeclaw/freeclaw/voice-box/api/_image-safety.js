// ══════════════════════════════════════════════════════════════
// IMAGE SAFETY — vision-model screening before an image can be published
// ══════════════════════════════════════════════════════════════
// The upload route already rejects files whose BYTES are not the declared
// image, executable/polyglot payloads, and images whose metadata/EXIF text
// names explicit content. None of that looks at the PIXELS: a plain JPEG of
// anything at all passed. This module adds that missing layer — one vision
// model call per upload, before the file is stored.
//
// POLICY: a school feed is a public surface. An image that the vision
// classifier says is not school-safe is refused, never stored. When the
// classifier cannot run, the upload is refused too (fail closed): a
// temporary "try again shortly" is recoverable, a published explicit image
// is not.
//
// The metadata rules in `_upload.js` still run FIRST, so obvious abuse is
// rejected without spending a provider call.

const VISION_MODEL =
	process.env.NVIDIA_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct";
const VISION_TIMEOUT_MS = 9000;

const SYSTEM_PROMPT = `You are an image safety classifier for a K-12 school app where students post anonymously.

BLOCK the image if it contains any of:
- nudity, sexual content, sexualized people, lingerie/underwear shots
- gore, serious injury, blood, dead bodies, animal cruelty
- weapons (guns, knives, bombs) shown as real objects
- drugs, alcohol, vaping, smoking
- hate symbols (swastika, KKK hoods, noose), racist/homophobic imagery
- self-harm, suicide, eating-disorder imagery
- threats or abusive text written on the image
- someone's private documents: ID cards, passports, report cards/grade sheets with names, phone numbers, addresses, bank details

ALLOW ordinary school life: classrooms, corridors, buildings, food, sports, animals, memes without hate, app screenshots, charts, error messages with no personal information, group photos and faces.

Be strict about the BLOCK list and permissive about everything else. Do not block for poor quality, colour, or "professionalism".

Reply with ONLY this JSON and nothing else:
{"safe": true|false, "categories": ["one of: sexual, gore, weapons, drugs, hate, self_harm, threat, private_info"], "reason": "at most 20 words"}`;

function parseVerdict(text) {
	const raw = String(text || "");
	const match = raw.match(/\{[\s\S]*\}/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]);
		if (typeof parsed?.safe !== "boolean") return null;
		return {
			safe: parsed.safe,
			categories: Array.isArray(parsed.categories)
				? parsed.categories.filter((c) => typeof c === "string").slice(0, 6)
				: [],
			reason: String(parsed.reason || "").slice(0, 160),
		};
	} catch {
		return null;
	}
}

/**
 * Screen image bytes with the vision model.
 *
 * Returns `{ safe, categories, reason, engine }` where `safe` is:
 *   true  → allowed
 *   false → refused (categories/reason explain why)
 *   null  → could not verify (no provider / timeout / bad answer)
 */
export async function screenImage(buffer, contentType) {
	const key = String(process.env.NVIDIA_API_KEY || "")
		.replace(/["']/g, "")
		.trim();
	if (!key) {
		return {
			safe: null,
			categories: [],
			reason: "Image safety review is not configured",
			engine: "unconfigured",
		};
	}
	if (!buffer || buffer.length === 0) {
		return {
			safe: false,
			categories: ["invalid"],
			reason: "Empty image",
			engine: "deterministic",
		};
	}

	const mime = /^image\/(png|jpe?g|gif|webp)$/.test(String(contentType || ""))
		? String(contentType)
		: "image/jpeg";
	const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
	try {
		const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
			method: "POST",
			signal: ctrl.signal,
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: VISION_MODEL,
				max_tokens: 160,
				temperature: 0,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Classify this image for the school app. Reply with the JSON only.",
							},
							{ type: "image_url", image_url: { url: dataUrl } },
						],
					},
				],
			}),
		});
		if (!res.ok) {
			return {
				safe: null,
				categories: [],
				reason: `Image review unavailable (${res.status})`,
				engine: "unavailable",
			};
		}
		const data = await res.json().catch(() => null);
		const verdict = parseVerdict(data?.choices?.[0]?.message?.content);
		if (!verdict) {
			return {
				safe: null,
				categories: [],
				reason: "Image review returned no usable verdict",
				engine: "unavailable",
			};
		}
		return { ...verdict, engine: VISION_MODEL };
	} catch (err) {
		return {
			safe: null,
			categories: [],
			reason: `Image review failed: ${err?.name === "AbortError" ? "timeout" : "network"}`,
			engine: "unavailable",
		};
	} finally {
		clearTimeout(timer);
	}
}
