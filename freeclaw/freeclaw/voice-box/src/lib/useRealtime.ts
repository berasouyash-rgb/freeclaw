import { useEffect, useRef } from "react";
import realtimeContract from "./realtimeContract.json";
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

/** Payload from a Supabase Realtime postgres_changes event. */
export interface RealtimePayload {
	eventType?: string;
	[key: string]: unknown;
}

/**
 * Tables the `supabase_realtime` publication actually carries AND the anon key
 * is allowed to read (see api/migrations/006_restore_anon_realtime.sql).
 * Channels for anything else (agent_*, settings, vitals, …) can never deliver:
 * the Realtime server drops them on RLS/publication checks. Do not open a
 * dead channel or start a replacement polling loop; the page keeps its
 * bounded snapshot until an explicit refresh.
 */
export const REALTIME_TABLES = new Set<string>(
	realtimeContract.anonSelectTables,
);

type ChangeCallback = (table: string, payload: RealtimePayload) => void;

interface Subscriber {
	callback: ChangeCallback;
	debounceMs: number;
	timer: ReturnType<typeof setTimeout> | null;
	/** When the current burst started — the max-wait anchor. */
	burstStartedAt: number | null;
}

/**
 * Ceiling on how long a burst may delay a refresh.
 *
 * A pure debounce (reset the timer on every event) is fine for a click, but
 * for a live feed it is a starvation bug: if rows keep arriving faster than
 * the debounce window, the timer is reset before it ever fires and the
 * callback never runs. Admins saw the list update once during a quiet gap and
 * then silently stop. A burst must still coalesce, so we keep the debounce —
 * we just guarantee a flush no later than this.
 */
const MAX_BURST_WAIT_MS = 10_000;

interface ChannelEntry {
	// null when the Supabase client is unavailable (bad/missing env config) or
	// when the requested tables are not in the public Realtime allowlist.
	channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null;
	subscribers: Map<number, Subscriber>;
}

let nextId = 0;
const registry = new Map<string, ChannelEntry>();

function getOrCreate(key: string): ChannelEntry {
	let entry = registry.get(key);
	if (entry) return entry;

	const tables = key.split(",");
	// Skip dead channels: tables outside the realtime publication (or with no
	// anon read policy) can never deliver events. Do not open a dead channel;
	// the page keeps its bounded snapshot until an explicit refresh.
	const channel =
		supabase && tables.every((t) => REALTIME_TABLES.has(t))
			? supabase.channel(`rt-${key}`)
			: null;
	entry = {
		channel,
		subscribers: new Map(),
	};

	// No fallback polling or visibility refresh is started here. The page
	// lifecycle contract is one bounded read per visit; a failed/quiet
	// Realtime channel must not silently turn into recurring full refetches.
	// Consumers expose explicit refresh actions when fresh data is required.

	// Wire up postgres_changes for each table in the key. If no channel is
	// available, the subscriber simply receives no events until an explicit
	// page refresh; it does not start a replacement polling loop.
	if (channel) {
		for (const table of key.split(",")) {
			channel.on(
				"postgres_changes",
				{ event: "*", schema: "public", table },
				(payload) => {
					const now = Date.now();
					// Notify ALL subscribers for this table, each with their OWN debounce
					// timer (per-subscriber timers guarantee every subscriber fires — a
					// shared map would let the last-writer win and drop earlier subscribers).
					for (const [, sub] of entry!.subscribers) {
						if (sub.timer) {
							// Max-wait: a burst that has already run longer than the
							// ceiling flushes NOW instead of pushing the timer again.
							// Without this, continuous activity starves the callback
							// forever and the list silently stops updating.
							if (
								sub.burstStartedAt !== null &&
								now - sub.burstStartedAt >= MAX_BURST_WAIT_MS
							) {
								clearTimeout(sub.timer);
								sub.timer = null;
								sub.burstStartedAt = null;
								sub.callback(table, payload);
								continue;
							}
							clearTimeout(sub.timer);
						} else {
							sub.burstStartedAt = now;
						}
						sub.timer = setTimeout(() => {
							sub.timer = null;
							sub.burstStartedAt = null;
							sub.callback(table, payload);
						}, sub.debounceMs);
					}
				},
			);
		}

		// Subscribe activates the shared channel. Status is intentionally not
		// converted into polling or visibility refreshes by this layer.
		channel.subscribe(() => undefined);
	}

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
	if (sub) sub.burstStartedAt = null;
	entry.subscribers.delete(id);
	// Last subscriber gone → tear down the channel
	if (entry.subscribers.size === 0) {
		// No channel exists when the client is unavailable or the tables are
		// outside the public Realtime allowlist; there is nothing to remove.
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
 * Realtime failures and quiet channels are intentionally not converted into
 * recurring polling. Pages keep their current snapshot until an explicit
 * refresh or route re-entry, matching the one-load lifecycle contract.
 */
export function useRealtime(
	tables: string[],
	onChange: (table: string, payload: RealtimePayload) => void,
	debounceMs = 250,
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
			// Fire through the ref: the callback identity changes every render,
			// but this subscriber record is created once per [key, debounceMs].
			// Reading cbRef.current at dispatch time means realtime events always
			// invoke the LATEST closure instead of a stale first-render snapshot.
			callback: (table, payload) => cbRef.current(table, payload),
			debounceMs,
			timer: null,
			burstStartedAt: null,
		});

		return () => {
			removeSubscriber(id, key);
		};
	}, [key, debounceMs]);
}
