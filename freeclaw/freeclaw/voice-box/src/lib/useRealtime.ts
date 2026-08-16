import { useEffect, useRef } from "react";
import supabase from "./supabase";

/**
 * Global Realtime subscription manager.
 *
 * Problem: Each useRealtime() call created a separate Supabase channel, even
 * when multiple components subscribed to the same table. 3 components listening
 * to `chat_messages` = 3 WebSocket connections = 3x bandwidth.
 *
 * Solution: A global registry that shares channels across subscribers.
 * - Components subscribing to the same table set share ONE channel.
 * - Each component gets its own debounced callback.
 * - Channel is only torn down when the LAST subscriber leaves.
 *
 * This reduces 11 channels → ~5 unique table groups on a typical page.
 */

/** Payload from Supabase Realtime postgres_changes or polling fallback */
export interface RealtimePayload {
	eventType?: string;
	[key: string]: unknown;
}

type ChangeCallback = (table: string, payload: RealtimePayload) => void;

interface Subscriber {
	callback: ChangeCallback;
	debounceMs: number;
	timer: ReturnType<typeof setTimeout> | null;
}

interface ChannelEntry {
	// null when the Supabase client is unavailable (bad/missing env config) —
	// the entry then runs in polling-only mode so the app never loses updates.
	channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null;
	subscribers: Map<number, Subscriber>;
	realtimeConnected: boolean;
	poll: ReturnType<typeof setInterval> | null;
	lastEventAt: number;
	stalenessCheck: ReturnType<typeof setInterval> | null;
	visibilityHandler: (() => void) | null;
}

let nextId = 0;
const registry = new Map<string, ChannelEntry>();

function getOrCreate(key: string): ChannelEntry {
	let entry = registry.get(key);
	if (entry) return entry;

	const channel = supabase ? supabase.channel(`rt-${key}`) : null;
	entry = {
		channel,
		subscribers: new Map(),
		realtimeConnected: false,
		poll: null,
		lastEventAt: Date.now(),
		stalenessCheck: null,
		visibilityHandler: null,
	};

	const startPolling = () => {
		if (entry!.poll) return;
		// Adaptive polling: start at 10s, use backoff if no realtime connection
		entry!.poll = setInterval(() => {
			// Never poll in a hidden tab — the user can't see updates anyway.
			// This saves API calls (and Vercel function invocations) on background tabs.
			if (document.hidden) return;
			// Defensive: split always returns at least one string, so the ?? fallback
			// can never fire — kept for type safety under future key changes.
			/* v8 ignore next -- @preserve */
			const firstTable = key.split(",")[0] ?? "";
			for (const [, sub] of entry!.subscribers) {
				sub.callback(firstTable, { eventType: "POLL" });
			}
		}, 10000);
	};

	const stopPolling = () => {
		if (entry!.poll) {
			clearInterval(entry!.poll);
			entry!.poll = null;
		}
	};

	// Fire an immediate refresh when the tab becomes visible again, so users
	// never wait for the next 10s tick after switching back.
	// NOTE: like the fallback POLL tick, this intentionally refreshes only the
	// FIRST table in the key — every consumer either ignores the `table` arg or
	// relies on `chat_messages` being first, so this matches existing semantics.
	const onVisibility = () => {
		if (document.hidden || entry!.subscribers.size === 0) return;
		// Defensive: split always returns at least one string, so the ?? fallback
		// can never fire — kept for type safety under future key changes.
		/* v8 ignore next -- @preserve */
		const firstTable = key.split(",")[0] ?? "";
		// Route through the same per-subscriber debounce used by realtime events
		// so visibility bursts coalesce consistently with other update paths.
		for (const [, sub] of entry!.subscribers) {
			if (sub.timer) clearTimeout(sub.timer);
			sub.timer = setTimeout(
				() => sub.callback(firstTable, { eventType: "VISIBLE" }),
				sub.debounceMs,
			);
		}
	};
	entry.visibilityHandler = onVisibility;
	document.addEventListener("visibilitychange", onVisibility);

	// Wire up postgres_changes for each table in the key — skipped entirely when
	// there is no Supabase client; the polling fallback below covers that mode.
	if (channel) {
		for (const table of key.split(",")) {
			channel.on(
				"postgres_changes",
				{ event: "*", schema: "public", table },
				(payload) => {
					entry!.lastEventAt = Date.now();
					// Notify ALL subscribers for this table, each with their OWN debounce
					// timer (per-subscriber timers guarantee every subscriber fires — a
					// shared map would let the last-writer win and drop earlier subscribers).
					for (const [, sub] of entry!.subscribers) {
						if (sub.timer) clearTimeout(sub.timer);
						sub.timer = setTimeout(
							() => sub.callback(table, payload),
							sub.debounceMs,
						);
					}
				},
			);
		}

		channel.subscribe((status: string) => {
			entry!.realtimeConnected = status === "SUBSCRIBED";
			if (entry!.realtimeConnected) {
				entry!.lastEventAt = Date.now();
				stopPolling();
			}
			if (!entry!.realtimeConnected && !entry!.poll) {
				startPolling();
			}
		});
	} else {
		// No realtime client → fall back to polling immediately.
		startPolling();
	}

	// Staleness detection: if SUBSCRIBED but no events for 30s, re-enable polling
	entry.stalenessCheck = setInterval(() => {
		if (document.hidden) return;
		if (entry!.realtimeConnected && Date.now() - entry!.lastEventAt > 30000) {
			startPolling();
		}
	}, 10000);

	registry.set(key, entry);
	return entry;
}

function removeSubscriber(id: number, key: string) {
	const entry = registry.get(key);
	// Defensive: removeSubscriber is only ever invoked from effect cleanup with
	// the same key that getOrCreate registered, so the entry always exists.
	/* v8 ignore next -- @preserve */
	if (!entry) return;
	// Clear this subscriber's pending debounce timer before deleting it,
	// so per-subscriber timers never leak regardless of order.
	const sub = entry.subscribers.get(id);
	if (sub?.timer) clearTimeout(sub.timer);
	entry.subscribers.delete(id);
	// Last subscriber gone → tear down the channel
	if (entry.subscribers.size === 0) {
		if (entry.poll) clearInterval(entry.poll);
		// stalenessCheck/visibilityHandler are always set by getOrCreate, so these
		// conditions never evaluate false — guards kept for defensive clarity.
		/* v8 ignore else -- @preserve */
		if (entry.stalenessCheck) clearInterval(entry.stalenessCheck);
		/* v8 ignore else -- @preserve */
		if (entry.visibilityHandler)
			document.removeEventListener("visibilitychange", entry.visibilityHandler);
		// No channel exists in polling-only mode (bad env config) — nothing to remove.
		if (supabase && entry.channel) supabase.removeChannel(entry.channel);
		registry.delete(key);
	}
}

/**
 * Subscribe to Postgres changes on one or more tables.
 * Calls `onChange` (debounced) whenever any row changes.
 * Cleans up the channel on unmount — no leaks, no duplicate listeners.
 *
 * Multiple components subscribing to the same tables share a single
 * Supabase channel, reducing WebSocket connections and bandwidth.
 *
 * Polling fallback activates when:
 * 1. The Realtime channel fails to connect (immediate fallback), OR
 * 2. The channel reports SUBSCRIBED but no events arrive for 15s (staleness detection)
 * This ensures updates arrive even when Supabase Realtime is connected but silent.
 */
export function useRealtime(
	tables: string[],
	onChange: (table: string, payload: RealtimePayload) => void,
	debounceMs = 400,
) {
	const cbRef = useRef(onChange);
	cbRef.current = onChange;
	const key = tables.join(",");
	// Lazy init: useRef(nextId++) would evaluate nextId++ on EVERY render
	// (React evaluates the argument even though it stores only the first value),
	// burning subscriber IDs on each re-render. Initialize once instead.
	const idRef = useRef<number | null>(null);
	if (idRef.current === null) idRef.current = nextId++;

	useEffect(() => {
		const id = idRef.current!;
		const entry = getOrCreate(key);
		entry.subscribers.set(id, {
			callback: cbRef.current,
			debounceMs,
			timer: null,
		});

		return () => {
			removeSubscriber(id, key);
		};
	}, [key, debounceMs]);
}
