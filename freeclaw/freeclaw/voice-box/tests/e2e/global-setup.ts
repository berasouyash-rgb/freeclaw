import type { FullConfig } from "@playwright/test";

/**
 * Guards the suite against testing the wrong application.
 *
 * Playwright's `reuseExistingServer` reuses whatever already listens on the
 * configured port. On a shared dev machine that can be an *unrelated* project —
 * this genuinely happened: :5173 was serving a different app, so the whole
 * suite silently passed/failed against it. A green run against the wrong app is
 * worse than a red one, so verify the served page really is Voice Flow before
 * any test executes.
 */
export default async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";

	let html = "";
	try {
		const res = await fetch(baseURL, { redirect: "follow" });
		html = await res.text();
	} catch (err) {
		throw new Error(
			`[e2e] could not reach ${baseURL} — is the Voice Flow dev server running?\n` +
				`  ${(err as Error).message}`,
		);
	}

	const title =
		html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "(no title)";
	const isVoiceBox =
		/voice\s*box/i.test(title) || html.includes('id="vb-splash"');

	if (!isVoiceBox) {
		throw new Error(
			`[e2e] ${baseURL} is NOT Voice Flow — refusing to run the suite.\n` +
				`  Found title: "${title}"\n` +
				`  Another dev server is probably squatting on this port. Free it, or ` +
				`point the suite at Voice Flow with VB_PORT=<port> (or VB_BASE_URL=<url>).`,
		);
	}

	console.log(`[e2e] verified Voice Flow at ${baseURL} ("${title}")`);
}
