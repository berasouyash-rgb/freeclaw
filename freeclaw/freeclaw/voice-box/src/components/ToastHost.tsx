import { useApp } from "../contexts/AppContext";

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
 */
export default function ToastHost() {
	const { toasts } = useApp();

	/* Container must never intercept clicks (pointer-events-none); only the
	 * toast cards themselves are clickable. The bottom offset clears the
	 * mobile bottom nav on user pages; on /admin it simply floats a little
	 * higher, which is harmless. */
	return (
		<div
			className="fixed bottom-[calc(5rem_+_env(safe-area-inset-bottom))] lg:bottom-6 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none"
			aria-live="polite"
			role="status"
			aria-label="Notifications and toasts"
		>
			{toasts.map((t) => (
				<div
					key={t.id}
					className={`pointer-events-auto vb-rise card !rounded-xl shadow-xl px-4 py-3 text-sm font-medium flex items-center gap-3 max-w-sm ${t.kind === "err" ? "!border-bad/40 text-bad" : t.kind === "ok" ? "!border-good/40" : ""}`}
				>
					<span>{t.text}</span>
					{t.action && (
						<button
							className="btn btn-soft !py-1 !px-2.5 !text-xs shrink-0"
							onClick={t.action.fn}
						>
							{t.action.label}
						</button>
					)}
				</div>
			))}
		</div>
	);
}
