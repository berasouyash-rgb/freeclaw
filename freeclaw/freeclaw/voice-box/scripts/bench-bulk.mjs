// Measures the wall-clock difference the old SEQUENTIAL bulk delete had vs
// bounded-parallel, at a realistic per-request latency. Standalone (no app
// imports) so it measures the concurrency strategy itself.
const LATENCY_MS = 120; // one server round-trip
const CONCURRENCY = 8;

async function mapWithConcurrency(items, limit, worker) {
	const results = new Array(items.length);
	let cursor = 0;
	const lanes = Math.max(1, Math.min(limit, items.length));
	async function runLane() {
		while (cursor < items.length) {
			const i = cursor++;
			try {
				results[i] = { status: "fulfilled", value: await worker(items[i], i) };
			} catch (reason) {
				results[i] = { status: "rejected", reason };
			}
		}
	}
	await Promise.all(Array.from({ length: lanes }, () => runLane()));
	return results;
}

const work = () => new Promise((r) => setTimeout(r, LATENCY_MS));

console.log(`per-request latency: ${LATENCY_MS}ms | concurrency: ${CONCURRENCY}\n`);
console.log("rows  | sequential | parallel | speedup");
for (const n of [10, 50, 100, 300, 1000]) {
	const t0 = Date.now();
	for (let i = 0; i < n; i++) await work();
	const seq = Date.now() - t0;

	const t1 = Date.now();
	await mapWithConcurrency(Array.from({ length: n }, (_, i) => i), CONCURRENCY, work);
	const par = Date.now() - t1;

	const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
	console.log(
		`${String(n).padStart(4)}  | ${fmt(seq).padStart(9)} | ${fmt(par).padStart(7)} | ${(seq / par).toFixed(1)}x`,
	);
}
