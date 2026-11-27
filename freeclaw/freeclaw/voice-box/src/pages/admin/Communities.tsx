import { Eye, EyeOff, Loader2, RefreshCw, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";

interface AdminCommunity {
	slug: string;
	name: string;
	description?: string;
	avatar?: string;
	hidden?: boolean;
	member_count?: number;
	post_count?: number;
	created_at?: string;
	created_by?: string;
}

/**
 * Admin → Communities: identify and view every community, including hidden
 * ones (the list endpoint already hides them from non-admins server-side).
 * Read-only directory — moderation happens on the community page itself.
 */
export default function Communities() {
	const { toast } = useApp();
	const [rows, setRows] = useState<AdminCommunity[]>([]);
	const [loading, setLoading] = useState(true);
	const [busySlug, setBusySlug] = useState<string | null>(null);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		try {
			setError("");
			setLoading(true);
			const d = await api.get<{ communities?: AdminCommunity[] }>(
				"/api/communities?action=list",
			);
			setRows(Array.isArray(d.communities) ? d.communities : []);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Failed to load communities");
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const toggleHide = async (slug: string, currentHidden: boolean) => {
		if (busySlug) return;
		setBusySlug(slug);
		try {
			await api.post("/api/communities", {
				action: "admin",
				slug,
				op: currentHidden ? "unhide" : "hide",
			});
			setRows((prev) =>
				prev.map((r) => (r.slug === slug ? { ...r, hidden: !currentHidden } : r)),
			);
			toast(currentHidden ? "Community restored to public list" : "Community hidden from public", "ok");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Failed to update community visibility", "err");
		} finally {
			setBusySlug(null);
		}
	};

	const deleteCommunity = async (slug: string, name: string) => {
		if (busySlug) return;
		if (!window.confirm(`Are you sure you want to permanently delete community "${name}"? This action cannot be undone.`)) {
			return;
		}
		setBusySlug(slug);
		try {
			await api.post("/api/communities", {
				action: "admin",
				slug,
				op: "delete",
			});
			setRows((prev) => prev.filter((r) => r.slug !== slug));
			toast(`Community "${name}" deleted`, "ok");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Failed to delete community", "err");
		} finally {
			setBusySlug(null);
		}
	};

	const visible = rows.filter((r) => !r.hidden).length;

	return (
		<div>
			<div className="flex items-center justify-between gap-3 flex-wrap mb-1">
				<h2 className="font-display font-bold text-xl flex items-center gap-2">
					<Users size={20} className="text-accent" /> Communities
					<span className="chip !text-[10px]">
						{rows.length} total · {visible} visible
					</span>
				</h2>
				<button
					type="button"
					className="btn btn-ghost !py-2 !text-xs"
					onClick={() => void load()}
					disabled={loading}
					aria-label="Refresh communities"
				>
					<RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
				</button>
			</div>
			<p className="text-xs text-ink3 mb-4">
				Every community at a glance — hidden ones included. Open one to
				moderate it on its own page.
			</p>

			{error && (
				<div className="card p-6 text-center" role="alert">
					<p className="text-bad text-sm">{error}</p>
					<button className="btn btn-soft mt-3" onClick={() => void load()}>
						Retry
					</button>
				</div>
			)}
			{loading && (
				<div className="space-y-2" aria-hidden>
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			)}
			{!loading && !error && rows.length === 0 && (
				<div className="card p-10 text-center">
					<p className="text-3xl mb-2">🌐</p>
					<p className="font-display font-semibold">No communities yet</p>
					<p className="text-xs text-ink3 mt-1">
						They appear here as soon as students create them.
					</p>
				</div>
			)}
			{!loading && !error && rows.length > 0 && (
				<div className="space-y-2" role="list" aria-label="All communities">
					{rows.map((c, i) => (
						<div key={c.slug ? `${c.slug}-${i}` : `comm-${i}`} role="listitem" className="card p-3.5 flex items-center gap-3">
							<span className="text-xl shrink-0" aria-hidden>
								{c.avatar || "🌐"}
							</span>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold truncate flex items-center gap-2">
									{c.name}
									{c.hidden && (
										<span className="chip !text-[9px] !py-0.5 inline-flex items-center gap-1 text-warn">
											<EyeOff size={10} /> Hidden
										</span>
									)}
								</p>
								<p className="text-[11px] text-ink3 truncate">
									/{c.slug} · {c.member_count ?? 0} members ·{" "}
									{c.post_count ?? 0} posts
									{c.created_at ? ` · ${timeAgo(c.created_at)}` : ""}
								</p>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
								<Link
									to={`/communities/${c.slug}`}
									className="btn btn-soft !text-xs !py-1.5 inline-flex items-center gap-1.5"
									aria-label={`Open ${c.name}`}
								>
									<Eye size={12} /> Open
								</Link>
								<button
									type="button"
									onClick={() => toggleHide(c.slug, !!c.hidden)}
									disabled={busySlug === c.slug}
									className={`btn !text-xs !py-1.5 inline-flex items-center gap-1.5 ${
										c.hidden
											? "btn-soft !text-emerald-800 hover:!bg-emerald-500/10"
											: "btn-ghost !text-amber-600 hover:!bg-amber-500/10"
									}`}
									title={c.hidden ? "Unhide community" : "Hide community from public"}
								>
									{busySlug === c.slug ? (
										<Loader2 size={12} className="animate-spin" />
									) : c.hidden ? (
										<>
											<Eye size={12} /> Unhide
										</>
									) : (
										<>
											<EyeOff size={12} /> Hide
										</>
									)}
								</button>
								<button
									type="button"
									onClick={() => deleteCommunity(c.slug, c.name)}
									disabled={busySlug === c.slug}
									className="btn btn-ghost !text-xs !py-1.5 !text-bad hover:!bg-bad/10 inline-flex items-center gap-1"
									title="Permanently delete community"
								>
									<Trash2 size={12} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
