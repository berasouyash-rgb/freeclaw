/**
 * Bounded-concurrency async map.
 *
 * Why this exists: bulk actions used `for (const id of ids) { await api.del(...) }`,
 * which is fully SEQUENTIAL — deleting 100 rows meant 100 serial round-trips
 * (~20s at 200ms each). Swapping it for `Promise.all(ids.map(...))` fixes the
 * latency but creates the opposite failure: selecting 4,000 rows would fire
 * 4,000 simultaneous requests, exhausting the browser's connection pool and the
 * API's rate limits (and making the whole page feel worse, not better).
 *
 * So: run in parallel, but never more than `limit` in flight. Keeps per-item
 * results (partial-failure reporting) that `Promise.all` would throw away.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	if (items.length === 0) return results;

	const effective = Math.max(1, Math.min(limit, items.length));
	let cursor = 0;

	async function runLane(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor++;
			try {
				results[index] = {
					status: "fulfilled",
					value: await worker(items[index] as T, index),
				};
			} catch (reason) {
				results[index] = { status: "rejected", reason };
			}
		}
	}

	await Promise.all(
		Array.from({ length: effective }, () => runLane()),
	);
	return results;
}

/**
 * Default ceiling for admin bulk actions.
 *
 * 8 keeps a 100-row delete at roughly 1/8th the wall-clock of the old
 * sequential loop while staying far below browser connection limits and
 * serverless concurrency limits.
 */
export const BULK_CONCURRENCY = 8;
