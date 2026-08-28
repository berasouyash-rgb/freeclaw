// Advanced Search — every post, comment and poll in one place.
import {
	BarChart3,
	FileText,
	Filter,
	MessageCircle,
	MessageSquare,
	Search as SearchIcon,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useCategories } from "../hooks/useCategories";
import { api } from "../lib/api";
import { CAT_EMOJI, STATUS_META, timeAgo } from "../lib/utils";

type SearchResult = {
	type: "post" | "comment" | "poll";
	id: string;
	title?: string;
	body?: string;
	description?: string;
	post_id?: string;
	category?: string;
	status?: string;
	tags?: string[];
	ptype?: string;
	created_at: string;
	relevance_score?: number;
};

const TYPE_OPTIONS = [
	{ value: "all", label: "Everything" },
	{ value: "posts", label: "Posts" },
	{ value: "comments", label: "Comments" },
	{ value: "polls", label: "Polls" },
];

export default function Search() {
	const categories = useCategories();
	const [q, setQ] = useState("");
	const [type, setType] = useState("all");
	const [category, setCategory] = useState("all");
	const [status, setStatus] = useState("all");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [searched, setSearched] = useState(false);

	const run = useCallback(
		async (
			overrides?: Partial<{
				q: string;
				type: string;
				category: string;
				status: string;
		}>,
		) => {
			const params = new URLSearchParams();
			const query = (overrides?.q ?? q).trim();
			const t = overrides?.type ?? type;
			const c = overrides?.category ?? category;
			const s = overrides?.status ?? status;
			if (query) params.set("q", query);
			if (t !== "all") params.set("type", t);
			if (c !== "all") params.set("category", c);
			if (s !== "all") params.set("status", s);
			params.set("viewer", "");
			setLoading(true);
			setError("");
			setSearched(true);
			try {
				const data = await api.get<{ results: SearchResult[]; total: number }>(
					`/api/search?${params.toString()}`,
				);
				setResults(data.results || []);
				setTotal(data.total || 0);
			} catch (e: unknown) {
				setError(e instanceof Error ? e.message : "Search failed");
				setResults([]);
				setTotal(0);
			}
			setLoading(false);
		},
		[q, type, category, status],
	);

	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	// Debounced instant search — fires 300ms after the user stops typing
	useEffect(() => {
		if (!q.trim()) {
			setResults([]);
			setTotal(0);
			setSearched(false);
			return;
		}
		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => run(undefined), 300);
		return () => clearTimeout(debounceRef.current);
	}, [q, run]);

	// Keyboard shortcut: / focuses the search input
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
				e.preventDefault();
				document.getElementById("advanced-search-input")?.focus();
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, []);

	const onSubmit = () => {
		clearTimeout(debounceRef.current);
		if (q.trim().length >= 1) run(undefined);
	};

	const filterChange = (
		key: "type" | "category" | "status",
		setter: (v: string) => void,
		v: string,
	) => {
		setter(v);
		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => run({ [key]: v }).catch(() => {}), 200);
	};

	const typeLabel = (r: SearchResult) =>
		r.type === "poll"
			? r.ptype === "ranked"
				? "Ranked poll"
				: "Poll"
			: r.type === "comment"
				? "Comment"
				: "Post";

	const breakdown = useMemo(() => {
		const counts = { posts: 0, comments: 0, polls: 0 };
		for (const r of results) {
			if (r.type === "post") counts.posts += 1;
			else if (r.type === "comment") counts.comments += 1;
			else counts.polls += 1;
		}
		return counts;
	}, [results]);

	// Insights-style stat tiles — only after a successful search with matches.
	const tiles =
		searched && !loading && !error && total > 0
			? [
					{
						label: "Matches",
						value: total,
						icon: SearchIcon,
						sub: "total results",
					},
					{
						label: "Posts",
						value: breakdown.posts,
						icon: FileText,
						sub: "issue posts",
					},
					{
						label: "Comments",
						value: breakdown.comments,
						icon: MessageCircle,
						sub: "on the board",
					},
					{
						label: "Polls",
						value: breakdown.polls,
						icon: BarChart3,
						sub: "active polls",
					},
				]
			: [];

	return (
		<div className="max-w-3xl mx-auto px-4 py-6 vb-page-enter">
			<div className="flex items-center gap-2.5 mb-5">
				<span className="vb-empty-icon !w-9 !h-9">
					<SearchIcon size={17} />
				</span>
				<div>
					<h1 className="font-display font-bold text-xl sm:text-2xl leading-tight">
						Advanced search
					</h1>
					<p className="text-xs text-ink3">
						Posts, comments and polls — filtered your way.
					</p>
				</div>
			</div>

			{/* Stat tiles — mirrors the Community insights dashboard */}
			{tiles.length > 0 && (
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
					{tiles.map(({ label, value, icon: Icon, sub }) => (
						<div key={label} className="card p-4 vb-rise">
							<div className="flex items-center gap-1.5 text-ink3 mb-2">
								<Icon size={13} />
								<span className="text-[10px] font-bold uppercase tracking-wider">
									{label}
								</span>
							</div>
							<p className="font-display font-bold text-2xl leading-none">
								{value.toLocaleString()}
							</p>
							<p className="text-[11px] text-ink3 mt-1.5">{sub}</p>
						</div>
					))}
				</div>
			)}

			<div className="card p-4 mb-4 space-y-3">
				<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 flex items-center gap-1.5">
					<Filter size={11} /> Filters
				</p>
				<div className="relative">
					<SearchIcon
						size={16}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
						aria-hidden
					/>
					<div className="relative">
						<input
							id="advanced-search-input"
							className="input !pl-9 !py-2.5 !pr-16"
							placeholder="Search everything… (press /)"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && onSubmit()}
							aria-label="Search everything"
						/>
						<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
							{q && (
								<button
									type="button"
									onClick={() => {
										setQ("");
										setResults([]);
										setSearched(false);
									}}
									className="text-ink3 hover:text-ink transition-colors"
									aria-label="Clear search"
								>
									<X size={14} />
								</button>
							)}
							<kbd className="hidden sm:inline-flex items-center gap-0.5 text-[9px] font-semibold text-ink3 border border-border rounded px-1 py-px">
								/
							</kbd>
						</div>
					</div>
				</div>
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
					<select
						className="input !py-2 text-sm"
						value={type}
						onChange={(e) => filterChange("type", setType, e.target.value)}
						aria-label="Filter by type"
					>
						{TYPE_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
					<select
						className="input !py-2 text-sm"
						value={category}
						onChange={(e) =>
							filterChange("category", setCategory, e.target.value)
						}
						aria-label="Filter by category"
					>
						<option value="all">All categories</option>
						{categories.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
					<select
						className="input !py-2 text-sm"
						value={status}
						onChange={(e) => filterChange("status", setStatus, e.target.value)}
						aria-label="Filter by status"
					>
						<option value="all">All statuses</option>
						{Object.entries(STATUS_META).map(([k, v]) => (
							<option key={k} value={k}>
								{v.label}
							</option>
						))}
					</select>

				</div>
				<button
					className="btn btn-primary w-full"
					onClick={onSubmit}
					disabled={loading || q.trim().length === 0}
				>
					{loading ? "Searching…" : "Search"}
				</button>
			</div>

			{/* Loading skeletons — same treatment as the insights dashboard */}
			{loading && searched && (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-20" />
					))}
				</div>
			)}

			{searched && !loading && !error && (
				<p className="text-xs text-ink3 mb-3" role="status">
					{total} {total === 1 ? "result" : "results"} for “{q.trim()}”
				</p>
			)}

			{error && (
				<div className="card p-6 text-center">
					<p className="text-bad font-medium text-sm">{error}</p>
					<button className="btn btn-soft mt-3" onClick={() => run(undefined)}>
						Retry
					</button>
				</div>
			)}

			{searched && !loading && !error && results.length === 0 && (
				<div className="card p-10 text-center vb-rise">
					<div className="vb-empty-icon">
						<MessageSquare size={28} />
					</div>
					<p className="font-display font-semibold">No results</p>
					<p className="text-sm text-ink3 mt-1">
						Try different keywords or loosen a filter.
					</p>
				</div>
			)}

			{!loading && (
				<div className="space-y-2.5">
					{results.map((r) => {
						const href =
							r.type === "post"
								? `/post/${r.id}`
								: r.type === "comment"
									? `/post/${r.post_id}`
									: "/polls";
						const title =
							r.type === "post"
								? r.title
								: r.type === "poll"
									? r.title
									: r.body;
						const sub =
							r.type === "post"
								? `${CAT_EMOJI[r.category || ""] || "📌"} ${r.category || ""} · ${STATUS_META[r.status || ""]?.label || r.status}`
								: r.type === "comment"
									? "Comment on a post"
									: r.ptype === "ranked"
										? "Ranked poll"
										: "Poll";
						const Icon =
							r.type === "post"
								? FileText
								: r.type === "comment"
									? MessageCircle
									: BarChart3;
						return (
							<Link
								key={`${r.type}-${r.id}`}
								to={href}
								className="card card-hover p-4 block vb-rise"
							>
								<div className="flex items-start gap-3">
									<span className="vb-empty-icon !w-8 !h-8 shrink-0">
										<Icon size={14} />
									</span>
									<div className="min-w-0 flex-1">
										<p className="font-semibold text-sm sm:text-base leading-snug line-clamp-2">
											{title}
										</p>
										{r.type === "post" && r.description && (
											<p className="text-sm text-ink3 mt-0.5 line-clamp-2">
												{r.description}
											</p>
										)}
										<p className="text-[11px] text-ink3 mt-1.5">
											<span className="chip !text-[10px] !py-0 mr-1.5">
												{typeLabel(r)}
											</span>
											{sub} · {timeAgo(r.created_at)}
										</p>
									</div>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
