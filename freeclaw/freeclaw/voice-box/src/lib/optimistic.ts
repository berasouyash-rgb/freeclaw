// Optimistic row updates with rollback — admin actions (hide, pin, verify,
// status changes) reflect instantly instead of waiting out a full PUT
// round-trip on slow school Wi-Fi. On failure the snapshot restores the
// exact previous row, so a failed tap can never leave a phantom state.

export interface OptimisticResult<T> {
	rows: T[];
	/** The row as it was before the patch (undefined when the id was absent). */
	prev: T | undefined;
}

/** Apply a patch to one row by id, snapshotting the previous row. Pure. */
export function applyOptimistic<T extends { id: string }>(
	rows: T[],
	id: string,
	patch: Partial<T>,
): OptimisticResult<T> {
	const prev = rows.find((r) => r.id === id);
	return {
		rows: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
		prev,
	};
}

/** Restore the snapshotted row. Pure — a no-op when the id was absent. */
export function revertOptimistic<T extends { id: string }>(
	rows: T[],
	prev: T | undefined,
): T[] {
	if (!prev) return rows;
	return rows.map((r) => (r.id === prev.id ? prev : r));
}
