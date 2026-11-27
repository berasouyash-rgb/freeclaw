// Device detection + release picking for the native download surfaces.
// Pure helpers shared by the /download page and the InstallPrompt card.
// Lives here (not in pages/Download) so the eagerly-loaded prompt card
// doesn't drag the lazy Download page chunk into the main bundle.

export type DevicePlatform = "android" | "windows" | "macos" | "unknown";

/** Device detection for the download surfaces — one button, no thinking. */
export function detectDevicePlatform(
	userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
	nativePlatform = typeof navigator !== "undefined"
		? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ""
		: "",
): DevicePlatform {
	const ua = `${userAgent} ${nativePlatform}`.toLowerCase();
	if (/android/.test(ua)) return "android";
	if (/iphone|ipad|ios/.test(ua)) return "android"; // iOS has no native shell — APK page explains sideload/asks for web
	if (/win/.test(ua)) return "windows";
	if (/mac|darwin/.test(ua)) return "macos";
	if (/linux/.test(ua)) return "windows"; // closest desktop shell today
	return "unknown";
}

export interface PlatformRelease {
	version?: string;
	url?: string;
	notes?: string;
}

export function pickDownload(
	feed: Record<string, PlatformRelease>,
	device: DevicePlatform,
): { key: string; release: PlatformRelease } | null {
	const order =
		device === "android"
			? ["android"]
			: device === "windows"
				? ["windows"]
				: device === "macos"
					? ["macos"]
					: ["android", "windows", "macos"];
	for (const key of order) {
		const r = feed[key];
		if (r?.url) return { key, release: r };
	}
	return null;
}
