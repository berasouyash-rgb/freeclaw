// App update feed — GET /api/version tells native shells (APK + EXE + DMG)
// where the newest build lives. Sourced purely from release env vars:
//
//   LATEST_APK_VERSION / LATEST_APK_URL [/ LATEST_APK_NOTES]
//   LATEST_EXE_VERSION / LATEST_EXE_URL [/ LATEST_EXE_NOTES]
//   LATEST_MAC_VERSION / LATEST_MAC_URL [/ LATEST_MAC_NOTES]
//
// A platform with version or URL unset advertises nothing — the client
// treats that as up-to-date, so releases are opt-in per platform and an
// unset feed can never brick or nag anyone. Public info only: no auth,
// no user data. Short shared cache (releases are rare, freshness cheap).
import { cors } from "./_auth.js";

function entry(prefix) {
	const version = String(process.env[`${prefix}_VERSION`] || "").trim();
	const url = String(process.env[`${prefix}_URL`] || "").trim();
	if (!version || !url) return undefined;
	const notes = String(process.env[`${prefix}_NOTES`] || "")
		.trim()
		.slice(0, 500);
	return { version, url, ...(notes ? { notes } : {}) };
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });
	const platforms = {};
	const android = entry("LATEST_APK");
	const windows = entry("LATEST_EXE");
	const mac = entry("LATEST_MAC");
	if (android) platforms.android = android;
	if (windows) platforms.windows = windows;
	if (mac) platforms.macos = mac;
	res.setHeader(
		"Cache-Control",
		"public, max-age=0, no-cache, s-maxage=60, stale-while-revalidate=60",
	);
	return res.status(200).json({ app: "voice-flow", platforms });
}
