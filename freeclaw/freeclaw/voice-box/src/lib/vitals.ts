/**
 * Lightweight Web Vitals collector using native PerformanceObserver.
 * Reports real Core Web Vitals (LCP, FID, CLS, TTFB, INP) to the backend
 * for admin dashboard visibility. No external dependencies.
 */

import { getAnonId } from "./identity";

interface VitalMetric {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
  id: string;
  navigationType: string;
  url: string;
  timestamp: string;
  device: string;
}

// Thresholds from web-vitals v5
const THRESHOLDS = {
  LCP: [2500, 4000],
  FID: [100, 300],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  INP: [200, 500],
} as const;

function rating(name: string, value: number): "good" | "needs-improvement" | "poor" {
  const t = THRESHOLDS[name as keyof typeof THRESHOLDS];
  if (!t) return "good";
  if (value <= t[0]) return "good";
  if (value <= t[1]) return "needs-improvement";
  return "poor";
}

function getDevice(): string {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

// Batch buffer — send every 5 seconds if there are pending metrics
const buffer: VitalMetric[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Rate limiting: max 50 metric reports per minute (INP fires on every
// long interaction, so a busy page can generate hundreds of reports)
const VITALS_RATE_LIMIT = 50;
let vitalsRateStart = Date.now();
let vitalsRateCount = 0;

function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const anonId = getAnonId();
    fetch("/api/vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-anon-id": anonId },
      body: JSON.stringify({ metrics: batch }),
      keepalive: true,
    }).catch(() => {
      /* vitals reporting is best-effort */
    });
  } catch {
    /* vitals reporting is best-effort */
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 5000);
}

function report(name: string, value: number, delta: number, id: string) {
  const now = Date.now();
  if (now - vitalsRateStart > 60_000) {
    vitalsRateStart = now;
    vitalsRateCount = 0;
  }
  if (vitalsRateCount >= VITALS_RATE_LIMIT) return;
  vitalsRateCount++;

  const metric: VitalMetric = {
    name,
    value: Math.round(name === "CLS" ? value * 1000 : value),
    rating: rating(name, value),
    delta: Math.round(name === "CLS" ? delta * 1000 : delta),
    id,
    navigationType: "navigate",
    url: location.pathname,
    timestamp: new Date().toISOString(),
    device: getDevice(),
  };
  buffer.push(metric);
  scheduleFlush();
}

let _lcpValue = 0;
let _clsValue = 0;

/** Observe LCP */
function observeLCP() {
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
      if (!last) return;
      const prev = _lcpValue;
      _lcpValue = last.startTime;
      report("LCP", last.startTime, last.startTime - prev, `${Date.now()}-lcp`);
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* not supported */
  }
}

/** Observe CLS — accumulate shifts and report final value on page hide,
 *  matching the official web-vitals library behavior. */
function observeCLS() {
  try {
    let clsReported = false;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value: number };
        if (e.hadRecentInput) continue;
        _clsValue += e.value;
      }
    });
    po.observe({ type: "layout-shift", buffered: true });
    // Report final CLS once when the page is about to be hidden
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && !clsReported && _clsValue > 0) {
        clsReported = true;
        report("CLS", _clsValue, _clsValue, `${Date.now()}-cls`);
      }
    });
  } catch {
    /* not supported */
  }
}

/** Observe FID */
function observeFID() {
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const first = entries[0] as PerformanceEntry & { processingStart: number };
      if (!first) return;
      report("FID", first.processingStart - first.startTime, first.processingStart - first.startTime, `${Date.now()}-fid`);
    });
    po.observe({ type: "first-input", buffered: true });
  } catch {
    /* not supported */
  }
}

/** Observe TTFB */
function observeTTFB() {
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const nav = entries[0] as PerformanceNavigationTiming;
      if (!nav) return;
      const ttfb = nav.responseStart - nav.requestStart;
      report("TTFB", ttfb, 0, `${Date.now()}-ttfb`);
    });
    po.observe({ type: "navigation", buffered: true });
  } catch {
    /* not supported */
  }
}

/** Observe INP (Interaction to Next Paint) */
function observeINP() {
  try {
    let maxINP = 0;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { duration: number };
        if (e.duration > maxINP) {
          const prevInp = maxINP;
          maxINP = e.duration;
          report("INP", e.duration, e.duration - prevInp, `${Date.now()}-inp`);
        }
      }
    });
    po.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch {
    /* not supported */
  }
}

let _initialized = false;

/** Initialize all observers — call once on app mount */
export function initVitals() {
  if (_initialized || typeof window === "undefined") return;
  _initialized = true;

  observeLCP();
  observeCLS();
  observeFID();
  observeTTFB();
  observeINP();

  // Flush on page visibility change and before unload
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", flush);
}
