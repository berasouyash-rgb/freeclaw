// ─── Error Boundary — Catches React render errors gracefully ──────
// Wraps routes and components to prevent white screens of death.
// Supports retryLazy for chunk load failures and per-section boundaries.

import {
	AlertTriangle,
	FileWarning,
	Home,
	RefreshCw,
	WifiOff,
} from "lucide-react";
import {
	Component,
	type CSSProperties,
	type ErrorInfo,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from "react";
import { isChunkLoadError, reloadOnceForStaleChunk } from "../lib/retryLazy";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
	hasError: boolean;
	detail: string;
}

/**
 * Normalize ANY thrown value into a readable string.
 *
 * React passes whatever was thrown to getDerivedStateFromError — and that is
 * often NOT an Error: a bare `throw "string"`, a rejected promise value, or
 * an object payload like { message, code }. Reading `.message` on those gives
 * `undefined`, which is why the old "Error details" panel rendered empty.
 */
function describeError(error: unknown): string {
	if (error == null)
		return "Unknown error — no details were captured.";
	if (typeof error === "string") return error;
	if (typeof error === "number" || typeof error === "boolean")
		return String(error);
	if (error instanceof Error) {
		const lines = [error.message || error.name || "Error"];
		if (error.stack) lines.push(`\n${error.stack}`);
		return lines.join("\n");
	}
	if (typeof error === "object") {
		const e = error as Record<string, unknown>;
		if (typeof e.message === "string" && e.message) return e.message;
		if (typeof e.error === "string" && e.error) return e.error;
		try {
			const json = JSON.stringify(error, null, 2);
			if (json && json !== "{}") return json;
		} catch {
			/* circular reference — fall through */
		}
	}
	try {
		return String(error);
	} catch {
		return "Unknown error — could not be serialized.";
	}
}

// Detect offline / network errors
function isNetworkError(error: unknown): boolean {
	if (!error) return false;
	const msg =
		typeof error === "string"
			? error
			: error instanceof Error
				? error.message
				: "";
	return (
		msg.includes("Failed to fetch") ||
		msg.includes("NetworkError") ||
		msg.includes("network")
	);
}

export class ErrorBoundary extends Component<Props, State> {
	static defaultProps = { fallback: undefined, onError: undefined };
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, detail: "" };
	}

	static getDerivedStateFromError(error: unknown): State {
		return { hasError: true, detail: describeError(error) };
	}

	override componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error(
			"[ErrorBoundary] Caught:",
			describeError(error),
			"\nComponent stack:",
			info.componentStack,
		);
		this.props.onError?.(error as Error, info);
	}

	handleRetry = () => {
		this.setState({ hasError: false, detail: "" });
	};

	handleGoHome = () => {
		window.location.href = "/";
	};

	/**
	 * Chunk-load recovery. Ask retryLazy's guarded self-heal to reload once
	 * (a fresh index.html fetches the new hashed chunks after a redeploy).
	 * If the once-per-session guard is already spent, force a plain reload
	 * anyway so the button always does something.
	 */
	handleRecoverChunk = () => {
		if (!reloadOnceForStaleChunk()) {
			window.location.reload();
		}
	};

	override render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			const detail = this.state.detail;
			const isChunk = isChunkLoadError(detail);
			const isNet = isNetworkError(detail);

			return (
				<div
					className="min-h-[60vh] flex items-center justify-center p-8"
					role="alert"
				>
					<div className="max-w-md text-center">
						<div
							className={`mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center ${isChunk ? "bg-amber-500/10" : isNet ? "bg-orange-500/10" : "bg-red-500/10"}`}
						>
							{isChunk ? (
								<FileWarning size={28} className="text-amber-500" />
							) : isNet ? (
								<WifiOff size={28} className="text-orange-500" />
							) : (
								<AlertTriangle size={28} className="text-red-500" />
							)}
						</div>
						<h2 className="text-xl font-bold mb-2">
							{isChunk
								? "Could not load this section"
								: isNet
									? "Network connection lost"
									: "Something went wrong"}
						</h2>
						<p className="text-sm text-ink3 mb-2">
							{isChunk
								? "A part of the app failed to load. This can happen after an update or with a slow connection."
								: isNet
									? "Unable to reach the server. Check your internet connection and try again."
									: "An unexpected error occurred."}
						</p>
						<p className="text-xs text-ink3/60 mb-4">
							{isChunk
								? "Try refreshing the page to get the latest version."
								: "Please try again."}
						</p>
						{detail && (
							<details className="mb-6 text-left">
								<summary className="text-xs text-ink3 cursor-pointer hover:text-ink2">
									Error details — {(detail.split("\n")[0] ?? "").slice(0, 140)}
								</summary>
								<pre className="mt-2 p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-xs text-red-400 overflow-auto max-h-32 whitespace-pre-wrap break-all">
									{detail}
								</pre>
							</details>
						)}
						<div className="flex gap-3 justify-center flex-wrap">
							{isChunk ? (
								<button
									onClick={this.handleRecoverChunk}
									className="btn btn-primary flex items-center gap-2 text-sm"
								>
									<RefreshCw size={14} /> Reload page
								</button>
							) : (
								<button
									onClick={this.handleRetry}
									className="btn btn-primary flex items-center gap-2 text-sm"
								>
									<RefreshCw size={14} /> Try Again
								</button>
							)}
							<button
								onClick={this.handleGoHome}
								className="btn btn-ghost flex items-center gap-2 text-sm"
							>
								<Home size={14} /> Go Home
							</button>
						</div>
						{isChunk && (
							<p className="text-[10px] text-ink3/50 mt-4">
								Tip: Press Ctrl+Shift+R (Cmd+Shift+R on Mac) to hard-refresh and
								clear cached files
							</p>
						)}
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}

/**
 * Inline error display for async ops (fetch failures, etc.)
 */
export function ErrorDisplay({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-12 px-4">
			<div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
				<AlertTriangle size={24} className="text-red-500" />
			</div>
			<p className="text-sm font-medium mb-1">Failed to load</p>
			<p className="text-xs text-ink3 mb-4 text-center max-w-sm">{message}</p>
			{onRetry && (
				<button
					onClick={onRetry}
					className="btn btn-ghost text-xs flex items-center gap-1.5"
				>
					<RefreshCw size={12} /> Retry
				</button>
			)}
		</div>
	);
}

/**
 * The full Voice Flow motive, told one line per beat. While the app works,
 * the loader walks through the whole story so a wait is never wasted.
 */
export const VB_MOTIVES: readonly string[] = [
	"Your voice, fully anonymous.",
	"Anonymous school feedback — no names, no emails, no tracking.",
	"Report problems, share ideas, vote in polls.",
	"The school sees it. The school fixes it.",
	"100% anonymous. Always.",
];

/** Screen time per motive line — the full 5-line story takes 16s. */
export const VB_MOTIVE_MS = 3200;

/** Full story cycle — every motive line gets VB_MOTIVE_MS of screen time. */
export const VB_FULL_CYCLE_MS = VB_MOTIVE_MS * VB_MOTIVES.length;

export function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" &&
		typeof window.matchMedia === "function"
		? window.matchMedia("(prefers-reduced-motion: reduce)").matches
		: false;
}

interface LoadingSpinnerProps {
	/** Primary status line under the brand lockup. */
	text?: string;
	/** Pin a single motive line instead of cycling through the full story. */
	motive?: string;
	/** Hide the rotating motive line entirely (spinner + brand lockup only). */
	motiveOff?: boolean;
	/** Guaranteed display time in ms — renders a progress bar that fills exactly over it. */
	durationMs?: number;
}

/**
 * Premium motive loader for async operations — an ambient stage with
 * drifting brand orbs, a brand tile with animated voice bars in a conic
 * gradient ring with a soft halo, the Voice Flow wordmark and tagline,
 * a shimmering status line, a rotating line that tells the full SaaS
 * motive, and chapter dots marking story progress. Pure CSS, static
 * under prefers-reduced-motion.
 */
export function LoadingSpinner({
	text = "Loading…",
	motive,
	motiveOff = false,
	durationMs,
}: LoadingSpinnerProps) {
	const gradId = `vbLoadGrad-${useId().replace(/:/g, "")}`;
	// Cycle only when we have a story to tell and the user hasn't opted out
	// of motion. matchMedia is stubbed `matches: false` in tests, so the
	// rotation is exercised there deterministically.
	const [cycle] = useState(
		() => !motive && !motiveOff && !prefersReducedMotion(),
	);
	const [motiveIndex, setMotiveIndex] = useState(0);

	useEffect(() => {
		if (!cycle) return;
		const id = window.setInterval(() => {
			setMotiveIndex((i) => (i + 1) % VB_MOTIVES.length);
		}, VB_MOTIVE_MS);
		return () => window.clearInterval(id);
	}, [cycle]);

	const activeMotive = motive ?? VB_MOTIVES[motiveIndex % VB_MOTIVES.length];

	return (
		<div
			className="flex flex-col items-center justify-center py-12 vb-motive-loader"
			role="status"
			aria-live="polite"
		>
			{/* Ambient stage — drifting brand orbs behind the ring (pure CSS) */}
			<span className="vb-loader-orb vb-loader-orb--1" aria-hidden="true" />
			<span className="vb-loader-orb vb-loader-orb--2" aria-hidden="true" />
			<span className="vb-loader-orb vb-loader-orb--3" aria-hidden="true" />

			<div className="relative w-16 h-16 mb-4">
				<div
					className="absolute inset-0 rounded-full vb-loading-ring"
					aria-hidden="true"
				/>
				<div
					className="absolute inset-0 rounded-full vb-loading-halo"
					aria-hidden="true"
				/>
				<div className="absolute inset-0 flex items-center justify-center">
					<svg width={38} height={38} viewBox="0 0 96 96" aria-hidden="true">
						<defs>
							<linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
								<stop offset="0" stopColor="#6366F1" />
								<stop offset="1" stopColor="#7C3AED" />
							</linearGradient>
						</defs>
						<rect
							x="4"
							y="4"
							width="88"
							height="88"
							rx="24"
							fill={`url(#${gradId})`}
						/>
						<g
							className="vb-loading-bars"
							fill="none"
							stroke="#fff"
							strokeLinecap="round"
						>
							<rect x="26" y="30" width="44" height="8" rx="4" />
							<rect x="30" y="44" width="36" height="8" rx="4" />
							<rect x="26" y="58" width="44" height="8" rx="4" />
						</g>
					</svg>
				</div>
			</div>
			<p className="vb-loading-wordmark">Voice Flow</p>
			<p className="vb-loading-tagline">Your Voice Matters</p>
			{text && (
				<p className="vb-loading-label text-xs font-medium tracking-wide">
					{text}
				</p>
			)}
			{!motiveOff && (
				<p key={activeMotive} className="vb-loading-motive vb-motive-in">
					{activeMotive}
				</p>
			)}
			{cycle && (
				<div className="vb-loading-dots" aria-hidden="true">
					{VB_MOTIVES.map((_, i) => (
						<span
							key={i}
							className={`vb-loading-dot${i === motiveIndex % VB_MOTIVES.length ? " is-active" : ""}`}
						/>
					))}
				</div>
			)}
			{typeof durationMs === "number" && !prefersReducedMotion() && (
				<div
					className="vb-loading-progress"
					aria-hidden="true"
					style={
						{ "--vb-progress-duration": `${durationMs}ms` } as CSSProperties
					}
				/>
			)}
		</div>
	);
}

/**
 * Empty state for lists with no data
 */
export function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon?: ReactNode;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-12 px-4">
			{icon && <div className="mb-3 opacity-40">{icon}</div>}
			<p className="text-sm font-medium mb-1">{title}</p>
			{description && (
				<p className="text-xs text-ink3 text-center max-w-sm mb-4">
					{description}
				</p>
			)}
			{action}
		</div>
	);
}

export default ErrorBoundary;
