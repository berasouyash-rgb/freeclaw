import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";

interface SlangLeader {
	anon_id: string;
	hits: number;
	terms: string[];
	items: number;
	strikes?: number;
	suspended?: boolean;
	banned?: boolean;
}

interface LeadersResponse {
	leaders: SlangLeader[];
	scanned: { posts: number; comments: number };
	strike_terms_threshold: number;
}

// Slang leaders — who uses the most slang, and what the system did.
// Counts come from the same scanSlang finder the write-time gates use, so
// this page can never drift from enforcement. Ranking is by total hits,
// not rate: short posts are not exempt ("regardless of length").
// Enforcement is automatic at write time (4+ unique slang terms in one
// blocked submission strikes the author; 3 strikes in a week suspends,
// 6 bans) — this page reports, it does not punish by hand.
export default function SlangLeaders() {
	const { toast } = useApp();
	const [leaders, setLeaders] = useState<SlangLeader[]>([]);
	const [scanned, setScanned] = useState<{ posts: number; comments: number } | null>(null);
	const [threshold, setThreshold] = useState(4);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);

	const load = useCallback(async () => {
		try {
			const r = await api.get<LeadersResponse>("/api/admin?action=slang_leaders");
			setLeaders(r.leaders ?? []);
			setScanned(r.scanned ?? null);
			setThreshold(r.strike_terms_threshold ?? 4);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to load slang leaders", "err");
		}
		setLoading(false);
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	const refresh = async () => {
		setRefreshing(true);
		try {
			await load();
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<h1 className="font-display font-bold text-xl tracking-tight">
					<span className="vb-gradient-text">Slang leaders</span>
				</h1>
				<button
					className="btn btn-soft !text-xs"
					onClick={() => void refresh()}
					disabled={refreshing}
					aria-label="Refresh slang leaders"
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
			</div>
			<p className="text-xs text-ink2 mb-4">
				Ranked by total slang hits across recent posts and comments. A blocked
				submission with {threshold}+ unique slang terms strikes its author
				automatically (3 strikes in a week suspends, 6 bans — all reversible
				in Users).
			</p>
			{loading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			) : leaders.length === 0 ? (
				<p className="card p-8 text-center text-sm text-ink3">
					No slang detected in recent content.
					{scanned && (
						<span className="block mt-1 text-xs">
							Scanned {scanned.posts} posts · {scanned.comments} comments.
						</span>
					)}
				</p>
			) : (
				<div className="space-y-2.5">
					{leaders.map((l, i) => (
						<div key={l.anon_id} className="card p-4" data-testid="slang-leader-row">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="text-sm font-semibold">
										<span className="text-ink3 font-mono mr-2">#{i + 1}</span>
										<span className="font-mono text-[13px]">{l.anon_id}</span>{" "}
										{l.banned ? (
											<span className="chip !text-[10px] ml-1 !text-bad">banned</span>
										) : l.suspended ? (
											<span className="chip !text-[10px] ml-1 !text-warn">suspended</span>
										) : (l.strikes ?? 0) > 0 ? (
											<span className="chip !text-[10px] ml-1">
												{l.strikes} strike{(l.strikes ?? 0) === 1 ? "" : "s"}
											</span>
										) : null}
									</p>
									<p className="text-xs text-ink3 mt-0.5">
										{l.hits} slang hits · {l.terms.length} unique terms · {l.items}{" "}
										{l.items === 1 ? "item" : "items"}
									</p>
									<p className="text-[11px] text-ink2 mt-1 truncate" title={l.terms.join(", ")}>
										{l.terms.slice(0, 8).join(", ")}
										{l.terms.length > 8 ? "…" : ""}
									</p>
								</div>
							</div>
						</div>
					))}
					{scanned && (
						<p className="text-[11px] text-ink3">
							Scanned {scanned.posts} posts · {scanned.comments} comments.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
