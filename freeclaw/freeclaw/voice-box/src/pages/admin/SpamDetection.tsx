// ═══════════════════════════════════════════════════════════════════
// SPAM DETECTION — real multi-signal analysis dashboard
// ═══════════════════════════════════════════════════════════════════
// Every number comes from real spam analysis — nothing is simulated.
// Shows: signal breakdowns, quarantined posts, audit trail, manual test.
// ═══════════════════════════════════════════════════════════════════

import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	Eye,
	Gavel,
	RefreshCcw,
	Shield,
	ShieldX,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";

interface SpamSignal {
	score: number;
	detail: string | null;
}

interface SpamDetection {
	text: string;
	spam_score: number;
	action: string;
	signals: Record<string, SpamSignal>;
	timestamp: string;
	source: string;
}

interface QuarantinedPost {
	id: string;
	title: string;
	category?: string;
	status: string;
	author_id: string;
	created_at: string;
}

interface AuditEntry {
	id: number;
	action: string;
	detail: string;
	created_at: string;
}

interface SpamData {
	recent_detections: SpamDetection[];
	quarantined_posts: QuarantinedPost[];
	audit_entries: AuditEntry[];
	summary: {
		detections_24h: number;
		quarantined: number;
	};
}

const DEFAULT_STYLE = { label: "Unknown", cls: "text-ink3 bg-surface2", icon: Shield } as const;
const ACTION_STYLES: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
	allow: { label: "Allowed", cls: "text-good bg-good/10", icon: CheckCircle2 },
	flag: { label: "Flagged", cls: "text-warn bg-warn/10", icon: AlertTriangle },
	review: { label: "Review", cls: "text-warn bg-warn/10", icon: Eye },
	quarantine: { label: "Quarantined", cls: "text-bad bg-bad/10", icon: ShieldX },
};

function ScoreBar({ score }: { score: number }) {
	const color = score >= 80 ? "bg-bad" : score >= 60 ? "bg-warn" : score >= 40 ? "bg-yellow-400" : "bg-good";
	return (
		<div className="flex items-center gap-2">
			<div className="flex-1 h-1.5 rounded-full bg-surface2 overflow-hidden">
				<div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
			</div>
			<span className="text-[10px] font-mono text-ink3 w-8 text-right">{score}</span>
		</div>
	);
}

export default function SpamDetection() {
	const { toast } = useApp();
	const [data, setData] = useState<SpamData | null>(null);
	const [loading, setLoading] = useState(true);
	const [testText, setTestText] = useState("");
	const [testResult, setTestResult] = useState<SpamDetection | null>(null);
	const [testing, setTesting] = useState(false);
	const [selectedDetection, setSelectedDetection] = useState<number | null>(null);

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const r = await api.get<SpamData>("/api/spam");
			setData(r);
		} catch {
			/* non-fatal */
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		loadData();
		const iv = setInterval(loadData, 30000);
		return () => clearInterval(iv);
	}, [loadData]);

	const runTest = async () => {
		if (!testText.trim()) return;
		setTesting(true);
		setTestResult(null);
		try {
			const r = await api.post<{ ok: boolean; result: SpamDetection }>("/api/spam", {
				title: testText,
				description: "",
				author_id: "admin-test",
			});
			setTestResult(r.result);
			toast("Spam analysis complete", "ok");
			loadData(); // refresh recent detections
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Test failed", "err");
		}
		setTesting(false);
	};

	const signals = testResult ? Object.entries(testResult.signals) : [];
	const signalLabels: Record<string, string> = {
		content_similarity: "Content Similarity",
		posting_velocity: "Posting Velocity",
		link_density: "Link Density",
		suspicious_urls: "Suspicious URLs",
		repetition: "Word Repetition",
		formatting: "Formatting Abuse",
		quality: "Content Quality",
	};

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-bad/10 flex items-center justify-center">
						<Shield size={18} className="text-bad" />
					</div>
					<div>
						<h1 className="font-display font-bold text-xl flex items-center gap-2">
							Spam Detection{" "}
							<span className="chip !text-[9px] !text-accent !border-accent/30">
								Real multi-signal analysis
							</span>
						</h1>
						<p className="text-[11px] text-ink3">
							Deterministic spam scoring — velocity, content similarity, link density, formatting, quality.
						</p>
					</div>
				</div>
				<button className="btn btn-ghost !text-xs" onClick={loadData} disabled={loading}>
					<RefreshCcw size={12} className={`mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
				</button>
			</div>

			{/* Summary cards */}
			{data && (
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<div className="card p-4">
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Detections (24h)</p>
						<p className="font-display font-bold text-2xl">{data.summary.detections_24h}</p>
					</div>
					<div className="card p-4">
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Quarantined</p>
						<p className="font-display font-bold text-2xl text-bad">{data.summary.quarantined}</p>
					</div>
					<div className="card p-4">
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Recent Detections</p>
						<p className="font-display font-bold text-2xl">{data.recent_detections.length}</p>
					</div>
					<div className="card p-4">
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-1">Audit Entries</p>
						<p className="font-display font-bold text-2xl">{data.audit_entries.length}</p>
					</div>
				</div>
			)}

			{/* Manual testing tool */}
			<div className="card p-5">
				<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
					<Sparkles size={14} className="text-accent" /> Test Spam Analysis
				</h2>
				<p className="text-[11px] text-ink3 mb-3">
					Enter text to see how the multi-signal spam detector scores it in real-time.
				</p>
				<div className="flex gap-2">
					<input
						className="input flex-1"
						placeholder="Type or paste content to analyze..."
						value={testText}
						onChange={(e) => setTestText(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && runTest()}
					/>
					<button className="btn btn-primary !px-4" onClick={runTest} disabled={testing || !testText.trim()}>
						{testing ? "Analyzing..." : "Analyze"}
					</button>
				</div>

				{/* Test result */}
				{testResult && (
					<div className="mt-4 p-4 rounded-xl bg-surface2/60 space-y-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="font-display font-bold text-lg">
									Score: {testResult.spam_score}
								</span>
								{(() => {
									const style = ACTION_STYLES[testResult.action] || DEFAULT_STYLE;
									const Icon = style.icon;
									return (
										<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${style.cls}`}>
											<Icon size={11} /> {style.label}
										</span>
									);
								})()}
							</div>
						</div>

						{/* Signal breakdown */}
						<div className="space-y-2">
							{signals.map(([key, signal]) => (
								<div key={key}>
									<div className="flex items-center justify-between text-[11px] mb-0.5">
										<span className="font-medium">{signalLabels[key] || key}</span>
										<span className="text-ink3">{signal.score}/100</span>
									</div>
									<ScoreBar score={signal.score} />
									{signal.detail && (
										<p className="text-[10px] text-warn mt-0.5">{signal.detail}</p>
									)}
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Recent detections from memory */}
			{data && data.recent_detections.length > 0 && (
				<div className="card p-5">
					<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
						<Bot size={14} className="text-accent" /> Recent Detections
					</h2>
					<div className="divide-y divide-border">
						{data.recent_detections.slice(0, 15).map((d, i) => {
							const style = ACTION_STYLES[d.action] || DEFAULT_STYLE;
							const Icon = style.icon;
							return (
								<details key={i} className="group py-2.5">
									<summary className="flex items-center gap-3 cursor-pointer">
										<span className={`shrink-0 w-7 h-7 rounded-lg grid place-items-center ${style.cls}`}>
											<Icon size={13} />
										</span>
										<div className="min-w-0 flex-1">
											<p className="text-xs font-semibold truncate">{d.text}</p>
											<p className="text-[10px] text-ink3">
												Score: {d.spam_score} · {d.source} · {timeAgo(d.timestamp)}
											</p>
										</div>
										<span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${style.cls}`}>
											{style.label}
										</span>
									</summary>
									{selectedDetection === i ? (
										<div className="ml-10 mt-2 space-y-1">
											{Object.entries(d.signals).map(([key, signal]) => (
												<div key={key} className="flex items-center gap-2 text-[10px]">
													<span className="text-ink3 w-28">{signalLabels[key] || key}</span>
													<ScoreBar score={signal.score} />
												</div>
											))}
										</div>
									) : (
										<button
											className="ml-10 text-[10px] text-accent hover:underline"
											onClick={() => setSelectedDetection(i)}
										>
											Show signals
										</button>
									)}
								</details>
							);
						})}
					</div>
				</div>
			)}

			{/* Quarantined posts */}
			{data && data.quarantined_posts.length > 0 && (
				<div className="card p-5">
					<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
						<ShieldX size={14} className="text-bad" /> Quarantined Posts
					</h2>
					<div className="divide-y divide-border">
						{data.quarantined_posts.map((p) => (
							<div key={p.id} className="py-2.5 flex items-center gap-3">
								<span className="shrink-0 w-7 h-7 rounded-lg bg-bad/10 text-bad grid place-items-center">
									<ShieldX size={13} />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-semibold truncate">{p.title}</p>
									<p className="text-[10px] text-ink3">
										{p.category || "—"} · {p.author_id?.slice(0, 10)} · {timeAgo(p.created_at)}
									</p>
								</div>
								<span className="chip !text-[9px] !text-bad !border-bad/30">
									Pending Review
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Audit trail */}
			{data && data.audit_entries.length > 0 && (
				<div className="card p-5">
					<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
						<Gavel size={14} className="text-accent" /> Spam Audit Trail
					</h2>
					<div className="divide-y divide-border">
						{data.audit_entries.slice(0, 20).map((e) => (
							<div key={e.id} className="py-2 flex items-center gap-3">
								<span className="shrink-0 w-7 h-7 rounded-lg bg-surface2 grid place-items-center text-ink3">
									<Gavel size={13} />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-semibold">{e.action.replace(/_/g, " ")}</p>
									<p className="text-[10px] text-ink3 truncate">{e.detail}</p>
								</div>
								<p className="text-[9px] text-ink3 shrink-0">{timeAgo(e.created_at)}</p>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Empty state */}
			{!loading && data && data.recent_detections.length === 0 && data.quarantined_posts.length === 0 && (
				<div className="card p-10 text-center">
					<p className="text-3xl mb-2">🛡️</p>
					<p className="text-sm font-semibold">No spam detections yet</p>
					<p className="text-xs text-ink3 mt-1">
						Spam detections appear here as users create posts. Use the test tool above to try the analyzer.
					</p>
				</div>
			)}
		</div>
	);
}
