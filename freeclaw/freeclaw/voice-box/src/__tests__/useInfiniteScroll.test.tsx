// ─── useInfiniteScroll tests ─────────────────────────────────────
// Locks in the infinite-scroll hook:
//   1. initial page load, cursor + hasMore tracking, dedupe
//   2. loadMore guards (in-flight / no-more), retry backoff, disable after 3
//   3. reset / replaceItems / setItems
//   4. IntersectionObserver auto-load (intersect, skip, unmount)

import {
	act,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

type AnyPage = { data?: unknown[]; nextCursor: string | null; total: number };

describe("useInfiniteScroll", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("loads the first page on mount with the configured limit", async () => {
		let resolveFirst!: (r: AnyPage) => void;
		const fetcher: any = vi.fn(
			() =>
				new Promise((res) => {
					resolveFirst = res;
				}),
		);
		const { result } = renderHook(() =>
			useInfiniteScroll<any>(fetcher, { limit: 10 }),
		);

		expect(result.current.initialLoading).toBe(true);
		await act(async () => {
			resolveFirst({
				data: [{ id: "a" }, { id: "b" }],
				nextCursor: "c2",
				total: 2,
			});
		});

		expect(fetcher).toHaveBeenCalledWith({ cursor: null, limit: 10 });
		expect(result.current.items).toEqual([{ id: "a" }, { id: "b" }]);
		expect(result.current.hasMore).toBe(true);
		expect(result.current.total).toBe(2);
		expect(result.current.initialLoading).toBe(false);
		expect(result.current.loading).toBe(false);
	});

	it("stops pagination when the first page has no next cursor", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "a" }], nextCursor: null, total: 1 });
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));

		await waitFor(() => expect(result.current.initialLoading).toBe(false));
		expect(result.current.hasMore).toBe(false);

		act(() => result.current.loadMore());
		expect(fetcher).toHaveBeenCalledTimes(1); // guarded by hasMoreRef
	});

	it("deduplicates items by id across pages", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: 1 }, { id: 2 }],
				nextCursor: "c2",
				total: 3,
			})
			.mockResolvedValueOnce({
				data: [{ id: 1 }, { id: 3 }],
				nextCursor: null,
				total: 3,
			});
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));

		await waitFor(() => expect(result.current.initialLoading).toBe(false));
		act(() => result.current.loadMore());
		await waitFor(() =>
			expect(result.current.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]),
		);
		expect(result.current.hasMore).toBe(false);
	});

	it("deduplicates items without ids via the stringify fallback", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({ data: ["x", "y"], nextCursor: "c2", total: 3 })
			.mockResolvedValueOnce({ data: ["x", "z"], nextCursor: null, total: 3 });
		const { result } = renderHook(() => useInfiniteScroll<string>(fetcher));

		await waitFor(() => expect(result.current.initialLoading).toBe(false));
		act(() => result.current.loadMore());
		await waitFor(() => expect(result.current.items).toEqual(["x", "y", "z"]));
	});

	it("tolerates missing data arrays", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({ data: undefined, nextCursor: "c2", total: 0 })
			.mockResolvedValueOnce({ data: undefined, nextCursor: null, total: 0 });
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));

		await waitFor(() => expect(result.current.initialLoading).toBe(false));
		expect(result.current.items).toEqual([]);

		act(() => result.current.loadMore());
		await waitFor(() => expect(result.current.hasMore).toBe(false));
		expect(result.current.items).toEqual([]);
	});

	it("disables pagination when the initial load fails", async () => {
		const fetcher: any = vi.fn().mockRejectedValue(new Error("network"));
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));

		await waitFor(() => expect(result.current.initialLoading).toBe(false));
		expect(result.current.hasMore).toBe(false);
		expect(result.current.items).toEqual([]);

		act(() => result.current.loadMore());
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("ignores loadMore while a request is in flight", async () => {
		let resolveFirst!: (r: AnyPage) => void;
		const fetcher: any = vi.fn(
			() =>
				new Promise((res) => {
					resolveFirst = res;
				}),
		);
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await act(async () => {
			resolveFirst({ data: [{ id: "a" }], nextCursor: "c2", total: 1 });
		});

		let resolveMore!: (r: AnyPage) => void;
		fetcher.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveMore = res;
				}),
		);
		act(() => {
			result.current.loadMore();
		});
		act(() => {
			result.current.loadMore();
		}); // in-flight → ignored

		expect(fetcher).toHaveBeenCalledTimes(2); // initial + first loadMore only

		await act(async () => {
			resolveMore({ data: [{ id: "b" }], nextCursor: null, total: 2 });
		});
		expect(result.current.items).toHaveLength(2);
		expect(result.current.hasMore).toBe(false);
	});

	it("retries failed pages with backoff and disables pagination after 3 failures", async () => {
		vi.useFakeTimers();
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			})
			.mockRejectedValueOnce(new Error("1"))
			.mockRejectedValueOnce(new Error("2"))
			.mockRejectedValueOnce(new Error("3"));
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await act(async () => {
			await Promise.resolve();
		});

		// fail #1 → schedules a retry in 1000ms
		await act(async () => {
			result.current.loadMore();
			await Promise.resolve();
		});
		// retry → fail #2 → schedules a retry in 2000ms
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		// retry → fail #3 → pagination disabled
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(result.current.hasMore).toBe(false);
	});

	it("skips the scheduled retry when a manual load is already running", async () => {
		vi.useFakeTimers();
		let resolveManual!: (r: AnyPage) => void;
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			})
			.mockRejectedValueOnce(new Error("boom"));
		fetcher.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveManual = res;
				}),
		);

		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await act(async () => {
			await Promise.resolve();
		});

		// fail → schedules a retry in 1000ms
		await act(async () => {
			result.current.loadMore();
			await Promise.resolve();
		});
		// start a manual load that stays pending
		act(() => {
			result.current.loadMore();
		});
		// retry timer fires while the manual load is in flight → skipped
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		await act(async () => {
			resolveManual({ data: [{ id: "b" }], nextCursor: null, total: 2 });
		});

		expect(fetcher).toHaveBeenCalledTimes(3); // initial + failed + manual
		expect(result.current.items).toEqual([{ id: "a" }, { id: "b" }]);
	});

	it("does not retry after unmount", async () => {
		vi.useFakeTimers();
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			})
			.mockRejectedValueOnce(new Error("boom"));
		const { result, unmount } = renderHook(() =>
			useInfiniteScroll<any>(fetcher),
		);
		await act(async () => {
			await Promise.resolve();
		});

		await act(async () => {
			result.current.loadMore();
			await Promise.resolve();
		}); // schedules retry
		unmount(); // cleanup flips mountedRef to false
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("reset clears state and reloads from the first page", async () => {
		let resolveSecond!: (r: AnyPage) => void;
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			});
		fetcher.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveSecond = res;
				}),
		);
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await waitFor(() => expect(result.current.items).toEqual([{ id: "a" }]));

		act(() => {
			result.current.reset();
		});

		// synchronously: items cleared, hasMore back on, reload triggered
		expect(result.current.items).toEqual([]);
		expect(result.current.hasMore).toBe(true);
		expect(result.current.total).toBe(0);
		expect(result.current.initialLoading).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher).toHaveBeenLastCalledWith({ cursor: null, limit: 30 });

		await act(async () => {
			resolveSecond({ data: [{ id: "z" }], nextCursor: null, total: 1 });
		});
		expect(result.current.items).toEqual([{ id: "z" }]);
		expect(result.current.hasMore).toBe(false);
	});

	// SMOOTHNESS: a filter change must not blank the list. softReset reloads
	// from the first page while KEEPING the current rows on screen (stale
	// while revalidate), so the table never flashes empty/skeletons; the new
	// page swaps in atomically when it lands.
	it("softReset keeps the current rows until the new page lands", async () => {
		let resolveSecond!: (r: AnyPage) => void;
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }, { id: "b" }],
				nextCursor: "c2",
				total: 2,
			});
		fetcher.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveSecond = res;
				}),
		);
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await waitFor(() => expect(result.current.items).toHaveLength(2));

		act(() => {
			result.current.softReset();
		});

		// Rows stay on screen; only the paging/total state resets.
		expect(result.current.items).toEqual([{ id: "a" }, { id: "b" }]);
		expect(result.current.hasMore).toBe(true);
		expect(result.current.total).toBe(0);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher).toHaveBeenLastCalledWith({ cursor: null, limit: 30 });

		await act(async () => {
			resolveSecond({ data: [{ id: "z" }], nextCursor: null, total: 1 });
		});
		expect(result.current.items).toEqual([{ id: "z" }]);
		expect(result.current.hasMore).toBe(false);
		expect(result.current.total).toBe(1);
	});

	// CORRECTNESS: a filter change re-bases the list. A page request that was
	// already in flight for the PREVIOUS filter set must be discarded, not
	// merged — otherwise its rows land under (or over) the new first page and
	// the list shows off-filter posts appearing from the top and the bottom.
	it("drops an in-flight page from a superseded list after softReset", async () => {
		const resolvers: Array<(r: AnyPage) => void> = [];
		const fetcher: any = vi.fn(
			() =>
				new Promise((res) => {
					resolvers.push(res);
				}),
		);
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await act(async () => {
			resolvers[0]!({ data: [{ id: "a" }], nextCursor: "c2", total: 1 });
		});
		expect(result.current.items).toEqual([{ id: "a" }]);

		// Page 2 of the old filter set is in flight…
		act(() => result.current.loadMore());
		expect(fetcher).toHaveBeenCalledTimes(2);

		// …when the filter changes and re-bases the list.
		act(() => result.current.softReset());
		expect(fetcher).toHaveBeenCalledTimes(3);

		// The stale page lands late: its rows must NOT be merged in.
		await act(async () => {
			resolvers[1]!({ data: [{ id: "stale" }], nextCursor: "c9", total: 99 });
		});
		expect(result.current.items).toEqual([{ id: "a" }]);

		// The replacement request still settles the list normally.
		await act(async () => {
			resolvers[2]!({ data: [{ id: "new" }], nextCursor: null, total: 1 });
		});
		expect(result.current.items).toEqual([{ id: "new" }]);
		expect(result.current.initialLoading).toBe(false);
		expect(result.current.loading).toBe(false);
	});

	// DEDUPE: rows injected from outside (realtime prepends, backfill,
	// optimistic edits) must register in the dedupe set, or the next page
	// appends them a second time — the same post rendered top and bottom.
	it("does not re-append a row that was injected through setItems", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			});
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await waitFor(() => expect(result.current.initialLoading).toBe(false));

		await act(async () => {
			result.current.setItems((prev) => [{ id: "live" }, ...prev]);
		});
		expect(result.current.items.map((i) => i.id)).toEqual(["live", "a"]);

		// A later page happens to include the injected row again.
		fetcher.mockResolvedValueOnce({
			data: [{ id: "live" }, { id: "b" }],
			nextCursor: null,
			total: 3,
		});
		await act(async () => {
			result.current.loadMore();
		});
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.items.map((i) => i.id)).toEqual(["live", "a", "b"]);
	});

	// replaceItems is a genuine replacement: the dedupe set re-seeds from the
	// new rows, so a row dropped by replaceItems can appear again later.
	it("re-seeds dedupe on replaceItems", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			});
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await waitFor(() => expect(result.current.initialLoading).toBe(false));

		await act(async () => {
			result.current.replaceItems([{ id: "x" }]);
		});

		fetcher.mockResolvedValueOnce({
			data: [{ id: "a" }],
			nextCursor: null,
			total: 2,
		});
		await act(async () => {
			result.current.loadMore();
		});
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.items.map((i) => i.id)).toEqual(["x", "a"]);
	});

	it("replaceItems and setItems update the item list", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "a" }], nextCursor: null, total: 1 });
		const { result } = renderHook(() => useInfiniteScroll<any>(fetcher));
		await waitFor(() => expect(result.current.initialLoading).toBe(false));

		await act(async () => {
			result.current.replaceItems([{ id: "r" }]);
		});
		expect(result.current.items).toEqual([{ id: "r" }]);

		await act(async () => {
			result.current.setItems((prev) => [...prev, { id: "s" }]);
		});
		expect(result.current.items).toEqual([{ id: "r" }, { id: "s" }]);
	});

	it("ignores a pending initial result after unmount", async () => {
		let resolveFirst!: (r: AnyPage) => void;
		const fetcher: any = vi.fn(
			() =>
				new Promise((res) => {
					resolveFirst = res;
				}),
		);
		const { unmount } = renderHook(() => useInfiniteScroll<any>(fetcher));

		unmount();
		await act(async () => {
			resolveFirst({ data: [{ id: "x" }], nextCursor: null, total: 1 });
		});
		// mountedRef guard returns early — no crash, no state update
	});

	it("ignores a pending loadMore result after unmount", async () => {
		let resolveMore!: (r: AnyPage) => void;
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 1,
			});
		fetcher.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveMore = res;
				}),
		);
		const { result, unmount } = renderHook(() =>
			useInfiniteScroll<any>(fetcher),
		);
		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			result.current.loadMore();
		}); // pending
		unmount();
		await act(async () => {
			resolveMore({ data: [{ id: "b" }], nextCursor: null, total: 2 });
		});
		// mountedRef guard returns early
	});
});

describe("useInfiniteScroll — IntersectionObserver", () => {
	// A real class so the hook can `new` it; vitest vi.fn(arrow) is not a constructor.
	class MockIntersectionObserver implements IntersectionObserver {
		static callback: ((entries: IntersectionObserverEntry[]) => void) | null =
			null;
		static observe = vi.fn();
		static disconnect = vi.fn();
		root = null;
		rootMargin = "0px";
		thresholds: ReadonlyArray<number> = [];
		unobserve = vi.fn();
		takeRecords() {
			return [];
		}
		observe() {
			return MockIntersectionObserver.observe();
		}
		disconnect() {
			return MockIntersectionObserver.disconnect();
		}
		constructor(cb: IntersectionObserverCallback) {
			// The hook stores a 1-arg arrow (entries) => void at runtime.
			MockIntersectionObserver.callback = cb as unknown as (
				entries: IntersectionObserverEntry[],
			) => void;
		}
	}

	beforeEach(() => {
		MockIntersectionObserver.callback = null;
		MockIntersectionObserver.observe.mockClear();
		MockIntersectionObserver.disconnect.mockClear();
		(window as any).IntersectionObserver = MockIntersectionObserver;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function Harness({ fetcher }: { fetcher: any }) {
		const { items, sentinelRef, loadMore } = useInfiniteScroll<any>(fetcher);
		return (
			<div>
				<div ref={sentinelRef} data-testid="sentinel" />
				<span data-testid="items">{items.length}</span>
				<button data-testid="more" onClick={loadMore}>
					more
				</button>
			</div>
		);
	}

	it("auto-loads when the sentinel becomes visible and disconnects on unmount", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ id: "a" }],
				nextCursor: "c2",
				total: 2,
			})
			.mockResolvedValueOnce({
				data: [{ id: "b" }],
				nextCursor: null,
				total: 2,
			});
		const { unmount } = render(<Harness fetcher={fetcher} />);

		await waitFor(() =>
			expect(screen.getByTestId("items").textContent).toBe("1"),
		);
		expect(MockIntersectionObserver.observe).toHaveBeenCalled();

		act(() => {
			MockIntersectionObserver.callback!([{ isIntersecting: true }] as any);
		});
		await waitFor(() =>
			expect(screen.getByTestId("items").textContent).toBe("2"),
		);
		expect(fetcher).toHaveBeenCalledTimes(2);

		unmount();
		expect(MockIntersectionObserver.disconnect).toHaveBeenCalled();
	});

	it("ignores non-intersecting and empty entries", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "a" }], nextCursor: "c2", total: 1 });
		render(<Harness fetcher={fetcher} />);

		await waitFor(() =>
			expect(screen.getByTestId("items").textContent).toBe("1"),
		);

		act(() => {
			MockIntersectionObserver.callback!([{ isIntersecting: false }] as any);
		});
		act(() => {
			MockIntersectionObserver.callback!([] as any);
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("does not auto-load when hasMore is false", async () => {
		const fetcher: any = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "a" }], nextCursor: null, total: 1 });
		render(<Harness fetcher={fetcher} />);

		await waitFor(() =>
			expect(screen.getByTestId("items").textContent).toBe("1"),
		);

		act(() => {
			MockIntersectionObserver.callback!([{ isIntersecting: true }] as any);
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("does not auto-load while a request is in flight", async () => {
		let resolveFirst!: (r: AnyPage) => void;
		const fetcher: any = vi.fn(
			() =>
				new Promise((res) => {
					resolveFirst = res;
				}),
		);
		render(<Harness fetcher={fetcher} />);

		act(() => {
			MockIntersectionObserver.callback!([{ isIntersecting: true }] as any);
		});
		expect(fetcher).toHaveBeenCalledTimes(1); // only the mount load

		await act(async () => {
			resolveFirst({ data: [{ id: "a" }], nextCursor: "c2", total: 1 });
		});
	});
});
