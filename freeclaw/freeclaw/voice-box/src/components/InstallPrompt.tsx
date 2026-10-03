import { ArrowDownToLine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "../lib/identity";
import { isNativeShell } from "../lib/platform";

export type InstallPromptKind = "auto" | "ios" | null;

interface PromptSignals {
	hasDeferred: boolean;
	dismissed: boolean;
	standalone: boolean;
	isIOS: boolean;
	isNative: boolean;
}

/**
 * Decides which first-run install prompt (if any) a device gets.
 * Exactly one prompt, once: native shells never (already installed),
 * dismissed stays dismissed, installed (standalone) stays silent.
 */
export function decideInstallPrompt(s: PromptSignals): InstallPromptKind {
	if (s.isNative || s.dismissed || s.standalone) return null;
	if (s.hasDeferred) return "auto";
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

/**
 * First-run install invitation (web only). Captures the browser's
 * beforeinstallprompt and shows one quiet card with a real Install button;
 * on iOS (no install event) shows the two-tap Share → Add to Home Screen
 * steps instead. Dismiss once and it never asks again.
 */
export default function InstallPrompt() {
	const [deferred, setDeferred] = useState<Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: string }>;
	} | null>(null);
	const [dismissed, setDismissed] = useState<boolean>(() =>
		lsGet<boolean>(DISMISS_KEY, false),
	);

	useEffect(() => {
		const onPrompt = (e: Event) => {
			e.preventDefault();
			setDeferred(
				e as Event & {
					prompt: () => Promise<void>;
					userChoice: Promise<{ outcome: string }>;
				},
			);
		};
		window.addEventListener("beforeinstallprompt", onPrompt);
		return () => window.removeEventListener("beforeinstallprompt", onPrompt);
	}, []);

	const kind = decideInstallPrompt({
		hasDeferred: deferred !== null,
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

	const install = async () => {
		if (!deferred) return;
		try {
			await deferred.prompt();
			await deferred.userChoice;
		} catch {
			/* browser handles the UI — nothing to reconcile */
		}
		dismiss();
	};

	return (
		<div className="card p-4 mb-4 vb-rise" role="dialog" aria-label="Install Voice Flow">
			<div className="flex items-start gap-3">
				<span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent/10 text-accent shrink-0">
					<ArrowDownToLine size={17} />
				</span>
				<div className="min-w-0 flex-1">
					<p className="font-display font-bold text-sm">Get the app</p>
					{kind === "auto" ? (
						<p className="text-xs text-ink2 mt-0.5">
							Install Voice Flow for faster opens and offline reading.
						</p>
					) : (
						<p className="text-xs text-ink2 mt-0.5">
							Tap Share, then “Add to Home Screen” to install Voice Flow.
						</p>
					)}
					<div className="flex gap-2 mt-2.5">
						{kind === "auto" && (
							<button type="button" onClick={() => void install()} className="btn btn-primary !text-xs !py-1.5">
								Install
							</button>
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
