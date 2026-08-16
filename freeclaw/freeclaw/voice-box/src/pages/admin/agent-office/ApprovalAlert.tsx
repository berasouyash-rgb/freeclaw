import { Gavel, Loader2, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../../contexts/AppContext";
import { api } from "../../../lib/api";
import { errorText, safeStringify } from "../../../lib/utils";

/* ═══════════════════════════════════════════════════════════════
   APPROVAL ALERT — immediate admin popup for high-risk work.
   The runtime parks high/critical tasks in BLOCKED (awaiting
   approval) state and emits approval.requested. This component
   polls the REAL pending-approvals endpoint and, the moment a NEW
   blocked task appears, fires an instant popup with the WHY and
   inline Approve/Reject wired to the real approve-task/reject-task
   commands. Never invents work — it only surfaces what the runtime
   actually blocked.
   ═══════════════════════════════════════════════════════════════ */

interface ApprovalItem {
	id: string;
	title: string;
	description: string | null;
	source: string;
	priority: string;
	risk_level: string;
	verification_status: string;
	input: unknown;
	created_by: string;
	created_at: string;
}

export default function ApprovalAlert({ pollMs = 12000 }: { pollMs?: number }) {
	const { toast } = useApp();
	const [active, setActive] = useState<ApprovalItem[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const bootedRef = useRef(false);
	const seenRef = useRef<Set<string>>(new Set());
	const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

	const dismiss = useCallback(
		(id: string) => setActive((prev) => prev.filter((t) => t.id !== id)),
		[],
	);

	const act = async (id: string, approve: boolean) => {
		setBusy(`${approve ? "approve" : "reject"}:${id}`);
		try {
			const r = await api.post<{ ok?: boolean; error?: string; message?: string }>(
				"/api/workforce",
				{
					action: approve ? "approve-task" : "reject-task",
					id,
					reason: approve ? undefined : "Rejected from approval alert",
				},
			);
			if (r?.ok === false) {
				// Real backend rejection (e.g. task already gone) — tell the admin
				// exactly why instead of failing silently.
				toast(
					`${approve ? "Approve" : "Reject"} failed: ${errorText(r.error || "unknown")}`,
					"err",
				);
			} else {
				dismiss(id);
				toast(
					approve
						? (r?.message ?? "Task approved — execution started")
						: "Task rejected and cancelled",
					"ok",
				);
			}
		} catch (e: unknown) {
			// Network / timeout — keep the popup so the admin can retry.
			toast(
				`${approve ? "Approve" : "Reject"} failed: ${errorText(e)} — retry`,
				"err",
			);
		}
		setBusy(null);
	};

	// Poll the REAL blocked-task queue; fire popups only for NEW tasks
	// (tasks already waiting when the page loads are baseline, not popups)
	useEffect(() => {
		const timers = timersRef.current; // stable handle for this effect instance
		const check = async () => {
			try {
				const r = await api.post<{ ok: boolean; approvals: ApprovalItem[] }>(
					"/api/workforce",
					{ action: "pending-approvals" },
				);
				const list = r.approvals || [];
				const fresh: ApprovalItem[] = [];
				for (const t of list) {
					if (seenRef.current.has(t.id)) continue;
					seenRef.current.add(t.id);
					if (bootedRef.current) fresh.push(t); // baseline queue on first load → no popups
				}
				bootedRef.current = true;
				if (fresh.length > 0) {
					setActive((prev) => [...fresh, ...prev].slice(0, 3));
					fresh.forEach((t) => {
						const timer = setTimeout(() => {
							timers.delete(timer);
							dismiss(t.id);
						}, 30000);
						timers.add(timer);
					});
				}
			} catch {
				/* offline / no admin session — stay silent */
			}
		};
		check();
		const iv = setInterval(check, pollMs);
		const onVis = () => {
			if (!document.hidden) check();
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(iv);
			document.removeEventListener("visibilitychange", onVis);
			timers.forEach((t) => clearTimeout(t));
			timers.clear();
		};
	}, [pollMs, dismiss]);

	if (active.length === 0) return null;

	return (
		<div className="fixed bottom-5 left-5 z-[70] space-y-2.5 w-[min(360px,calc(100vw-40px))]">
			{active.map((t) => (
				<div
					key={t.id}
					className="relative rounded-xl border border-orange-500/40 bg-surface shadow-2xl shadow-orange-500/10 overflow-hidden vb-pop"
					role="alert"
					aria-live="assertive"
				>
					<div className="h-1 w-full bg-gradient-to-r from-amber-500 to-orange-500" />
					<div className="p-3.5 space-y-2">
						<div className="flex items-start gap-2.5">
							<div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
								<Gavel size={16} className="text-orange-400" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5">
									<span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-orange-500/15 text-orange-400">
										approval required
									</span>
									<span className="px-1.5 py-0.5 rounded bg-surface2 text-[9px] font-mono uppercase tracking-wider text-ink2">
										risk: {t.risk_level}
									</span>
								</div>
								<p className="text-[12.5px] font-bold text-ink1 mt-1 leading-snug">
									{t.title}
								</p>
							</div>
							<button
								onClick={() => dismiss(t.id)}
								className="p-1 rounded-md hover:bg-surface2 transition-colors flex-shrink-0"
								aria-label="Dismiss alert"
							>
								<X size={13} className="text-ink3" />
							</button>
						</div>

						{/* The WHY — description + input, straight from the runtime */}
						{t.description && (
							<p className="text-[11px] text-ink2 leading-relaxed">
								{t.description.slice(0, 240)}
							</p>
						)}
						{t.input != null && (
							<p className="text-[9px] font-mono text-ink3 truncate">
								input: {safeStringify(t.input).slice(0, 140)}
							</p>
						)}

						<div className="flex items-center justify-between pt-1 border-t border-border/40">
							<span className="text-[9px] font-mono text-ink3">
								src:{t.source} · by:{t.created_by}
							</span>
							<div className="flex gap-1.5">
								<button
									onClick={() => act(t.id, false)}
									disabled={busy !== null}
									className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40 text-[10px] font-bold"
								>
									{busy === `reject:${t.id}` ? (
										<Loader2 size={11} className="animate-spin" />
									) : (
										<ThumbsDown size={11} />
									)}
									Reject
								</button>
								<button
									onClick={() => act(t.id, true)}
									disabled={busy !== null}
									className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 text-[10px] font-bold"
								>
									{busy === `approve:${t.id}` ? (
										<Loader2 size={11} className="animate-spin" />
									) : (
										<ThumbsUp size={11} />
									)}
									Approve &amp; Execute
								</button>
							</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
