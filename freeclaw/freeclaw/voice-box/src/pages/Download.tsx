import {
	Apple,
	ArrowDownToLine,
	Check,
	Download as DownloadIcon,
	Globe,
	Monitor,
	ShieldCheck,
	Smartphone,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { StaticFooter } from "../components/visual/PolicyVisuals";
import {
	detectDevicePlatform,
	pickDownload,
	type PlatformRelease,
} from "../lib/download";
import { apiBase, getPlatform, isNativeShell } from "../lib/platform";

const LABELS: Record<string, { title: string; file: string; hint: string; icon: typeof Smartphone }> = {
	android: {
		title: "Android app (APK)",
		file: "Voice Flow APK",
		hint: "Direct high-speed sideload for Android smartphones and tablets.",
		icon: Smartphone,
	},
	windows: {
		title: "Windows app (EXE)",
		file: "Voice Flow EXE",
		hint: "Desktop executable for Windows 10/11 school PCs and laptops.",
		icon: Monitor,
	},
	macos: {
		title: "Mac app (DMG)",
		file: "Voice Flow DMG",
		hint: "Native macOS package (Intel & Apple Silicon support).",
		icon: Apple,
	},
};

export default function Download() {
	const [feed, setFeed] = useState<Record<string, PlatformRelease> | null>(null);
	const [failed, setFailed] = useState(false);
	const device = detectDevicePlatform();
	// Inside a packaged shell the current platform's installer is the one
	// thing we must never offer: the user is already running it, and the only
	// way to "use" that link would be to copy it out to a browser by hand.
	// Web has no self to exclude and keeps the full grid.
	const platform = getPlatform();
	const native = isNativeShell();
	const selfKey = platform === "mobile" ? "android" : platform === "desktop" ? "windows" : null;
	const rawPick = feed ? pickDownload(feed, device) : null;
	const pick = rawPick && rawPick.key !== selfKey ? rawPick : null;
	// Entries (not just keys) so the label metadata is non-optional at the
	// use site — noUncheckedIndexedAccess makes LABELS[key] possibly undefined.
	const platforms = Object.entries(LABELS).filter(([k]) => k !== selfKey);
	const hasAnyRelease = feed
		? platforms.some(([k]) => Boolean(feed[k]?.url))
		: false;

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
		<div className="max-w-4xl mx-auto px-4 py-8">
			{/* Hero */}
			<div className="text-center mb-10 vb-rise">
				<span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent mb-4 shadow-xs">
					<ArrowDownToLine size={28} />
				</span>
				<h1 className="font-display font-bold text-3xl sm:text-4xl text-ink mb-2">
					{native ? "Voice Flow apps" : "Get the app"}
				</h1>
				<p className="text-sm sm:text-base text-ink3 max-w-lg mx-auto">
					{native
						? "You're already using the Voice Flow app. Here are the other platforms, if you need Voice Flow somewhere else too."
						: "Download Voice Flow for Android, Windows, Mac, or use the instant Web PWA. One tap per device — zero bloatware, zero automatic downloads."}
				</p>
			</div>

			{/* Failure Alert */}
			{failed && (
				<div className="card p-6 text-center border-bad/30 bg-bad/5 mb-8" role="alert">
					<p className="text-sm text-ink2">
						Couldn't reach the release feed. Check your connection and retry —
						the web app keeps working meanwhile.
					</p>
				</div>
			)}

			{/* Loading Skeleton */}
			{!failed && !feed && (
				<div className="space-y-4 mb-8" aria-hidden>
					<div className="skeleton h-32 rounded-2xl" />
					<div className="skeleton h-24 rounded-2xl" />
				</div>
			)}

			{/* No Releases Published Yet */}
			{feed && !hasAnyRelease && (
				<div className="card p-6 text-center border-border bg-surface mb-8">
					<p className="text-sm text-ink2">
						{native
							? "Nothing else to download right now — you're already on the Voice Flow app."
							: "No packaged releases published yet — the web app keeps working meanwhile."}
					</p>
				</div>
			)}

			{/* Recommended Native Pick */}
			{feed && pick && (
				<div className="card p-6 sm:p-8 mb-8 border-2 border-accent bg-surface/90 shadow-sm relative overflow-hidden vb-rise">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div className="flex items-start gap-4">
							<span className="w-12 h-12 rounded-2xl bg-accent-soft text-accent grid place-items-center shrink-0">
								<DownloadIcon size={24} />
							</span>
							<div>
								<div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-bold uppercase tracking-wider mb-1">
									<Sparkles size={11} /> Recommended for this device
								</div>
								<h2 className="font-display font-bold text-xl text-ink">
									{LABELS[pick.key]?.title ?? pick.key}
									{pick.release.version ? ` (v${pick.release.version})` : ""}
								</h2>
								<p className="text-xs text-ink3 mt-0.5">
									{LABELS[pick.key]?.hint ?? "Optimized build for your platform."}
								</p>
								{pick.release.notes && (
									<p className="text-xs text-ink2 mt-2 bg-surface2/60 p-2.5 rounded-xl border border-border">
										{pick.release.notes}
									</p>
								)}
							</div>
						</div>

						<a
							href={pick.release.url}
							className="btn btn-primary px-6 py-3 shrink-0 flex items-center justify-center gap-2 font-semibold shadow-xs"
							download
						>
							<DownloadIcon size={16} />
							Download {LABELS[pick.key]?.file ?? pick.key}
						</a>
					</div>
				</div>
			)}

			{/* All Platforms Grid — never lists the shell you are already in */}
			{feed && platforms.length > 0 && (
				<div className="mb-12">
					<h2 className="font-display font-bold text-lg text-ink mb-4">
						{native ? "Other platforms" : "All Available Platforms"}
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{platforms.map(([key, meta]) => {
							const r = feed[key];
							const Icon = meta.icon;
							return (
								<div
									key={key}
									className={`card p-5 border transition-all ${
										pick?.key === key
											? "border-accent/40 bg-accent-soft/10"
											: "border-border/80 bg-surface hover:border-accent/30"
									}`}
								>
									<div className="flex items-center gap-3 mb-3">
										<span className="w-10 h-10 rounded-xl bg-surface2 text-ink grid place-items-center shrink-0">
											<Icon size={20} />
										</span>
										<div>
											<h3 className="font-display font-semibold text-sm text-ink">
												{meta.title}
											</h3>
											<span className="text-[10px] font-mono text-ink3">
												{r?.version ? `v${r.version}` : "Available"}
											</span>
										</div>
									</div>
									<p className="text-xs text-ink3 mb-4 leading-relaxed">
										{meta.hint}
									</p>
									{r?.url ? (
										<a
											href={r.url}
											className="btn btn-soft w-full py-2 !text-xs font-semibold flex items-center justify-center gap-1.5"
											download
										>
											<DownloadIcon size={13} /> Download {meta.file}
										</a>
									) : (
										<span className="text-xs text-ink3 block text-center py-2 bg-surface2 rounded-xl">
											Web PWA Available
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Instant Web PWA & Zero-Install Note — a browser promise, so it has
			    no place inside the APK/EXE where the app is already installed. */}
			{!native && (
				<div className="card p-6 border border-border/80 bg-surface2/40 rounded-2xl mb-12">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div className="flex items-center gap-3.5">
							<span className="w-10 h-10 rounded-xl bg-good/15 text-good grid place-items-center shrink-0">
								<Globe size={20} />
							</span>
							<div>
								<h3 className="font-display font-bold text-sm text-ink">
									Instant Web App (Zero Install Required)
								</h3>
								<p className="text-xs text-ink2 mt-0.5">
									Voice Flow runs natively in any modern mobile or desktop browser with full offline caching.
								</p>
							</div>
						</div>
						<span className="text-xs font-semibold text-good bg-good/10 px-3 py-1.5 rounded-xl border border-good/20 self-start sm:self-auto flex items-center gap-1">
							<Check size={12} /> PWA Ready
						</span>
					</div>
				</div>
			)}

			{/* Cryptographic Binary Integrity Guarantee */}
			<div className="card p-6 border border-border bg-surface text-center mb-12">
				<ShieldCheck size={28} className="mx-auto text-accent mb-2" />
				<h3 className="font-display font-bold text-base text-ink mb-1">
					Cryptographic Binary Integrity
				</h3>
				<p className="text-xs text-ink2 max-w-md mx-auto leading-relaxed">
					Every compiled APK and EXE release is generated on isolated CI runners with verified SHA-256 signatures. No background telemetry or adware is included.
				</p>
			</div>

			<StaticFooter />
		</div>
	);
}
