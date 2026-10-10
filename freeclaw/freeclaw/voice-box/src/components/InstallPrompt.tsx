import { ArrowDownToLine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "../lib/identity";
import { apiBase, isNativeShell } from "../lib/platform";
import { detectDevicePlatform, pickDownload } from "../pages/Download";

export type InstallPromptKind = "native" | "ios" | null;

interface PromptSignals {
	hasRelease: boolean;
	dismissed: boolean;
	standalone: boolean;
	isIOS: boolean;
	isNative: boolean;
}

/**
 * Decides which first-run install prompt (if any) a device gets.
 * Exactly one prompt, once: native shells never (already installed),
 * dismissed stays dismissed, installed (standalone) stays silent. A
 * real packaged binary for this device beats everything except silence;
 * iOS has no binary, so it keeps the two-tap Add to Home Screen steps.
 * No release for this device (or an unreachable feed) means no prompt —
 * never a fake install button.
 */
export function decideInstallPrompt(s: PromptSignals): InstallPromptKind {
	if (s.isNative || s.dismissed || s.standalone) return null;
	if (s.hasRelease) return "native";
	if (s.isIOS) return "ios";
	return null;
}

function isIOSDevice(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
	return /iphone|ipad|ipod/i.test(ua);
}

function isStandalone(): boolean {
	try {
		return (
			window.matchMedia("(display-mode: standalone)").matches ||
			(window.navigator as Navigator & { standalone?: boolean }).standalone === true
		);
	} catch {
		return false;
	}
}

const DISMISS_KEY = "vb:installDismissed";

interface DeviceRelease {
	key: string;
	version?: string;
}

/**
 * First-run install invitation (web only). Asks the release feed
 * (/api/version) whether a packaged binary exists for this device and
 * shows one quiet card linking to /download when it does. The old PWA
 * beforeinstallprompt flow is gone on purpose: there is no service
 * worker, so "Install for offline reading" was a promise the app could
 * not keep. Dismiss once and it never asks again.
 */
export default function InstallPrompt() {
	const [release, setRelease] = useState<DeviceRelease | null>(null);
	const [dismissed, setDismissed] = useState<boolean>(() =>
		lsGet<boolean>(DISMISS_KEY, false),
	);

	useEffect(() => {
		let live = true;
		fetch(`${apiBase()}/api/version`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((d) => {
				if (!live) return;
				const pick = pickDownload(d?.platforms ?? {}, detectDevicePlatform());
				if (pick) setRelease({ key: pick.key, version: pick.release.version });
			})
			.catch(() => {
				/* unreachable feed → no prompt, never an error banner */
			});
		return () => {
			live = false;
		};
	}, []);

	const kind = decideInstallPrompt({
		hasRelease: release !== null,
		dismissed,
		standalone: isStandalone(),
		isIOS: isIOSDevice(),
		isNative: isNativeShell(),
	});
	if (!kind) return null;

	const dismiss = () => {
		setDismissed(true);
		lsSet(DISMISS_KEY, true);
	};

	return (
		<div className="card p-4 mb-4 vb-rise" role="dialog" aria-label="Install Voice Flow">
			<div className="flex items-start gap-3">
				<span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent/10 text-accent shrink-0">
					<ArrowDownToLine size={17} />
				</span>
				<div className="min-w-0 flex-1">
					<p className="font-display font-bold text-sm">Get the app</p>
					{kind === "native" ? (
						<p className="text-xs text-ink2 mt-0.5">
							Voice Flow for your device
							{release?.version ? ` (${release.version})` : ""} — free,
							same account, works alongside this page.
						</p>
					) : (
						<p className="text-xs text-ink2 mt-0.5">
							Tap Share, then “Add to Home Screen” to install Voice Flow.
						</p>
					)}
					<div className="flex gap-2 mt-2.5">
						{kind === "native" && (
							<a href="/download" className="btn btn-primary !text-xs !py-1.5">
								See downloads
							</a>
						)}
						<button type="button" onClick={dismiss} className="btn btn-ghost !text-xs !py-1.5">
							Not now
						</button>
					</div>
				</div>
				<button
					type="button"
					onClick={dismiss}
					aria-label="Dismiss install prompt"
					className="p-1.5 rounded-lg text-ink3 hover:text-ink2"
				>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
