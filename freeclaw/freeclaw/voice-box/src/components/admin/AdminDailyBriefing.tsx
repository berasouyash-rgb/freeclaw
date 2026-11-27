import {
	ArrowRight,
	CheckCircle2,
	Clock,
	FileText,
	Gavel,
	RefreshCcw,
	Shield,
	ShieldAlert,
	Sparkles,
	UserX,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";

interface BriefingData {
	headline: string;
	summary: string;
	safety_pulse: string;
	admin_actions_summary: string;
	action_items: string[];
}

interface EscalatedUser {
	anon_id: string;
	strikes: number;
	warnings?: Array<{ text: string; at: string }>;
	suspended_until?: string | null;
	banned?: boolean;
	last_seen?: string;
	/** Slang escalation awaiting a scope decision (settings KV). */
	escalation?: {
		violations?: number;
		terms?: string[];
		status?: string;
		last_at?: string;
		at?: string;
	} | null;
	/** Live restriction row, if one is already applied. */
	restriction?: {
		scope?: string;
		active?: boolean;
		reason?: string;
		created_at?: string;
	} | null;
}

interface ScopeOption {
	value: string;
	label: string;
}

interface AccountabilityLog {
	id: string | number;
	admin_id?: string;
	action: string;
	detail?: string;
	created_at: string;
}

interface AdminDailyBriefingProps {
	openReportsCount: number;
	flaggedPostsCount: number;
	onOpenReportsTab: () => void;
	onOpenUsersTab?: () => void;
}

export default function AdminDailyBriefing({
	openReportsCount,
	flaggedPostsCount,
	onOpenReportsTab,
	onOpenUsersTab,
}: AdminDailyBriefingProps) {
	const { toast } = useApp();
	const [period, setPeriod] = useState<"today" | "3days" | "week" | "month">("today");
	const [briefing, setBriefing] = useState<BriefingData | null>(null);
	const [briefingLoading, setBriefingLoading] = useState(false);
	const [escalatedUsers, setEscalatedUsers] = useState<EscalatedUser[]>([]);
	const [accountabilityLogs, setAccountabilityLogs] = useState<AccountabilityLog[]>([]);
	const [showAccountability, setShowAccountability] = useState(false);
	const [selectedUserToSuspend, setSelectedUserToSuspend] = useState<EscalatedUser | null>(null);
	const [suspendDays, setSuspendDays] = useState<number>(7);
	const [actionBusy, setActionBusy] = useState<string | null>(null);
	// Slang escalation scope decision: the admin picks the scope per user,
	// nothing is applied automatically.
	const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
	const [scopeChoice, setScopeChoice] = useState<Record<string, string>>({});
	const [pendingEscalations, setPendingEscalations] = useState(0);

	// Persisted local checkboxes for the to-do list
	const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>(() => {
		try {
			const saved = localStorage.getItem("vb:admin_todo_checks");
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});

	const toggleTask = (key: string) => {
		setCheckedTasks((prev) => {
			const next = { ...prev, [key]: !prev[key] };
			try {
				localStorage.setItem("vb:admin_todo_checks", JSON.stringify(next));
			} catch {
				/* ignore */
			}
			return next;
		});
	};

	// Load AI Executive Summary
	const fetchBriefing = useCallback(async (p = period) => {
		setBriefingLoading(true);
		try {
			const res = await api.post<{ briefing: BriefingData }>("/api/admin", {
				action: "ai_executive_summary",
				period: p,
			});
			if (res?.briefing) {
				setBriefing(res.briefing);
			}
		} catch (err: unknown) {
			console.warn("[AdminDailyBriefing] failed to fetch AI briefing", err);
		} finally {
			setBriefingLoading(false);
		}
	}, [period]);

	// Load 3-strike escalated users
	const fetchEscalatedUsers = useCallback(async () => {
		try {
			const res = await api.post<{
				users?: EscalatedUser[];
				pending_escalations?: unknown[];
				scopes?: ScopeOption[];
			}>("/api/admin", {
				action: "escalated_users",
			});
			const users = res?.users || [];
			setEscalatedUsers(users);
			setPendingEscalations(Array.isArray(res?.pending_escalations) ? res.pending_escalations.length : 0);
			if (Array.isArray(res?.scopes) && res.scopes.length > 0) setScopeOptions(res.scopes);
			// Seed a default scope per awaiting user (first option = full block),
			// preserving any choice already made in this session.
			setScopeChoice((prev) => {
				const next = { ...prev };
				for (const u of users) {
					if (u.escalation && !next[u.anon_id]) {
						next[u.anon_id] = res?.scopes?.[0]?.value ?? "full_block";
					}
				}
				return next;
			});
		} catch {
			/* best effort */
		}
	}, []);

	// Load Administrative Accountability Log
	const fetchAccountability = useCallback(async (p = period) => {
		try {
			const res = await api.post<{ logs: AccountabilityLog[] }>("/api/admin", {
				action: "admin_accountability",
				period: p,
			});
			setAccountabilityLogs(res?.logs || []);
		} catch {
			/* best effort */
		}
	}, [period]);

	useEffect(() => {
		void fetchBriefing(period);
		void fetchEscalatedUsers();
		void fetchAccountability(period);
	}, [period, fetchBriefing, fetchEscalatedUsers, fetchAccountability]);

	// Execute suspension
	const handleSuspend = async (user: EscalatedUser, days: number) => {
		setActionBusy(`suspend:${user.anon_id}`);
		try {
			await api.post("/api/admin", {
				action: "update_user",
				anon_id: user.anon_id,
				suspend_days: days,
				notes: `Suspended for ${days} days due to repeated safety strikes (strikes: ${user.strikes}).`,
			});
			toast(
				days === 0
					? `Lifted suspension for ${user.anon_id.slice(0, 10)}…`
					: `User ${user.anon_id.slice(0, 10)}… suspended for ${days} day(s).`,
				"ok"
			);
			setSelectedUserToSuspend(null);
			void fetchEscalatedUsers();
			void fetchAccountability(period);
		} catch (err: unknown) {
			toast(err instanceof Error ? err.message : "Suspension action failed", "err");
		} finally {
			setActionBusy(null);
		}
	};

	// Slang escalation decision: apply a scope restriction, or dismiss it.
	// Nothing is ever auto-applied — the scope is an explicit admin choice.
	const handleResolve = async (user: EscalatedUser, decision: "apply" | "dismiss") => {
		const scope = scopeChoice[user.anon_id] || "full_block";
		setActionBusy(`resolve:${user.anon_id}`);
		try {
			await api.post("/api/admin", {
				action: "resolve_escalation",
				anon_id: user.anon_id,
				decision,
				scope: decision === "apply" ? scope : undefined,
				reason:
					decision === "apply"
						? `Repeated slang violations (${user.escalation?.violations ?? 0}); scope chosen by admin`
						: "Dismissed by admin after review",
			});
			toast(
				decision === "apply"
					? `Restricted ${user.anon_id.slice(0, 10)}… (${scope}).`
					: `Escalation for ${user.anon_id.slice(0, 10)}… dismissed.`,
				"ok",
			);
			void fetchEscalatedUsers();
			void fetchAccountability(period);
		} catch (err: unknown) {
			toast(err instanceof Error ? err.message : "Escalation decision failed", "err");
		} finally {
			setActionBusy(null);
		}
	};

	// Lift an existing restriction (and resolve any open escalation with it).
	const handleClearRestriction = async (user: EscalatedUser) => {
		setActionBusy(`lift:${user.anon_id}`);
		try {
			await api.post("/api/admin", {
				action: "clear_restriction",
				anon_id: user.anon_id,
			});
			toast(`Lifted restriction on ${user.anon_id.slice(0, 10)}…`, "ok");
			void fetchEscalatedUsers();
			void fetchAccountability(period);
		} catch (err: unknown) {
			toast(err instanceof Error ? err.message : "Could not lift restriction", "err");
		} finally {
			setActionBusy(null);
		}
	};

	// Generate dynamic To-Do Items
	const todoItems = [
		{
			id: "reports",
			title: `Resolve open user reports (${openReportsCount} pending)`,
			urgent: openReportsCount > 0,
			autoComplete: openReportsCount === 0,
			actionLabel: "Review Reports",
			action: onOpenReportsTab,
		},
		{
			id: "escalations",
			title: `Review 3-strike escalated users (${escalatedUsers.length} requiring decision)`,
			urgent: escalatedUsers.length > 0,
			autoComplete: escalatedUsers.length === 0,
			actionLabel: "Audit Users",
			action: onOpenUsersTab || onOpenReportsTab,
		},
		{
			id: "reviews",
			title: `Audit flagged content submissions (${flaggedPostsCount} flagged)`,
			urgent: flaggedPostsCount > 0,
			autoComplete: flaggedPostsCount === 0,
			actionLabel: "Content Review",
			action: onOpenReportsTab,
		},
		{
			id: "health",
			title: "Verify community health and latest solving board resolutions",
			urgent: false,
			autoComplete: false,
			actionLabel: "View Board",
			action: () => window.location.assign("/#/board"),
		},
	];

	const completedCount = todoItems.filter(
		(t) => t.autoComplete || checkedTasks[t.id]
	).length;
	const progressPct = Math.round((completedCount / todoItems.length) * 100);

	return (
		<div className="space-y-4 mb-6">
			{/* ── 3-Strike Immediate Escalation Popup Banner ── */}
			{escalatedUsers.length > 0 && (
				<div className="rounded-2xl border-2 border-bad/40 bg-bad/5 p-4 sm:p-5 shadow-sm animate-in fade-in">
					<div className="flex flex-wrap items-center justify-between gap-3 mb-3">
						<div className="flex items-center gap-2.5">
							<span className="w-8 h-8 rounded-xl bg-bad/10 text-bad flex items-center justify-center font-bold">
								<ShieldAlert size={18} />
							</span>
							<div>
								<h2 className="text-sm font-bold text-bad flex items-center gap-2">
									3-Strike Escalation Alert
									<span className="text-[10px] bg-bad text-white px-2 py-0.5 rounded-full font-bold">
										{escalatedUsers.length} Repeat Violator(s)
									</span>
									{pendingEscalations > 0 && (
										<span className="text-[10px] bg-warn text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
											{pendingEscalations} awaiting scope decision
										</span>
									)}
								</h2>
								<p className="text-xs text-ink3 mt-0.5">
									Students who accumulated 3 or more warnings, threats, or heavy slang violations. Action required.
								</p>
							</div>
						</div>
					</div>

					<div className="divide-y divide-border/60 bg-surface/80 rounded-xl border border-border/70 overflow-hidden">
						{escalatedUsers.slice(0, 5).map((user) => {
							const isSuspended =
								user.suspended_until &&
								new Date(user.suspended_until).getTime() > Date.now();
							const awaiting = !!user.escalation && user.escalation.status !== "resolved";
							const restricted = !!user.restriction && user.restriction.active !== false;
							const busy = actionBusy === `resolve:${user.anon_id}` || actionBusy === `lift:${user.anon_id}`;
							return (
								<div
									key={user.anon_id}
									className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-mono font-bold text-ink">
												{user.anon_id.slice(0, 16)}…
											</span>
											<span className="px-1.5 py-0.5 rounded-full bg-warn/15 text-warn text-[10px] font-bold">
												{user.strikes} strikes
											</span>
											{user.escalation?.violations ? (
												<span className="px-1.5 py-0.5 rounded-full bg-bad/15 text-bad text-[10px] font-bold">
													{user.escalation.violations} slang violation{user.escalation.violations > 1 ? "s" : ""}
												</span>
											) : null}
											{isSuspended && (
												<span className="px-1.5 py-0.5 rounded-full bg-bad/15 text-bad text-[10px] font-bold">
													Suspended until {new Date(user.suspended_until!).toLocaleDateString()}
												</span>
											)}
											{restricted && (
												<span className="px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-bold">
													Restricted: {user.restriction?.scope || "full_block"}
												</span>
											)}
										</div>
										{user.escalation?.terms && user.escalation.terms.length > 0 && (
											<p className="text-[11px] text-ink3 mt-1">
												Terms:{" "}
												<span className="font-mono text-bad">
													{user.escalation.terms.slice(0, 8).join(", ")}
												</span>
												{user.escalation.terms.length > 8 ? " …" : ""}
											</p>
										)}
										{user.warnings && user.warnings.length > 0 && user.warnings[user.warnings.length - 1] && (
											<p className="text-[11px] text-ink3 mt-1 italic">
												Latest violation: &ldquo;{user.warnings[user.warnings.length - 1]!.text}&rdquo; ({timeAgo(user.warnings[user.warnings.length - 1]!.at)})
											</p>
										)}
									</div>

									<div className="flex flex-wrap items-center gap-2">
										{awaiting ? (
											<>
												<label className="sr-only" htmlFor={`scope-${user.anon_id}`}>
													Restriction scope
												</label>
												<select
													id={`scope-${user.anon_id}`}
													value={scopeChoice[user.anon_id] || "full_block"}
													onChange={(e) =>
														setScopeChoice((prev) => ({ ...prev, [user.anon_id]: e.target.value }))
													}
													disabled={busy}
													className="text-[11px] font-bold rounded-lg border border-border bg-surface px-2 py-1.5 text-ink focus:border-accent focus:outline-none"
												>
													{scopeOptions.map((s) => (
														<option key={s.value} value={s.value}>
															{s.label}
														</option>
													))}
												</select>
												<button
													type="button"
													disabled={busy}
													onClick={() => void handleResolve(user, "apply")}
													className="btn btn-primary !text-xs !py-1 !px-2.5 flex items-center gap-1.5"
												>
													<Shield size={13} /> Apply
												</button>
												<button
													type="button"
													disabled={busy}
													onClick={() => void handleResolve(user, "dismiss")}
													className="btn btn-soft !text-xs !py-1 !px-2.5 flex items-center gap-1.5"
												>
													<CheckCircle2 size={13} /> Dismiss
												</button>
											</>
										) : (
											<button
												type="button"
												onClick={() => setSelectedUserToSuspend(user)}
												className="btn btn-soft !text-xs !py-1 !px-2.5 flex items-center gap-1.5 text-bad hover:bg-bad/10"
											>
												<UserX size={13} /> Decide Suspension
											</button>
										)}
										{restricted && (
											<button
												type="button"
												disabled={busy}
												onClick={() => void handleClearRestriction(user)}
												className="btn btn-soft !text-xs !py-1 !px-2.5 flex items-center gap-1.5 text-good hover:bg-good/10"
											>
												<RefreshCcw size={13} /> Lift
											</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* ── Suspension Modal Dialog ── */}
			{selectedUserToSuspend && (
				<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
					<div className="card max-w-md w-full p-5 space-y-4 shadow-xl border border-border bg-surface">
						<div className="flex items-center justify-between">
							<h3 className="font-display font-bold text-base text-ink flex items-center gap-2">
								<Gavel size={18} className="text-bad" /> Disciplinary Suspension
							</h3>
							<button
								type="button"
								onClick={() => setSelectedUserToSuspend(null)}
								className="text-ink3 hover:text-ink text-sm font-bold"
							>
								✕
							</button>
						</div>

						<p className="text-xs text-ink2">
							User <span className="font-mono font-bold text-accent">{selectedUserToSuspend.anon_id}</span> has accumulated <strong className="text-bad">{selectedUserToSuspend.strikes} strikes</strong>.
							Choose suspension duration:
						</p>

						<div className="grid grid-cols-3 gap-2">
							{[1, 3, 7, 14, 30].map((days) => (
								<button
									key={days}
									type="button"
									onClick={() => setSuspendDays(days)}
									className={`py-2 px-3 text-xs rounded-xl font-bold border transition-all ${
										suspendDays === days
											? "btn-primary shadow-sm"
											: "btn-ghost border-border hover:bg-surface2"
									}`}
								>
									{days} Day{days > 1 ? "s" : ""}
								</button>
							))}
							<button
								type="button"
								onClick={() => setSuspendDays(0)}
								className={`py-2 px-3 text-xs rounded-xl font-bold border transition-all ${
									suspendDays === 0
										? "btn-soft border-good text-good"
										: "btn-ghost border-border hover:bg-surface2"
								}`}
							>
								Clear / 0 Days
							</button>
						</div>

						<div className="flex justify-end gap-2 pt-2 border-t border-border">
							<button
								type="button"
								onClick={() => setSelectedUserToSuspend(null)}
								className="btn btn-ghost !text-xs"
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={actionBusy !== null}
								onClick={() => void handleSuspend(selectedUserToSuspend, suspendDays)}
								className="btn btn-primary !bg-bad hover:!bg-bad/90 !text-xs"
							>
								{suspendDays === 0 ? "Lift Suspension" : `Confirm ${suspendDays}-Day Suspension`}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── AI Executive Daily Summary & AI To-Do List Grid ── */}
			<div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
				{/* Column 1: AI Executive Briefing (7 cols) */}
				<div className="lg:col-span-7 card p-5 border border-border/80 bg-gradient-to-br from-surface via-surface to-accent/5 shadow-xs flex flex-col justify-between">
					<div>
						<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
							<div className="flex items-center gap-2">
								<span className="w-7 h-7 rounded-lg bg-accent/15 text-accent flex items-center justify-center font-bold">
									<Sparkles size={15} className="animate-spin" />
								</span>
								<h2 className="font-display font-bold text-sm tracking-tight text-ink">
									Executive Community Briefing
								</h2>
								<span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ink3 bg-surface2 px-2 py-0.5 rounded-full">
									Generated from live data on load
								</span>
							</div>

							{/* Period Selector: Today, 3 Days, Week, Month */}
							<div className="inline-flex p-0.5 bg-surface2 rounded-lg text-[10px] font-semibold border border-border/60">
								{(["today", "3days", "week", "month"] as const).map((p) => (
									<button
										key={p}
										type="button"
										onClick={() => setPeriod(p)}
										className={`px-2 py-1 rounded-md transition-all ${
											period === p ? "bg-surface shadow-xs text-ink font-bold" : "text-ink3 hover:text-ink"
										}`}
									>
										{p === "today" ? "Today" : p === "3days" ? "3 Days" : p === "week" ? "Week" : "Month"}
									</button>
								))}
							</div>
						</div>

						{briefingLoading ? (
							<div className="space-y-2 py-3">
								<div className="skeleton h-5 w-3/4" />
								<div className="skeleton h-12 w-full" />
								<div className="skeleton h-6 w-1/2" />
							</div>
						) : briefing ? (
							<div className="space-y-3">
								<h3 className="text-xs font-bold text-accent uppercase tracking-wide">
									{briefing.headline}
								</h3>
								<p className="text-xs text-ink2 leading-relaxed">
									{briefing.summary}
								</p>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
									<div className="p-2.5 rounded-xl bg-surface2/60 border border-border/60">
										<div className="text-[10px] font-bold uppercase tracking-wider text-ink3 flex items-center gap-1 mb-1">
											<Shield size={11} className="text-accent" /> Safety & Health Pulse
										</div>
										<p className="text-[11px] text-ink2">
											{briefing.safety_pulse}
										</p>
									</div>

									<div className="p-2.5 rounded-xl bg-surface2/60 border border-border/60">
										<div className="text-[10px] font-bold uppercase tracking-wider text-ink3 flex items-center gap-1 mb-1">
											<Gavel size={11} className="text-accent" /> Admin Accountability
										</div>
										<p className="text-[11px] text-ink2">
											{briefing.admin_actions_summary}
										</p>
									</div>
								</div>
							</div>
						) : (
							<p className="text-xs text-ink3 italic py-4">
								Click refresh to generate the AI briefing for this period.
							</p>
						)}
					</div>

					<div className="flex items-center justify-between gap-2 pt-4 mt-3 border-t border-border/60 text-[11px] text-ink3">
						<button
							type="button"
							onClick={() => setShowAccountability((v) => !v)}
							className="text-accent hover:underline flex items-center gap-1 font-semibold"
						>
							<FileText size={12} /> {showAccountability ? "Hide" : "View"} Full Administrative Audit Log
						</button>
						<button
							type="button"
							disabled={briefingLoading}
							onClick={() => void fetchBriefing(period)}
							className="inline-flex items-center gap-1 text-ink2 hover:text-ink font-semibold"
						>
							<RefreshCcw size={12} className={briefingLoading ? "animate-spin" : ""} /> Refresh Briefing
						</button>
					</div>
				</div>

				{/* Column 2: AI Moderator Daily To-Do List (5 cols) */}
				<div className="lg:col-span-5 card p-5 border border-border/80 bg-surface shadow-xs flex flex-col justify-between">
					<div>
						<div className="flex items-center justify-between mb-3">
							<div className="flex items-center gap-2">
								<span className="w-7 h-7 rounded-lg bg-good/15 text-good flex items-center justify-center font-bold">
									<CheckCircle2 size={16} />
								</span>
								<div>
									<h2 className="font-display font-bold text-sm tracking-tight text-ink">
										AI Moderator To-Do List
									</h2>
									<p className="text-[10px] text-ink3">
										Auto-prioritized tasks based on live platform state
									</p>
								</div>
							</div>
							<span className="text-xs font-bold text-accent">
								{completedCount}/{todoItems.length}
							</span>
						</div>

						{/* Progress Bar */}
						<div className="w-full bg-surface2 rounded-full h-1.5 mb-4 overflow-hidden">
							<div
								className="bg-accent h-full rounded-full transition-all duration-300"
								style={{ width: `${progressPct}%` }}
							/>
						</div>

						{/* Checklist */}
						<div className="space-y-2">
							{todoItems.map((item) => {
								const isDone = item.autoComplete || checkedTasks[item.id];
								return (
									<div
										key={item.id}
										className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 transition-all ${
											isDone
												? "bg-surface2/30 border-border/40 opacity-70"
												: item.urgent
												? "bg-bad/5 border-bad/30"
												: "bg-surface2/60 border-border"
										}`}
									>
										<div className="flex items-center gap-2 min-w-0">
											<input
												type="checkbox"
												checked={isDone}
												onChange={() => toggleTask(item.id)}
												className="rounded border-border text-accent focus:ring-accent cursor-pointer"
												aria-label={item.title}
											/>
											<span
												className={`truncate text-[11px] ${
													isDone ? "line-through text-ink3" : "font-medium text-ink"
												}`}
											>
												{item.title}
											</span>
										</div>

										<button
											type="button"
											onClick={item.action}
											className="btn btn-ghost !text-[10px] !py-0.5 !px-2 shrink-0 flex items-center gap-1 hover:text-accent"
										>
											{item.actionLabel} <ArrowRight size={10} />
										</button>
									</div>
								);
							})}
						</div>
					</div>

					<p className="text-[10px] text-ink3 mt-4 text-center italic">
						Tasks automatically resolve as reports and community items are handled.
					</p>
				</div>
			</div>

			{/* ── Full Administrative Accountability & Suspension Log Table ── */}
			{showAccountability && (
				<div className="card p-5 border border-border/80 bg-surface shadow-xs animate-in fade-in space-y-3">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="font-display font-bold text-sm text-ink flex items-center gap-2">
								<FileText size={16} className="text-accent" /> Full Administrative Accountability & Moderation Log
							</h3>
							<p className="text-xs text-ink3 mt-0.5">
								Verifiable, timestamped record of every administrative action (suspensions, warnings, hides) taken this {period}.
							</p>
						</div>
						<button
							type="button"
							onClick={() => void fetchAccountability(period)}
							className="btn btn-ghost !text-xs !py-1 !px-2 flex items-center gap-1"
						>
							<RefreshCcw size={11} /> Refresh Log
						</button>
					</div>

					{accountabilityLogs.length === 0 ? (
						<p className="text-xs text-ink3 italic py-3 text-center">
							No administrative disciplinary actions recorded during this period.
						</p>
					) : (
						<div className="max-h-60 overflow-y-auto divide-y divide-border text-xs border border-border rounded-xl">
							{accountabilityLogs.map((log) => (
								<div key={log.id} className="p-3 flex items-start justify-between gap-3 hover:bg-surface2/50">
									<div className="space-y-0.5 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-bold text-accent uppercase tracking-wider text-[10px] px-1.5 py-0.2 rounded bg-accent/10">
												{log.action}
											</span>
											<span className="text-ink font-mono text-[11px] truncate">
												{log.detail || "No details recorded"}
											</span>
										</div>
									</div>
									<span className="text-[10px] text-ink3 shrink-0 flex items-center gap-1">
										<Clock size={10} /> {timeAgo(log.created_at)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
