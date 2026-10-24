import { useEffect, useState } from "react";
import { api } from "../../lib/api";

/**
 * ReportTargetQuote — the reported content, quoted inline on a report row.
 *
 * Admins couldn't tell which post/comment a report was about: rows showed
 * target ids, never the words. This resolves post/comment/poll targets to
 * their title/body through the same read endpoints the rest of the desk
 * uses (single-post GET, one shared comments index, single-poll GET),
 * memoized per target so N rows about one target cost one fetch.
 *
 * Honest states only: loading shimmer, the quote, "no longer available"
 * (target deleted), or "couldn't load" (transient failure — never
 * presented as gone).
 */
interface Quote {
	title: string;
	body?: string;
	removed?: boolean; // moderation-hidden
	deleted?: boolean; // author soft-deleted
	review?: boolean; // pending_review — not public yet
	locked?: boolean; // comments locked
}

type Status =
	| { state: "loading" }
	| { state: "ready"; quote: Quote }
	| { state: "gone" }
	| { state: "error" };

const inflight = new Map<string, Promise<Quote | null>>();
let sharedCommentsPromise: Promise<
	Array<{
		id?: string;
		body?: string;
		text?: string;
		hidden?: boolean;
		deleted?: boolean;
		status?: string;
	}>
> | null = null;

/** Small status pill for WHY a reported target is not public */
function QuoteBadge({ text, color, bg }: { text: string; color: string; bg: string }) {
	return (
		<span
			className="mt-1 mr-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
			style={{ color, background: bg }}
		>
			{text}
		</span>
	);
}

/** Highlight flagged phrases or threats in quoted text with GPU-accelerated smooth styling */
function HighlightFlaggedText({ text, reason }: { text: string; reason?: string }) {
	if (!text) return null;

	const tokens: string[] = [
		"not leave you",
		"kill",
		"threat",
		"chhodunga nahi",
		"dekh lunga",
		"watch your back",
		"hate you",
		"idiot",
		"loser",
		"die",
		"nudes",
		"stalk",
		"stupid",
		"kys",
	];
	if (reason && reason.length > 3) {
		const reasonWords = reason.split(/\s+/).filter((w) => w.length > 3 && !/report|spam|other/i.test(w));
		tokens.push(...reasonWords);
	}

	const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
	const parts = text.split(pattern);

	if (parts.length <= 1) {
		return <>{text}</>;
	}

	return (
		<>
			{parts.map((part, i) => {
				const isMatch = tokens.some((t) => t.toLowerCase() === part.toLowerCase());
				if (isMatch) {
					return (
						<mark
							key={i}
							className="rounded px-1.5 py-0.5 font-bold bg-bad/20 text-bad border border-bad/30 inline-block shadow-xs transition-colors"
						>
							{part}
						</mark>
					);
				}
				return <span key={i}>{part}</span>;
			})}
		</>
	);
}

function loadQuote(
	targetType: string,
	targetId: string,
): Promise<Quote | null> {
	const key = `${targetType}:${targetId}`;
	const cached = inflight.get(key);
	if (cached) return cached;
	const job = (async (): Promise<Quote | null> => {
		try {
			if (targetType === "post") {
				const res = await api.get<{
					post?: {
						title?: string;
						description?: string;
						hidden?: boolean;
						deleted?: boolean;
						status?: string;
						locked?: boolean;
					} | null;
				}>(`/api/posts?id=${encodeURIComponent(targetId)}`);
				if (!res?.post) return null;
				return {
					title: res.post.title || "(untitled post)",
					body: res.post.description || "",
					removed: !!res.post.hidden && !res.post.deleted,
					deleted: !!res.post.deleted,
					review: String(res.post.status ?? "") === "pending_review",
					locked: !!res.post.locked,
				};
			}
			if (targetType === "comment") {
				if (!sharedCommentsPromise) {
					sharedCommentsPromise = api.get<
						Array<{
							id?: string;
							body?: string;
							text?: string;
							hidden?: boolean;
							deleted?: boolean;
							status?: string;
						}>
					>(`/api/comments?all=1`).catch((err) => {
						sharedCommentsPromise = null;
						throw err;
					});
				}
				const list = await sharedCommentsPromise;
				const found = (Array.isArray(list) ? list : []).find(
					(c) => String(c?.id) === String(targetId),
				);
				if (!found) return null;
				return {
					title: "Reported comment",
					body: String(found.body ?? found.text ?? ""),
					removed: !!found.hidden && !found.deleted,
					deleted: !!found.deleted,
					review: String(found.status ?? "") === "pending_review",
				};
			}
			if (targetType === "poll") {
				const rows = await api.get<Array<{ title?: string; hidden?: boolean; deleted?: boolean }>>(
					`/api/polls?ids=${encodeURIComponent(targetId)}`,
				);
				const row = (Array.isArray(rows) ? rows : [])[0];
				if (!row) return null;
				return {
					title: row.title || "(untitled poll)",
					removed: !!row.hidden && !row.deleted,
					deleted: !!row.deleted,
				};
			}
			return null;
		} catch {
			throw new Error("load-failed");
		}
	})();
	const guarded = job.catch((err: unknown) => {
		if (inflight.get(key) === guarded) inflight.delete(key);
		throw err;
	});
	inflight.set(key, guarded);
	return guarded;
}

/** Test-only: clear the module memo cache between cases. */
export function resetQuoteCacheForTests() {
	inflight.clear();
	sharedCommentsPromise = null;
}

export default function ReportTargetQuote({
	reportId,
	targetType,
	targetId,
	reason,
	isOpen = false,
}: {
	reportId: number | string;
	targetType: string;
	targetId: string;
	reason?: string;
	isOpen?: boolean;
}) {
	const [status, setStatus] = useState<Status>({ state: "loading" });

	useEffect(() => {
		let on = true;
		setStatus({ state: "loading" });
		loadQuote(targetType, targetId).then(
			(quote) => {
				if (!on) return;
				setStatus(quote ? { state: "ready", quote } : { state: "gone" });
			},
			() => {
				if (!on) return;
				setStatus({ state: "error" });
			},
		);
		return () => {
			on = false;
		};
	}, [targetType, targetId]);

	if (targetType !== "post" && targetType !== "comment" && targetType !== "poll")
		return null;

	return (
		<div
			data-testid={`report-quote-${reportId}`}
			className={`mt-2 rounded-xl border-l-4 px-3 py-2 text-xs transition-all duration-200 transform-gpu ${
				isOpen
					? "border-amber-500 bg-amber-500/10 dark:bg-amber-500/5 shadow-xs ring-1 ring-amber-500/20"
					: "border-border bg-surface2/40"
			}`}
		>
			<div className="flex items-center justify-between gap-2 mb-1">
				<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 flex items-center gap-1.5">
					<span className="inline-block w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]"></span>
					Reported {targetType}
				</p>
				{targetType === "post" && (
					<span className="text-[10px] text-ink3 font-mono opacity-80">
						id: {targetId.slice(0, 10)}…
					</span>
				)}
			</div>
			{status.state === "loading" && (
				<p className="text-ink3 opacity-70">Loading reported content…</p>
			)}
			{status.state === "ready" && (
				<>
					<p className="font-semibold text-ink leading-snug">
						<HighlightFlaggedText text={status.quote.title} reason={reason} />
					</p>
					{status.quote.deleted && (
						<QuoteBadge
							text="Deleted by its author — no reader can see it"
							color="#ff9d9d"
							bg="rgba(230,80,80,0.18)"
						/>
					)}
					{status.quote.removed && !status.quote.deleted && (
						<QuoteBadge
							text="Removed by moderation — hidden from readers"
							color="#e6c46a"
							bg="rgba(220,170,50,0.18)"
						/>
					)}
					{status.quote.review && (
						<QuoteBadge
							text="Under review — not public yet"
							color="#9dc0ff"
							bg="rgba(90,140,220,0.18)"
						/>
					)}
					{status.quote.locked && (
						<QuoteBadge
							text="Comments locked — readers can no longer comment"
							color="#d4d4d4"
							bg="rgba(150,150,150,0.18)"
						/>
					)}
					{status.quote.body && (
						<p className="text-ink2 mt-1 leading-relaxed line-clamp-3 bg-surface/40 p-2 rounded-lg border border-border/50">
							<HighlightFlaggedText text={status.quote.body} reason={reason} />
						</p>
					)}
				</>
			)}
			{status.state === "gone" && (
				<p className="text-ink3 italic">
					This {targetType} is no longer available — it was deleted.
				</p>
			)}
			{status.state === "error" && (
				<p className="text-ink3 italic">
					Couldn&apos;t load the reported {targetType} — open the detail to retry.
				</p>
			)}
		</div>
	);
}
