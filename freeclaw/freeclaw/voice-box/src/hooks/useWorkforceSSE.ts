/**
 * useWorkforceSSE — Connects to the Python workforce SSE endpoint
 * for real-time admin updates (alerts, incidents, task completions).
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Heartbeat detection (keeps connection alive)
 * - Event deduplication
 * - Connection status tracking
 * - Graceful degradation when workforce is unavailable
 */
import { useCallback, useEffect, useRef, useState } from "react";

const WORKFORCE_URL =
  import.meta.env.VITE_WORKFORCE_URL || "http://localhost:8000";
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 60000;

export type WorkforceEvent = {
  event_type: string;
  data?: Record<string, unknown>;
  ts?: string;
};

export type WorkforceSSEStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface UseWorkforceSSEOptions {
  /** Event types to listen for. If empty, receives all events. */
  eventTypes?: string[];
  /** Called when an event is received. */
  onEvent?: (event: WorkforceEvent) => void;
  /** Called when connection status changes. */
  onStatusChange?: (status: WorkforceSSEStatus) => void;
  /** Set to false to disable the connection. */
  enabled?: boolean;
}

export function useWorkforceSSE({
  eventTypes = [],
  onEvent,
  onStatusChange,
  enabled = true,
}: UseWorkforceSSEOptions = {}) {
  const [status, setStatus] = useState<WorkforceSSEStatus>("disconnected");
  const [eventCount, setEventCount] = useState(0);
  const [lastEvent, setLastEvent] = useState<WorkforceEvent | null>(null);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const updateStatus = useCallback(
    (newStatus: WorkforceSSEStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange],
  );

  const connect = useCallback(() => {
    if (!enabled) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    updateStatus(retryCountRef.current === 0 ? "connecting" : "reconnecting");

    const url = new URL("/api/workforce/stream", WORKFORCE_URL);
    const es = new EventSource(url.toString());
    eventSourceRef.current = es;

    // Reset heartbeat timer
    clearTimeout(heartbeatTimerRef.current);
    heartbeatTimerRef.current = setTimeout(() => {
      // No heartbeat in HEARTBEAT_TIMEOUT_MS — treat as disconnected
      es.close();
      retryWithBackoff();
    }, HEARTBEAT_TIMEOUT_MS);

    es.onopen = () => {
      retryCountRef.current = 0;
      updateStatus("connected");
    };

    // Listen for specific event types or use message as fallback
    const typesToListen =
      eventTypes.length > 0
        ? eventTypes
        : ["message"];

    for (const eventType of typesToListen) {
      if (eventType === "message") {
        es.onmessage = (e) => {
          handleEvent({ event_type: "message", data: safeParse(e.data) });
        };
      } else {
        es.addEventListener(eventType, ((e: MessageEvent) => {
          handleEvent({ event_type: eventType, data: safeParse(e.data) });
        }) as EventListener);
      }
    }

    // Always listen for heartbeat events
    es.addEventListener("heartbeat", (() => {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = setTimeout(() => {
        es.close();
        retryWithBackoff();
      }, HEARTBEAT_TIMEOUT_MS);
    }) as EventListener);

    es.onerror = () => {
      es.close();
      retryWithBackoff();
    };

    function handleEvent(event: WorkforceEvent) {
      // Dedup by JSON hash
      const id = JSON.stringify(event);
      if (seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);
      if (seenIdsRef.current.size > 500) {
        const arr = [...seenIdsRef.current];
        seenIdsRef.current = new Set(arr.slice(-250));
      }

      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = setTimeout(() => {
        es.close();
        retryWithBackoff();
      }, HEARTBEAT_TIMEOUT_MS);

      setEventCount((c) => c + 1);
      setLastEvent(event);
      onEvent?.(event);
    }

    function retryWithBackoff() {
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** retryCountRef.current,
        RECONNECT_MAX_MS,
      );
      retryCountRef.current++;
      setTimeout(connect, delay);
    }
  }, [enabled, eventTypes, onEvent, updateStatus]);

  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      eventSourceRef.current?.close();
      clearTimeout(heartbeatTimerRef.current);
    };
  }, [enabled, connect]);

  return { status, eventCount, lastEvent };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return { raw: json };
  }
}
