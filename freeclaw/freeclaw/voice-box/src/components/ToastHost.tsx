import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../contexts/AppContext";

const TOAST_ICONS = {
	ok: CheckCircle2,
	err: AlertCircle,
	info: Info,
} as const;

/**
 * ToastHost — the single rendering point for AppContext toasts.
 *
 * REGRESSION: the host used to live inside <Layout>, but /admin/* mounts
 * outside Layout (own shell, own ErrorBoundary). Every toast() call in the
 * admin console — login success/failure, session expiry, password change,
 * moderation actions — updated state that nothing ever rendered, so admins
 * got zero feedback on any action.
 *
 * Mounted once at the AppProvider level, it covers every route, current and
 * future: a route cannot silently lose toast feedback again.
 *
 * Every toast carries its own state in words (icon + text, not colour alone)
 * and can be dismissed immediately — an error must not sit on screen for
 * four seconds after the user has already retried.
 */
export default function ToastHost() {
	const { toasts, dismissToast } = useApp();

	/* Container must never intercept clicks (pointer-events-none); only the
	 * toast cards themselves are clickable. The bottom offset clears the
	 * mobile bottom nav on user pages; on /admin it simply floats a little
	 * higher, which is harmless. */
	return (
		<div
			className="fixed bottom-[calc(5rem_+_env(safe-area-inset-bottom))] lg:bottom-6 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none"
			aria-live="polite"
			aria-atomic="false"
			role="status"
			aria-label="Notifications and toasts"
		>
			{toasts.map((t) => {
				const Icon = TOAST_ICONS[t.kind] ?? Info;
				return (
					<div
						key={t.id}
						className={`pointer-events-auto vb-rise card !rounded-xl shadow-xl px-4 py-3 text-sm font-medium flex items-center gap-3 max-w-sm ${t.kind === "err" ? "!border-bad/40 text-bad" : t.kind === "ok" ? "!border-good/40" : ""}`}
					>
						<Icon
							size={16}
							className={
								t.kind === "err"
									? "text-bad shrink-0"
									: t.kind === "ok"
										? "text-good shrink-0"
										: "text-accent shrink-0"
							}
							aria-hidden
						/>
						<span className="min-w-0">{t.text}</span>
						{t.action && (
							<button
								className="btn btn-soft !py-1 !px-2.5 !text-xs shrink-0"
								onClick={t.action.fn}
							>
								{t.action.label}
							</button>
						)}
						<button
							type="button"
							className="shrink-0 p-0.5 rounded-md text-ink3 hover:text-ink hover:bg-surface2 transition-colors"
							onClick={() => dismissToast(t.id)}
							aria-label={`Dismiss notification: ${t.text}`}
						>
							<X size={14} aria-hidden />
						</button>
					</div>
				);
			})}
		</div>
	);
}
