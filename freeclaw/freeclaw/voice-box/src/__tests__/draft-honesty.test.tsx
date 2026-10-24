// ═══════════════════════════════════════════════════════════════════
// Draft autosave — no fake success states
// ═══════════════════════════════════════════════════════════════════
// Regression for "draft getting failed": the autosave said "Draft saved"
// unconditionally, even when the device store rejected the write (quota
// exceeded / storage blocked). The words were only kept in the tab's
// memory map, so a reload lost them with no warning.
//
// Contract now:
//   storeSet accepted  -> "Draft saved"
//   storeSet rejected  -> "Draft not saved …" (honest failure)
//   lsSet returns the durable result so callers can branch on it.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Submit from "../pages/Submit";
import { lsSet } from "../lib/identity";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	pushNotif: vi.fn(),
	fireConfetti: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	uploadImage: vi.fn(),
	/** When false, every storeSet call is rejected like a full/blocked store. */
	durable: { ok: true },
	store: new Map<string, string>(),
}));

vi.mock("../lib/storage", () => ({
	storeSet: (key: string, value: string) => {
		if (!mocks.durable.ok) return false;
		mocks.store.set(key, value);
		return true;
	},
	storeGet: (key: string) => mocks.store.get(key) ?? null,
	storeRemove: (key: string) => {
		mocks.store.delete(key);
	},
	storeClear: () => {
		mocks.store.clear();
	},
	storageBackend: () => "web" as const,
	storageReady: () => true,
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		post: mocks.post,
		uploadImage: mocks.uploadImage,
		postSlow: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		postLong: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		put: vi.fn(async () => ({})),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		pushNotif: mocks.pushNotif,
		accountStatus: null,
	}),
}));

vi.mock("../components/Confetti", () => ({
	fireConfetti: mocks.fireConfetti,
}));

beforeEach(() => {
	mocks.store.clear();
	mocks.durable.ok = true;
	mocks.get.mockReset();
	mocks.get.mockResolvedValue([]);
	// Submit's live moderation + duplicate probes post on every keystroke;
	// a bare vi.fn() returns undefined, which the real code correctly treats
	// as a promise and would crash on. Resolve so the debounce settles.
	mocks.post.mockReset();
	mocks.post.mockResolvedValue({});
});

function renderPage() {
	return render(
		<MemoryRouter>
			<Submit />
		</MemoryRouter>,
	);
}

function typeTitle(text: string) {
	fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
		target: { value: text },
	});
}

describe("draft autosave honesty", () => {
	it("lsSet reports whether the durable store accepted the write", () => {
		mocks.durable.ok = true;
		expect(lsSet("vb:probe", { a: 1 })).toBe(true);
		expect(mocks.store.get("vb:probe")).toBe(JSON.stringify({ a: 1 }));

		mocks.durable.ok = false;
		expect(lsSet("vb:probe2", { b: 2 })).toBe(false);
		expect(mocks.store.has("vb:probe2")).toBe(false);
	});

	it("says 'Draft saved' only when the write actually landed", async () => {
		renderPage();
		typeTitle("The lab projector is dead again");

		await waitFor(
			() => {
				expect(screen.getByText(/Draft saved/)).toBeTruthy();
			},
			{ timeout: 5000 },
		);
		expect(mocks.store.get("vb:drafts")).toContain("The lab projector");
		expect(screen.queryByText(/Draft not saved/)).toBeNull();
	});

	it("warns honestly instead of claiming a save when storage rejects it", async () => {
		renderPage();
		mocks.durable.ok = false;
		typeTitle("The lab projector is dead again");

		await waitFor(
			() => {
				expect(screen.getByText(/Draft not saved/)).toBeTruthy();
			},
			{ timeout: 5000 },
		);
		expect(screen.queryByText(/^Draft saved/)).toBeNull();
		// Nothing durable was written — the warning is the truth.
		expect(mocks.store.has("vb:drafts")).toBe(false);
	});
});
