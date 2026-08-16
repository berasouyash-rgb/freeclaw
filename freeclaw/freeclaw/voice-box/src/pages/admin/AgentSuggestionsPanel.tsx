// ─── AI Management Suggestions — main dashboard panel ─────────────
// Surfaces the approval-only agent (api/_agent.js) on the main admin
// dashboard. The agent DRAFTS actions (escalate, status change, official
// reply, merge duplicate). Approving APPLIES the change and writes an
// audit log; dismissing archives it. The agent never acts on its own.

import type { LucideIcon } from "lucide-react";
import {
	Activity,
	AlertTriangle,
	Ban,
	Bot,
	Check,
	Clock,
	EyeOff,
	Flag,
	GitMerge,
	Inbox,
	Lightbulb,
	Loader2,
	MessageSquare,
	MessageSquareWarning,
	RefreshCcw,
	ShieldAlert,
	UserMinus,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import {
	isExecutableSuggestion,
	safeStringify,
	suggestionEffect,
	timeAgo,
} from "../../lib/utils";

interface AgentSuggestion {
	id: number;
	kind: string;
	title: string;
	reasoning: string;
	content?: Record<string, string>;
	critical?: boolean;
	status: "pending" | "approved" | "dismissed" | string;
	confidence?: number;
	outcome?: string;
	created_at: string;
}

const KIND_META: Record<
	string,
	{ label: string; icon: LucideIcon; color: string }
> = {
	status_change: {
		label: "Status change",
		icon: Activity,
		color: "var(--vb-accent)",
	},
	solved_confirm: {
		label: "Confirm solved",
		icon: Check,
		color: "var(--vb-good)",
	},
	escalation: { label: "Escalation", icon: Flag, color: "var(--vb-bad)" },
	reply: { label: "Reply draft", icon: MessageSquare, color: "var(--vb-good)" },
	merge: { label: "Merge duplicate", icon: GitMerge, color: "var(--vb-warn)" },
	user_warn: { label: "User warning", icon: ShieldAlert, color: "#d98a0b" },
	user_suspend: { label: "User suspension", icon: UserMinus, color: "#dc4b4b" },
	user_ban: { label: "User ban", icon: Ban, color: "#dc4b4b" },
	hide_comment: { label: "Hide comment", icon: EyeOff, color: "#8b5cf6" },
	resolve_report: {
		label: "Close reports",
		icon: Inbox,
		color: "var(--vb-good)",
	},
	review_decision: {
		label: "Review queue",
		icon: MessageSquareWarning,
		color: "#8b5cf6",
	},
};

// ─── Condition-based grouping (spec §18) ────────────────────────────
// Related work is combined into ONE card per detected condition instead of
// a repetitive list — e.g. 11 flagged posts render as one group titled
// "11 flagged posts require moderation triage", with each item still
// individually approvable inside. Titles are count-aware (singular/plural).
const GROUP_META: Record<
	string,
	{ title: (n: number) => string; summary: string }
> = {
	escalation: {
		title: (n) =>
			`${n} flagged post${n === 1 ? "" : "s"} require${n === 1 ? "s" : ""} moderation triage`,
		summary:
			"Safety-sensitive or multi-reported posts awaiting priority escalation.",
	},
	status_change: {
		title: (n) =>
			`${n} post${n === 1 ? "" : "s"} await${n === 1 ? "s" : ""} verification`,
		summary: "Posts with community engagement that have not been triaged yet.",
	},
	solved_confirm: {
		title: (n) =>
			`${n} solved post${n === 1 ? "" : "s"} await${n === 1 ? "s" : ""} confirmation`,
		summary: "Posts marked solved that should be confirmed for the community.",
	},
	reply: {
		title: (n) =>
			`${n} solved post${n === 1 ? "" : "s"} await${n === 1 ? "s" : ""} official repl${n === 1 ? "y" : "ies"}`,
		summary:
			"Resolved posts with no official reply — a short public response closes the loop.",
	},
	merge: {
		title: (n) => `${n} duplicate pair${n === 1 ? "" : "s"} detected`,
		summary: "Posts with strong title/body overlap in the same category.",
	},
	user_warn: {
		title: (n) =>
			`${n} user${n === 1 ? "" : "s"} require${n === 1 ? "s" : ""} warning review`,
		summary: "Accounts on the strike ladder that warrant a manual warning.",
	},
	user_suspend: {
		title: (n) => `${n} user${n === 1 ? "" : "s"} recommended for suspension`,
		summary: "Repeat offenders with 3+ strikes and no cooldown.",
	},
	hide_comment: {
		title: (n) =>
			`${n} flagged comment${n === 1 ? "" : "s"} recommended to hide`,
		summary:
			"Comments flagged by the moderation engine, still visible in threads.",
	},
	resolve_report: {
		title: (n) => `${n} stale report group${n === 1 ? "" : "s"} ready to close`,
		summary:
			"Reports pending longer than 7 days — closing keeps the queue focused on fresh issues.",
	},
	review_decision: {
		title: (n) =>
			`${n} pre-publish item${n === 1 ? "" : "s"} await${n === 1 ? "s" : ""} decision`,
		summary: "Quality-review queue items that have waited more than a day.",
	},
};

export default function AgentSuggestionsPanel() {
	const { toast } = useApp();
	const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [confirming, setConfirming] = useState<AgentSuggestion | null>(null);
	const [editText, setEditText] = useState("");

	const loadSuggestions = useCallback(async () => {
		try {
			const s = await api.get<AgentSuggestion[]>("/api/agent");
			setSuggestions(Array.isArray(s) ? s : []);
		} catch (e: unknown) {
			console.warn(
				"[AgentSuggestionsPanel] Failed to load suggestions:",
				e instanceof Error ? e.message : e,
			);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		loadSuggestions();
	}, [loadSuggestions]);

	// Live refresh: any insert/approve/dismiss from any admin tab shows here.
	useRealtime(["agent_suggestions"], () => loadSuggestions(), 800);

	const generateSuggestions = async () => {
		setBusy(true);
		try {
			const r = await api.post<{ created?: number }>("/api/agent", {
				action: "generate",
			});
			toast(
				r.created
					? `${r.created} new suggestion(s) drafted`
					: "No new suggestions right now",
				"ok",
			);
			await loadSuggestions();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Generate failed", "err");
		}
		setBusy(false);
	};

	const dismissSuggestion = async (id: number) => {
		try {
			await api.put<unknown>("/api/agent", { id, action: "dismiss" });
			await loadSuggestions();
			toast("Suggestion dismissed", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Dismiss failed", "err");
		}
	};

	// Group-level dismiss: archive every item in a condition group in one go
	// (safe — dismiss only archives, never changes platform state).
	const dismissGroup = async (items: AgentSuggestion[]) => {
		try {
			await Promise.all(
				items.map((s) =>
					api.put<unknown>("/api/agent", { id: s.id, action: "dismiss" }),
				),
			);
			await loadSuggestions();
			toast(
				`${items.length} suggestion${items.length === 1 ? "" : "s"} dismissed`,
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Dismiss failed", "err");
		}
	};

	const approveSuggestion = async (
		sug: AgentSuggestion,
		confirmed = false,
		edited?: string,
	) => {
		// Critical/safety suggestions require the explicit second-step confirmation.
		if (sug.critical && !confirmed) {
			setEditText(sug.content?.to || sug.content?.reply || "");
			setConfirming(sug);
			return;
		}
		try {
			await api.put<unknown>("/api/agent", {
				id: sug.id,
				action: "approve",
				confirmed: true,
				edited_text: edited,
			});
			setConfirming(null);
			await loadSuggestions();
			toast("Approved and applied", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Approve failed", "err");
		}
	};

	const pending = suggestions.filter((s) => s.status === "pending");
	const pendingExec = pending.filter((s) => isExecutableSuggestion(s.kind));
	const pendingAdvisory = pending.length - pendingExec.length;

	// Group related work by detected condition (kind). Groups containing
	// critical/safety items surface first, then by size (most affected first).
	// Free-text/advisory kinds (LLM-generated, e.g. 'enforcement'/'policy')
	// have NO executable approve action — they are collapsed into ONE advisory
	// group with dismiss-only items so the panel never floods with unactionable
	// cards, and the admin is never offered an "Approve" that would no-op.
	const executableGroups = pending
		.filter((s) => isExecutableSuggestion(s.kind))
		.reduce<Record<string, AgentSuggestion[]>>((acc, s) => {
			(acc[s.kind] ??= []).push(s);
			return acc;
		}, {});
	const advisoryItems = pending.filter((s) => !isExecutableSuggestion(s.kind));
	const groups = [
		...Object.entries(executableGroups).map(([kind, items]) => ({
			kind,
			items,
		})),
		...(advisoryItems.length
			? [{ kind: "advisory" as const, items: advisoryItems }]
			: []),
	].sort((a, b) => {
		const ac = a.items.some((s) => s.critical) ? 0 : 1;
		const bc = b.items.some((s) => s.critical) ? 0 : 1;
		return ac - bc || b.items.length - a.items.length;
	});

	return (
		<div className="card p-4 vb-rise">
			{/* Header */}
			<div className="flex items-center justify-between gap-2 flex-wrap mb-3">
				<h2 className="font-display font-semibold text-sm flex items-center gap-1.5">
					<Lightbulb size={14} className="text-accent" /> AI management
					suggestions
					{pendingExec.length > 0 && (
						<span className="chip !text-[10px] !bg-accent-soft !text-accent">
							{pendingExec.length} awaiting approval
						</span>
					)}
					{pendingAdvisory > 0 && (
						<span className="chip !text-[10px] !bg-surface !text-ink3">
							{pendingAdvisory} advisory
						</span>
					)}
				</h2>
				<button
					className="btn btn-primary !text-[11px] !py-1.5 !px-3"
					onClick={generateSuggestions}
					disabled={busy}
				>
					<RefreshCcw size={11} className={busy ? "animate-spin" : ""} />{" "}
					{busy ? "Drafting…" : "Generate suggestions"}
				</button>
			</div>
			<p className="text-[10px] text-ink3 mb-3 leading-relaxed">
				The AI drafts actions to keep the platform healthy. Nothing is applied
				until you approve — approving executes the change immediately and logs
				it in the activity trail.
			</p>

			{/* Loading skeleton */}
			{loading && (
				<div className="space-y-2">
					{[1, 2].map((i) => (
						<div key={i} className="skeleton h-24" />
					))}
				</div>
			)}

			{/* Empty state */}
			{!loading && pending.length === 0 && (
				<div className="text-center py-6">
					<Bot size={22} className="mx-auto text-ink3/30 mb-1.5" />
					<p className="text-[11px] text-ink3">
						No pending suggestions. Click “Generate suggestions” to scan the
						platform for improvements.
					</p>
				</div>
			)}

			{/* Suggestion cards — grouped by detected condition (spec §18) */}
			{!loading && pending.length > 0 && (
				<div className="space-y-2">
					{groups.map((g) => {
						const isAdvisory = g.kind === "advisory";
						const meta = isAdvisory
							? { icon: Bot, label: "Advisory note", color: "#8a8f98" }
							: (KIND_META[g.kind] ?? {
									icon: Bot,
									label: "Unknown",
									color: "#888",
								});
						const gmeta = isAdvisory
							? {
									title: (n: number) =>
										`${n} advisory note${n === 1 ? "" : "s"}`,
									summary:
										"Informational recommendations from the AI workforce — no automatic action. Review or dismiss.",
								}
							: GROUP_META[g.kind];
						const Icon = meta.icon;
						const hasCritical = g.items.some((s) => s.critical);
						return (
							<div
								key={g.kind}
								className="rounded-xl border border-border/60 bg-surface2/40 overflow-hidden"
							>
								{/* Group header — one card per condition, not one per item */}
								<div
									className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50"
									style={
										hasCritical
											? { background: "rgba(220,75,75,0.05)" }
											: undefined
									}
								>
									<span
										className="grid place-items-center w-7 h-7 rounded-lg shrink-0"
										style={{ background: meta.color + "1a", color: meta.color }}
									>
										<Icon size={13} />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-[11px] font-semibold leading-tight">
											{gmeta
												? gmeta.title(g.items.length)
												: `${g.items.length} ${meta.label.toLowerCase()} suggestion${g.items.length === 1 ? "" : "s"}`}
										</p>
										{gmeta && (
											<p
												className="text-[9px] text-ink3 leading-snug truncate"
												title={gmeta.summary}
											>
												{gmeta.summary}
											</p>
										)}
									</div>
									<span className="chip !text-[9px] shrink-0">
										{g.items.length} item{g.items.length === 1 ? "" : "s"}
									</span>
									{g.items.length > 1 && (
										<button
											type="button"
											className="btn btn-ghost !text-[9px] !py-0.5 !px-2 shrink-0"
											onClick={() => dismissGroup(g.items)}
											aria-label={`Dismiss all ${g.items.length} suggestions in this group`}
										>
											<X size={9} /> Dismiss all
										</button>
									)}
								</div>

								{/* Individual items — each still independently actionable */}
								<div className="divide-y divide-border/40">
									{g.items.map((s) => {
										const p = s.content || {};
										return (
											<div key={s.id} className="px-3 py-2.5">
												<div className="flex items-center gap-1.5 flex-wrap">
													<span
														className="text-[9px] px-1.5 py-0.5 rounded"
														style={{
															color: meta.color,
															background: meta.color + "14",
														}}
													>
														{meta.label}
													</span>
													{s.critical && (
														<span
															className="text-[9px] px-1.5 py-0.5 rounded border"
															style={{
																color: "var(--vb-bad)",
																borderColor: "rgba(220,75,75,0.3)",
															}}
														>
															Critical
														</span>
													)}
													<span className="ml-auto text-[8px] text-ink3 flex items-center gap-0.5">
														<Clock size={8} /> {timeAgo(s.created_at)}
													</span>
												</div>

												<p className="text-[11px] font-medium mt-1 leading-snug">
													{s.title}
												</p>

												{/* What approving will actually do — full consequence */}
												<div
													className="mt-1.5 rounded-md px-2.5 py-2 text-[10px] leading-relaxed"
													style={{
														background: isAdvisory
															? "rgba(138,143,152,0.08)"
															: "rgba(22,160,106,0.06)",
														border: isAdvisory
															? "1px solid rgba(138,143,152,0.2)"
															: "1px solid rgba(22,160,106,0.18)",
													}}
												>
													<span
														className="text-[9px] font-bold tracking-wider uppercase"
														style={{
															color: isAdvisory ? "#8a8f98" : "var(--vb-good)",
														}}
													>
														{isAdvisory ? "Note — " : "What this will do — "}
													</span>
													<span className="text-ink2">
														{suggestionEffect(s)}
													</span>
												</div>

												{/* Change preview: current → proposed (only for executable actions) */}
												{!isAdvisory && (
													<div className="rounded-md bg-surface px-2 py-1.5 mt-1.5 text-[10px]">
														<div className="flex items-center gap-1.5 flex-wrap">
															<span
																className="px-1.5 py-0.5 rounded text-[9px] font-mono line-through"
																style={{
																	background: "rgba(220,75,75,0.1)",
																	color: "var(--vb-bad)",
																}}
															>
																{String(p.from || "(current)").slice(0, 50) ||
																	"(empty)"}
															</span>
															<span className="text-ink3 text-[9px]">
																&#8594;
															</span>
															<span
																className="px-1.5 py-0.5 rounded text-[9px] font-mono"
																style={{
																	background: "rgba(22,160,106,0.1)",
																	color: "var(--vb-good)",
																}}
															>
																{String(
																	p.to ||
																		p.status ||
																		p.reply ||
																		safeStringify(p),
																).slice(0, 80)}
															</span>
														</div>
													</div>
												)}

												{/* Advisory detections carry their own suggested actions (proactive engine) */}
												{isAdvisory && (
													<>
														{typeof p.description === "string" &&
															p.description && (
																<p className="text-[9px] text-ink2 leading-relaxed mt-1.5">
																	{p.description}
																</p>
															)}
														{Array.isArray(
															(p as Record<string, unknown>).suggestedActions,
														) &&
															(
																(p as Record<string, unknown>)
																	.suggestedActions as string[]
															).length > 0 && (
																<div className="mt-1.5 space-y-1">
																	{(
																		(p as Record<string, unknown>)
																			.suggestedActions as string[]
																	)
																		.slice(0, 4)
																		.map((a: string, i: number) => (
																			<p
																				key={i}
																				className="text-[9px] px-1.5 py-0.5 rounded border border-border/50 inline-block mr-1"
																			>
																				{a}
																			</p>
																		))}
																</div>
															)}
													</>
												)}

												<p className="text-[9px] text-ink2 leading-relaxed mt-1.5">
													{s.reasoning}{" "}
													{typeof s.confidence === "number" && (
														<span className="text-ink3">
															({Math.round(s.confidence * 100)}% confident)
														</span>
													)}
												</p>

												<div className="flex gap-1.5 mt-2">
													{!isAdvisory && (
														<button
															className="btn !text-[9px] !py-1"
															style={{
																background: "rgba(22,160,106,0.12)",
																color: "var(--vb-good)",
															}}
															onClick={() => approveSuggestion(s)}
														>
															<Check size={10} />{" "}
															{s.critical ? "Review…" : "Approve & apply"}
														</button>
													)}
													<button
														className="btn btn-ghost !text-[9px] !py-1"
														onClick={() => dismissSuggestion(s.id)}
													>
														<X size={10} /> Dismiss
													</button>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Second-step confirmation for critical/safety suggestions */}
			{confirming && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
					role="dialog"
					aria-modal="true"
					aria-label="Confirm critical suggestion"
				>
					<div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-md p-5 m-4">
						<h3 className="font-display font-bold text-sm mb-3 flex items-center gap-2">
							<AlertTriangle size={16} className="text-amber-400" /> Critical
							suggestion — confirm
						</h3>
						<p className="text-sm text-ink2 leading-relaxed mb-3">
							{confirming.reasoning}
						</p>
						<div
							className="rounded-xl p-3 text-xs mb-3 leading-relaxed"
							style={{
								background: "rgba(22,160,106,0.07)",
								border: "1px solid rgba(22,160,106,0.2)",
								color: "var(--vb-good)",
							}}
						>
							<span className="font-bold uppercase text-[10px] tracking-wider">
								What this will do:{" "}
							</span>
							<span className="text-ink2">{suggestionEffect(confirming)}</span>
						</div>
						{confirming.kind === "reply" && (
							<>
								<label
									className="text-xs font-semibold text-ink2 block mb-1.5"
									htmlFor="edit-reply"
								>
									Edit reply before applying
								</label>
								{/* autoFocus + select-all: the cursor must land in the box the moment the modal opens */}
								<textarea
									id="edit-reply"
									className="input min-h-20 text-sm mb-3"
									value={editText}
									onChange={(e) => setEditText(e.target.value)}
									maxLength={1000}
									autoFocus
									onFocus={(e) => e.currentTarget.select()}
								/>
							</>
						)}
						<div
							className="rounded-xl p-3 text-xs mb-4"
							style={{
								background: "rgba(220,75,75,0.08)",
								border: "1px solid rgba(220,75,75,0.25)",
								color: "var(--vb-bad)",
							}}
						>
							This is flagged as a critical / safety-related change. Confirming
							will apply it immediately and record it in the audit log.
						</div>
						<div className="flex gap-2 justify-end">
							<button
								className="btn btn-ghost"
								onClick={() => setConfirming(null)}
							>
								Cancel
							</button>
							<button
								className="btn"
								style={{ background: "var(--vb-bad)", color: "#fff" }}
								onClick={() => approveSuggestion(confirming, true, editText)}
							>
								<Check size={14} /> Confirm &amp; apply
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Tiny loader for in-flight row actions */}
			{busy && !pending.length && (
				<div className="flex items-center justify-center gap-2 text-[10px] text-ink3 py-2">
					<Loader2 size={12} className="animate-spin" /> Scanning platform…
				</div>
			)}
		</div>
	);
}
