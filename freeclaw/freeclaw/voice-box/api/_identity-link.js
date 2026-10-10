// Cross-surface pairing — one anonymous id on many devices at once.
//
// POST /api/identity-link { action: "issue" } → { code, expires_in }
//   Requires a LIVE session (x-anon-id + cookie, normal authed fetch).
//   Shows the 6-digit code on the proven device; type it into the new one.
// POST /api/identity-link { action: "redeem", code } → { ok, anon_id }
//   No session needed — the code IS the authorization. The redeemer adopts
//   the id AND receives its own live session cookie, so web + app act
//   concurrently from the first tap. Nobody rotates, nobody locks out.
//
// Why not just adopt the id (link codes)? Adopting without a session
// leaves the new surface denied forever (record exists, no cookie) —
// every vote/comment 403s. The claim ticket is what establishes the
// second session legitimately: the issuer proved possession to mint it.
import {
	cors,
	createClaimTicket,
	redeemClaimTicket,
	verifyCallerIdentity,
} from "./_auth.js";
import { sanitizeError } from "./_error.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		const action = String(req.body?.action || "").trim().toLowerCase();

		if (action === "issue") {
			const claimed = String(
				req.body?.user_id || req.headers["x-anon-id"] || "",
			);
			const caller = await verifyCallerIdentity(req, res, claimed);
			if (!caller.ok)
				return res
					.status(caller.status || 403)
					.json({ error: caller.error, code: caller.code });
			const out = await createClaimTicket(caller.callerId, caller.sessionToken);
			if (!out.ok) return res.status(out.status || 503).json({ error: out.error });
			return res.status(200).json({ code: out.code, expires_in: out.expires_in });
		}

		if (action === "redeem") {
			const out = await redeemClaimTicket(req.body?.code, res, req);
			if (!out.ok) {
				const gone =
					/expired/i.test(out.error || "") || /invalid pairing code/i.test(out.error || "");
				return res.status(gone ? 403 : 503).json({ error: out.error });
			}
			return res.status(200).json({ ok: true, anon_id: out.anon_id });
		}

		return res.status(400).json({ error: "Unknown action (issue | redeem)" });
	} catch (err) {
		return sanitizeError(res, err, "identity-link");
	}
}
