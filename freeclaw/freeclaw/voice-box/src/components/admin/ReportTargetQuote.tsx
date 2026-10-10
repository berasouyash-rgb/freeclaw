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
	// State distinction — WHY this target is not (or no longer) public.
	// Without these the quote collapsed live / moderation-removed /
	// author-deleted / under-review / locked into "ready" or "gone",
	// so triage ran on wrong facts.
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

/** Small status pill for WHY a reported target is not public — plain
 *  language, because triage decisions must not depend on decoding
 *  `hidden` vs `deleted` vs `status` fields. */
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
				const list = await api.get<
					Array<{
						id?: string;
						body?: string;
						text?: string;
						hidden?: boolean;
						deleted?: boolean;
						status?: string;
					}>
				>(`/api/comments?all=1`);
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
		// A failed fetch must never poison later rows: drop the rejection
		// from the cache so a retry re-reads instead of replaying it.
		if (inflight.get(key) === guarded) inflight.delete(key);
		throw err;
	});
	inflight.set(key, guarded);
	return guarded;
}

/** Test-only: clear the module memo cache between cases. */
export function resetQuoteCacheForTests() {
	inflight.clear();
}

export default function ReportTargetQuote({
	reportId,
	targetType,
	targetId,
}: {
	reportId: number | string;
	targetType: string;
	targetId: string;
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
			className="mt-2 rounded-lg border-l-2 px-2.5 py-1.5 text-xs"
			style={{
				borderColor: "rgba(220,170,50,0.7)",
				background: "rgba(220,170,50,0.06)",
			}}
		>
			<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-0.5">
				Reported {targetType}
			</p>
			{status.state === "loading" && (
				<p className="text-ink3 animate-pulse">Loading reported content…</p>
			)}
			{status.state === "ready" && (
				<>
					<p className="font-semibold text-ink leading-snug">{status.quote.title}</p>
					{/* State badges: live content shows none; anything else says
					    exactly why it is not public — REMOVED (moderation hide),
					    DELETED (author removal, terminal), UNDER REVIEW (not public
					    yet), LOCKED (readers can no longer comment). */}
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
						<p className="text-ink2 mt-0.5 leading-relaxed line-clamp-3">
							{status.quote.body}
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
