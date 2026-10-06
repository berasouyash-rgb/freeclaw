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
}

type Status =
	| { state: "loading" }
	| { state: "ready"; quote: Quote }
	| { state: "gone" }
	| { state: "error" };

const inflight = new Map<string, Promise<Quote | null>>();

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
				const res = await api.get<{ post?: { title?: string; description?: string } | null }>(
					`/api/posts?id=${encodeURIComponent(targetId)}`,
				);
				if (!res?.post) return null;
				return {
					title: res.post.title || "(untitled post)",
					body: res.post.description || "",
				};
			}
			if (targetType === "comment") {
				const list = await api.get<
					Array<{ id?: string; body?: string; text?: string }>
				>(`/api/comments?all=1`);
				const found = (Array.isArray(list) ? list : []).find(
					(c) => String(c?.id) === String(targetId),
				);
				if (!found) return null;
				return {
					title: "Reported comment",
					body: String(found.body ?? found.text ?? ""),
				};
			}
			if (targetType === "poll") {
				const rows = await api.get<Array<{ title?: string }>>(
					`/api/polls?ids=${encodeURIComponent(targetId)}`,
				);
				const row = (Array.isArray(rows) ? rows : [])[0];
				if (!row) return null;
				return { title: row.title || "(untitled poll)" };
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
