// ═══════════════════════════════════════════════════════════════════
// Voice Box Test Setup
// ═══════════════════════════════════════════════════════════════════
// Configures global test utilities, mocks for browser APIs,
// and custom vitest matchers for all test files.
// ═══════════════════════════════════════════════════════════════════

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// ─── Cleanup after every test ─────────────────────────────────────
afterEach(() => {
	cleanup();
});

// ─── Mock localStorage ────────────────────────────────────────────
// Uses a class with actual properties so Object.keys() works correctly
// (clearAllLocalData relies on Object.keys(localStorage))
class LocalStorageMock {
	private _store: Record<string, string> = {};

	getItem(key: string): string | null {
		return this._store[key] ?? null;
	}

	setItem(key: string, value: string): void {
		this._store[key] = value;
		// Make key enumerable so Object.keys() finds it
		Object.defineProperty(this, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}

	removeItem(key: string): void {
		delete this._store[key];
		delete (this as unknown as Record<string, string>)[key];
	}

	clear(): void {
		const keys = Object.keys(this._store);
		for (const k of keys) {
			delete this._store[k];
			delete (this as unknown as Record<string, string>)[k];
		}
	}

	get length(): number {
		return Object.keys(this._store).length;
	}

	key(index: number): string | null {
		return Object.keys(this._store)[index] ?? null;
	}
}

const localStorageMock = new LocalStorageMock();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ─── Mock sessionStorage ──────────────────────────────────────────
// Uses the same class-based approach as localStorage so Object.keys() works
class SessionStorageMock {
	private _store: Record<string, string> = {};

	getItem(key: string): string | null {
		return this._store[key] ?? null;
	}

	setItem(key: string, value: string): void {
		this._store[key] = value;
		Object.defineProperty(this, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}

	removeItem(key: string): void {
		delete this._store[key];
		delete (this as unknown as Record<string, string>)[key];
	}

	clear(): void {
		const keys = Object.keys(this._store);
		for (const k of keys) {
			delete this._store[k];
			delete (this as unknown as Record<string, string>)[k];
		}
	}

	get length(): number {
		return Object.keys(this._store).length;
	}

	key(index: number): string | null {
		return Object.keys(this._store)[index] ?? null;
	}
}

const sessionStorageMock = new SessionStorageMock();

Object.defineProperty(window, "sessionStorage", { value: sessionStorageMock });

// ─── Mock crypto ──────────────────────────────────────────────────
Object.defineProperty(window, "crypto", {
	value: {
		getRandomValues: (array: Uint8Array) => {
			for (let i = 0; i < array.length; i++) {
				array[i] = Math.floor(Math.random() * 256);
			}
			return array;
		},
	},
});

// ─── Mock matchMedia ──────────────────────────────────────────────
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// ─── Mock IntersectionObserver ────────────────────────────────────
Object.defineProperty(window, "IntersectionObserver", {
	writable: true,
	value: vi.fn().mockImplementation(() => ({
		observe: vi.fn(),
		unobserve: vi.fn(),
		disconnect: vi.fn(),
	})),
});

// ─── Mock Speech Recognition ──────────────────────────────────────
Object.defineProperty(window, "webkitSpeechRecognition", {
	writable: true,
	configurable: true,
	value: vi.fn().mockImplementation(() => ({
		lang: "",
		continuous: false,
		interimResults: false,
		maxAlternatives: 1,
		onresult: null,
		onerror: null,
		onend: null,
		start: vi.fn(),
		stop: vi.fn(),
	})),
});

// ─── Mock Speech Synthesis ────────────────────────────────────────
Object.defineProperty(window, "speechSynthesis", {
	writable: true,
	configurable: true,
	value: {
		speak: vi.fn(),
		cancel: vi.fn(),
		getVoices: vi.fn().mockReturnValue([]),
		onvoiceschanged: null,
	},
});

// ─── Mock fetch ───────────────────────────────────────────────────
const mockFetch = vi.fn();
mockFetch.mockResolvedValue({
	ok: true,
	status: 200,
	json: () => Promise.resolve({}),
	text: () => Promise.resolve(""),
	headers: new Headers(),
});
window.fetch = mockFetch;

// ─── Mock RequestAnimationFrame ───────────────────────────────────
let rafId = 0;
window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
	rafId++;
	setTimeout(() => cb(Date.now()), 0);
	return rafId;
});

window.cancelAnimationFrame = vi.fn();
