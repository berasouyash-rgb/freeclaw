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
// Written by scripts/release-native.mjs on every native release. Imported
// statically (not read from disk) so the manifest is bundled into the
// serverless function — a runtime readFileSync of an un-imported file is not
// guaranteed to exist in the deployment sandbox.
import * as manifest from "./_release-manifest.js";

/**
 * Env vars win so an operator can repoint a release without a redeploy.
 * When they are unset — the common case — the artifacts the release pipeline
 * just published answer instead. Previously an unset feed advertised nothing
 * and the Download page told every visitor "No packaged releases published
 * yet", which is indistinguishable from a broken app.
 */
/** Numeric segments of a version, so "2.0.10" > "2.0.9" (string compare is not). */
function versionParts(value) {
	return String(value)
		.trim()
		.replace(/^v/i, "")
		.split(/[.+-]/)
		.map((part) => Number.parseInt(part, 10))
		.filter((n) => Number.isFinite(n));
}

/** -1 / 0 / 1 for a<b, a==b, a>b. Missing segments count as 0. */
export function compareVersions(a, b) {
	const A = versionParts(a);
	const B = versionParts(b);
	const len = Math.max(A.length, B.length);
	for (let i = 0; i < len; i++) {
		const x = A[i] ?? 0;
		const y = B[i] ?? 0;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

function entry(prefix, fallback) {
	const envVersion = String(process.env[`${prefix}_VERSION`] || "").trim();
	const envUrl = String(process.env[`${prefix}_URL`] || "").trim();
	// Sources never mix per platform. A half-configured env (version set, URL
	// empty) must advertise NOTHING rather than borrow the published URL —
	// that pairing would announce a release number nobody uploaded.
	const envConfigured = Boolean(envVersion || envUrl);
	if (envConfigured && (!envVersion || !envUrl)) return undefined;

	const publishedVersion = String(fallback?.version || "").trim();
	const publishedUrl = String(fallback?.url || "").trim();

	// Env exists so an operator can repoint a release without a redeploy. It
	// must not become a pin. A forgotten LATEST_APK_VERSION=2.0.1 overrode the
	// published 2.0.3 for 31 days, so /api/version advertised an old GitHub
	// build to every installed app and the Download page sent people to it.
	// Env therefore wins only when it is at least as new as what the release
	// pipeline published; an older env loses to the newer artifact.
	const useEnv =
		envConfigured &&
		(!publishedVersion || compareVersions(envVersion, publishedVersion) >= 0);

	const version = useEnv ? envVersion : publishedVersion;
	const url = useEnv ? envUrl : publishedUrl;
	if (!version || !url) return undefined;
	const notes = String(
		useEnv ? process.env[`${prefix}_NOTES`] || "" : fallback?.notes || "",
	)
		.trim()
		.slice(0, 500);
	return { version, url, ...(notes ? { notes } : {}) };
}

// Deployed commit marker — lets anyone check staleness in one request
// (compare against the release branch HEAD). Sourced from the hosting
// platform's commit env when present; "unknown" otherwise (never blank,
// so monitors can assert the field exists). Pure build metadata: no auth,
// no user data, safe to expose.
function deployedCommit() {
	const sha = String(
		process.env.VERCEL_GIT_COMMIT_SHA ||
			process.env.COMMIT_SHA ||
			process.env.GIT_COMMIT_SHA ||
			"",
	).trim();
	return sha || "unknown";
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });
	const published = manifest?.platforms || {};
	const platforms = {};
	const android = entry("LATEST_APK", published.android);
	const windows = entry("LATEST_EXE", published.windows);
	const mac = entry("LATEST_MAC", published.macos);
	if (android) platforms.android = android;
	if (windows) platforms.windows = windows;
	if (mac) platforms.macos = mac;
	res.setHeader(
		"Cache-Control",
		"public, max-age=0, no-cache, s-maxage=60, stale-while-revalidate=60",
	);
	return res.status(200).json({
		app: "voice-flow",
		platforms,
		commit: deployedCommit(),
		// Provenance: which regeneration of the release pipeline produced this
		// feed. "unknown" means nothing has been published since the runtime
		// was written — never blank, so a monitor can assert the field exists.
		published: manifest?.generated || "unknown",
	});
}
