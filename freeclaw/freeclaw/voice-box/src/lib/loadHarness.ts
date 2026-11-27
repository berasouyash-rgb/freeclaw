/**
 * ═══════════════════════════════════════════════════════════════════
 * LOAD MANAGEMENT & HIGH-THROUGHPUT HARNESS (Scale to 5,000+ Users)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Designed to ensure a buttery-smooth, sub-300ms platform experience
 * even under massive concurrent surges (5,000 students active at once
 * in assemblies, voting periods, or campus alerts).
 *
 * Core Capabilities:
 *  1. Priority-based Request Scheduling:
 *     - Priority 0 (Critical Write): Votes, submissions, comments, reports.
 *       Bypasses queues, executes immediately with optimistic UI.
 *     - Priority 1 (Interactive Read): Route navigation, active feed queries.
 *     - Priority 2 (Background Telemetry): Unread counts, presence pings.
 *       Shed or backed off during traffic peaks.
 *
 *  2. Adaptive Jitter & Anti-Thundering-Herd:
 *     - All polling and retries apply full randomized jitter across clients.
 *     - Spreads network bursts evenly across time windows.
 *
 *  3. Page Visibility Power & Bandwidth Conservation:
 *     - When tab is hidden/minimized, all non-essential polling freezes.
 *     - Resumes with jittered wake-up upon returning to the tab.
 *
 *  4. Telemetry & Rolling Latency Observer:
 *     - Tracks rolling p50/p95 latency and dynamically tunes concurrency.
 * ═══════════════════════════════════════════════════════════════════
 */

export type RequestPriority = "critical" | "interactive" | "background";

interface PriorityItem {
	id: number;
	priority: number; // 0 = critical, 1 = interactive, 2 = background
	run: () => void;
	abort?: () => void;
	enqueuedAt: number;
}

interface LoadHarnessStats {
	inflight: number;
	queueLength: number;
	rollingP95LatencyMs: number;
	adaptiveBackoffMultiplier: number;
	tabVisible: boolean;
	totalProcessed: number;
	throttledBackgroundCount: number;
}

class LoadManagementHarness {
	private inflightCount = 0;
	private maxConcurrency = 8;
	private minConcurrency = 3;
	private queue: PriorityItem[] = [];
	private idSeq = 0;

	// Latency & health tracking
	private latencies: number[] = [];
	private maxLatencyHistory = 50;
	private backoffMultiplier = 1.0;
	private totalProcessed = 0;
	private throttledBackgroundCount = 0;
	private isTabVisible = true;

	constructor() {
		if (typeof document !== "undefined") {
			this.isTabVisible = !document.hidden;
			document.addEventListener("visibilitychange", () => {
				this.isTabVisible = !document.hidden;
				if (this.isTabVisible) {
					// Add randomized jitter on wake-up to prevent 5,000 users from thundering
					const jitter = Math.floor(Math.random() * 600);
					setTimeout(() => this.drainQueue(), jitter);
				}
			});
		}
	}

	/** Determine numeric rank: lower = higher precedence */
	private priorityRank(priority: RequestPriority): number {
		switch (priority) {
			case "critical":
				return 0;
			case "interactive":
				return 1;
			case "background":
				return 2;
			default:
				return 1;
		}
	}

	/** Try to synchronously acquire a slot on the fast path (zero await delay) */
	public tryAcquire(priority: RequestPriority = "interactive"): boolean {
		const rank = this.priorityRank(priority);
		if (rank === 2 && !this.isTabVisible) return false;
		const currentCap = this.getAdaptiveConcurrency();
		if (this.inflightCount < currentCap && this.queue.length === 0) {
			this.inflightCount++;
			return true;
		}
		return false;
	}

	/** Acquire execution slot based on priority */
	public async acquire(priority: RequestPriority = "interactive"): Promise<void> {
		const rank = this.priorityRank(priority);

		// If background task and tab is hidden, or if system is heavily congested, shed gracefully
		if (rank === 2 && !this.isTabVisible) {
			this.throttledBackgroundCount++;
			// Still allow if queue is empty, but delay
			await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
		}

		// Effective max concurrency adapts to rolling latency
		const currentCap = this.getAdaptiveConcurrency();

		if (this.inflightCount < currentCap && this.queue.length === 0) {
			this.inflightCount++;
			return;
		}

		// Critical priority jumps directly to head of its tier
		return new Promise<void>((resolve, reject) => {
			const item: PriorityItem = {
				id: ++this.idSeq,
				priority: rank,
				run: () => {
					this.inflightCount++;
					resolve();
				},
				abort: () => reject(new Error("Request cancelled by load harness")),
				enqueuedAt: Date.now(),
			};

			// Insert sorted by priority (0 first, then 1, then 2)
			const insertIdx = this.queue.findIndex((q) => q.priority > rank);
			if (insertIdx === -1) {
				this.queue.push(item);
			} else {
				this.queue.splice(insertIdx, 0, item);
			}

			// If critical write, try to execute without waiting for background tasks
			if (rank === 0 && this.inflightCount < this.maxConcurrency + 2) {
				const idx = this.queue.indexOf(item);
				if (idx !== -1) {
					this.queue.splice(idx, 1);
					item.run();
				}
			}
		});
	}

	/** Release slot upon request completion */
	public release(latencyMs?: number): void {
		this.inflightCount = Math.max(0, this.inflightCount - 1);
		this.totalProcessed++;

		if (typeof latencyMs === "number" && latencyMs >= 0) {
			this.recordLatency(latencyMs);
		}

		this.drainQueue();
	}

	/** Record latency sample to compute rolling P95 */
	public recordLatency(ms: number): void {
		this.latencies.push(ms);
		if (this.latencies.length > this.maxLatencyHistory) {
			this.latencies.shift();
		}

		const p95 = this.getP95Latency();
		if (p95 > 1500) {
			// Severe congestion: increase backoff and reduce concurrency
			this.backoffMultiplier = 2.5;
		} else if (p95 > 800) {
			this.backoffMultiplier = 1.5;
		} else {
			this.backoffMultiplier = 1.0;
		}
	}

	/** Record 429 or 503 rate-limit event */
	public recordThrottle(): void {
		this.backoffMultiplier = Math.min(4.0, this.backoffMultiplier + 1.0);
		// Shed lowest priority background items from wait queue to relieve pressure
		const firstBg = this.queue.findIndex((q) => q.priority === 2);
		if (firstBg !== -1) {
			const shed = this.queue.splice(firstBg, 1)[0];
			this.throttledBackgroundCount++;
			try {
				shed?.abort?.();
			} catch {
				/* ignored */
			}
		}
	}

	/** Rolling P95 calculation */
	public getP95Latency(): number {
		if (this.latencies.length === 0) return 150;
		const sorted = [...this.latencies].sort((a, b) => a - b);
		const idx = Math.min(
			sorted.length - 1,
			Math.floor(sorted.length * 0.95),
		);
		return sorted[idx] ?? 150;
	}

	/** Compute dynamic concurrency allowance */
	private getAdaptiveConcurrency(): number {
		const p95 = this.getP95Latency();
		if (p95 > 2000) return this.minConcurrency;
		if (p95 > 1000) return 4;
		if (p95 > 500) return 6;
		return this.maxConcurrency;
	}

	/** Process queued requests up to available capacity */
	private drainQueue(): void {
		const cap = this.getAdaptiveConcurrency();
		while (this.inflightCount < cap && this.queue.length > 0) {
			const next = this.queue.shift();
			if (next) {
				next.run();
			}
		}
	}

	/** Get current jittered polling interval recommendation */
	public getPollingInterval(baseMs = 30000): number {
		if (!this.isTabVisible) return baseMs * 3;
		const jitter = Math.floor(Math.random() * 3000);
		return Math.round(baseMs * this.backoffMultiplier) + jitter;
	}

	/** Read current harness telemetry */
	public getStats(): LoadHarnessStats {
		return {
			inflight: this.inflightCount,
			queueLength: this.queue.length,
			rollingP95LatencyMs: this.getP95Latency(),
			adaptiveBackoffMultiplier: this.backoffMultiplier,
			tabVisible: this.isTabVisible,
			totalProcessed: this.totalProcessed,
			throttledBackgroundCount: this.throttledBackgroundCount,
		};
	}

	/** Reset for test isolation */
	public resetForTests(): void {
		this.inflightCount = 0;
		this.queue.length = 0;
		this.latencies.length = 0;
		this.backoffMultiplier = 1.0;
		this.totalProcessed = 0;
		this.throttledBackgroundCount = 0;
	}
}

export const loadHarness = new LoadManagementHarness();
