/**
 * Lightweight frontend error capture — sends real JS errors to the backend
 * for admin dashboard visibility. Complements Sentry (external) with a
 * self-hosted error feed the admin can see immediately.
 *
 * Every error includes: message, stack, URL, line/col, device, timestamp.
 * Errors are batched and sent every 10 seconds (best-effort, non-blocking).
 */

import { getAnonId } from "./identity";
import { apiBase } from "./platform";

interface FrontendError {
  message: string;
  source: "window.onerror" | "unhandledrejection" | "react.errorboundary";
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  url: string;
  device: string;
  timestamp: string;
  count: number;
}

function getDevice(): string {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

// Dedup buffer — same error within 5s is counted, not re-sent
const dedupMap = new Map<string, FrontendError>();
const buffer: FrontendError[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Rate limiting: max 30 errors per minute to prevent error loops from
// flooding the backend with thousands of identical reports.
const RATE_LIMIT_PER_MINUTE = 30;
let rateWindowStart = Date.now();
let rateCount = 0;

function dedupKey(e: FrontendError): string {
  return `${e.source}:${e.message?.slice(0, 120)}:${e.filename}:${e.lineno}:${e.colno}`;
}

function addToBuffer(entry: FrontendError) {
  // Rate limiting: reset window every 60s, drop excess errors
  const now = Date.now();
  if (now - rateWindowStart > 60_000) {
    rateWindowStart = now;
    rateCount = 0;
  }
  if (rateCount >= RATE_LIMIT_PER_MINUTE) return;
  rateCount++;

  const key = dedupKey(entry);
  const existing = dedupMap.get(key);
  if (existing && Date.now() - new Date(existing.timestamp).getTime() < 5000) {
    existing.count++;
    return;
  }
  dedupMap.set(key, entry);
  buffer.push(entry);

  // Keep dedup map from growing unbounded — batch evict oldest 25%
  if (dedupMap.size > 200) {
    const toDelete = Math.floor(dedupMap.size * 0.25);
    const iter = dedupMap.keys();
    for (let i = 0; i < toDelete; i++) {
      const k = iter.next().value;
      if (k) dedupMap.delete(k);
    }
  }

  scheduleFlush();
}

function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const anonId = getAnonId();
    // apiBase(): native shells (file://) have no same-origin /api — without
    // the baked origin this fetch always throws Failed to fetch on desktop.
    fetch(apiBase() + "/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-anon-id": anonId },
      body: JSON.stringify({ errors: batch }),
      credentials: "include",
      keepalive: true,
    }).catch(() => {
      /* error reporting is best-effort */
    });
  } catch {
    /* error reporting is best-effort */
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 10000);
}

let _initialized = false;

/** Initialize all error listeners — call once on app mount */
export function initErrorCapture() {
  if (_initialized || typeof window === "undefined") return;
  _initialized = true;

  // ── window.onerror — synchronous JS errors ──
  window.addEventListener("error", (e: ErrorEvent) => {
    // Ignore ResizeObserver loops and network errors (noisy, non-actionable)
    const msg = e.message || "";
    if (
      msg.includes("ResizeObserver") ||
      msg.includes("NetworkError") ||
      msg.includes("Load failed") ||
      e.filename?.includes("sentry") ||
      e.filename?.includes("chunk")
    ) return;

    addToBuffer({
      message: msg.slice(0, 500),
      source: "window.onerror",
      filename: e.filename?.replace(location.origin, "") || undefined,
      lineno: e.lineno || undefined,
      colno: e.colno || undefined,
      stack: undefined,
      url: location.pathname,
      device: getDevice(),
      timestamp: new Date().toISOString(),
      count: 1,
    });
  });

  // ── unhandledrejection — uncaught promise errors ──
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    let message = "Unhandled promise rejection";
    let stack = "";

    if (reason instanceof Error) {
      message = reason.message?.slice(0, 500) || message;
      stack = reason.stack?.slice(0, 1000) || "";
    } else if (typeof reason === "string") {
      message = reason.slice(0, 500);
    } else {
      try {
        message = JSON.stringify(reason)?.slice(0, 500) || message;
      } catch {
        message = String(reason)?.slice(0, 500);
      }
    }

    // Ignore chunk load errors (handled by retryLazy) and network errors
    if (
      message.includes("Failed to fetch") ||
      message.includes("ChunkLoadError") ||
      message.includes("Loading chunk") ||
      message.includes("Importing a module script failed")
    ) return;

    addToBuffer({
      message,
      source: "unhandledrejection",
      filename: undefined,
      lineno: undefined,
      colno: undefined,
      stack,
      url: location.pathname,
      device: getDevice(),
      timestamp: new Date().toISOString(),
      count: 1,
    });
  });

  // Flush on page hide / unload
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", flush);
}

/** Manually report a React ErrorBoundary error */
export function reportBoundaryError(error: Error, componentStack?: string) {
  if (!_initialized) return;
  addToBuffer({
    message: error.message?.slice(0, 500) || "React error boundary",
    source: "react.errorboundary",
    filename: undefined,
    lineno: undefined,
    colno: undefined,
    stack: (error.stack?.slice(0, 1000) || "") + (componentStack ? `\n\nComponent Stack:\n${componentStack.slice(0, 500)}` : ""),
    url: location.pathname,
    device: getDevice(),
    timestamp: new Date().toISOString(),
    count: 1,
  });
}
