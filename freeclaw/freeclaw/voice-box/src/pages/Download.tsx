import { useEffect, useState } from "react";
import { apiBase } from "../lib/platform";

export type DevicePlatform = "android" | "windows" | "macos" | "unknown";

/** Device detection for the download page — one button, no thinking. */
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

interface PlatformRelease {
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

const LABELS: Record<string, { title: string; file: string; hint: string }> = {
	android: {
		title: "Android app (APK)",
		file: "Voice Flow APK",
		hint: "Sideload on the school device — Play Store release needs a signed AAB.",
	},
	windows: {
		title: "Windows app (EXE)",
		file: "Voice Flow EXE",
		hint: "Installer for school PCs.",
	},
	macos: {
		title: "Mac app (DMG)",
		file: "Voice Flow DMG",
		hint: "Unsigned build — right-click → Open on first launch.",
	},
};

export default function Download() {
	const [feed, setFeed] = useState<Record<string, PlatformRelease> | null>(null);
	const [failed, setFailed] = useState(false);
	const device = detectDevicePlatform();
	const pick = feed ? pickDownload(feed, device) : null;

	useEffect(() => {
		let live = true;
		fetch(`${apiBase()}/api/version`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((d) => {
				if (live) setFeed(d?.platforms ?? {});
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, []);

	return (
		<div className="max-w-2xl mx-auto">
			<h1 className="font-display font-bold text-2xl mb-1">Get the app</h1>
			<p className="text-sm text-ink3 mb-5">
				One button per device — no auto-downloads, no surprises. Your browser
				only downloads after you tap.
			</p>
			{failed && (
				<div className="card p-6 text-center" role="alert">
					<p className="text-sm text-ink2">
						Couldn't reach the release feed. Check your connection and retry —
						the web app keeps working meanwhile.
					</p>
				</div>
			)}
			{!failed && !feed && (
				<div className="space-y-3" aria-hidden>
					<div className="skeleton h-24" />
					<div className="skeleton h-24" />
				</div>
			)}
			{feed && pick && (
				<div className="card p-5 mb-3 vb-rise">
					<p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent mb-1">
						Recommended for this device
					</p>
					<h2 className="font-display font-bold text-lg">
						{LABELS[pick.key]?.title ?? pick.key}
						{pick.release.version ? ` (${pick.release.version})` : ""}
					</h2>
					{pick.release.notes && (
						<p className="text-sm text-ink2 mt-1">{pick.release.notes}</p>
					)}
					<a
						href={pick.release.url}
						className="btn btn-primary mt-4 inline-flex"
						download
					>
						Download {LABELS[pick.key]?.file ?? pick.key}
					</a>
				</div>
			)}
			{feed && (
				<div className="space-y-3">
					<h2 className="sr-only">All downloads</h2>
					{Object.entries(LABELS).map(([key, meta]) => {
						const r = feed[key];
						if (!r?.url) return null;
						if (pick?.key === key) return null;
						return (
							<div key={key} className="card p-4">
								<h2 className="font-semibold text-sm">
									{meta.title}
									{r.version ? ` (${r.version})` : ""}
								</h2>
								<p className="text-xs text-ink3 mt-0.5">{meta.hint}</p>
								<a href={r.url} className="btn btn-soft mt-3 inline-flex !text-xs" download>
									Download {meta.file}
								</a>
							</div>
						);
					})}
					{Object.values(feed).every((r) => !r?.url) && (
						<div className="card p-6 text-center">
							<p className="text-sm text-ink2">
								No packaged releases published yet — the web app has
								everything, and new native builds appear here automatically
								once released.
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
