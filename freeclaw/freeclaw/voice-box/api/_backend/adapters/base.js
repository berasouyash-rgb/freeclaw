// ─── Adapter contract ───────────────────────────────────────────
// A BackendAdapter is the only thing the routing engine talks to. It hides
// whether rows live in Supabase Postgres or Firebase Firestore.
//
// Required surface:
//   name                                  "supabase" | "firebase" | "memory"
//   capabilities                          { read, write }
//   health()                    -> { ok, latencyMs }
//   select(table, opts)         -> rows[]
//   get(table, id)              -> row | null
//   insert(table, row)          -> row
//   update(table, id, patch, o) -> row
//   upsert(table, rows, o)      -> number
//   remove(table, id)           -> boolean
//
// `opts` for select:
//   { where?: Record<string, unknown>, since?: { column, value },
//     orderBy?: string, ascending?: boolean, limit?: number }
//
// Adapters MUST throw AdapterUnavailableError when they lack configuration,
// and MUST never return a fabricated row.

export class BaseAdapter {
	constructor(name) {
		this.name = name;
		this.capabilities = { read: true, write: true };
	}

	async health() {
		throw new Error(`${this.name}.health() not implemented`);
	}

	async select() {
		throw new Error(`${this.name}.select() not implemented`);
	}

	async get() {
		throw new Error(`${this.name}.get() not implemented`);
	}

	async insert() {
		throw new Error(`${this.name}.insert() not implemented`);
	}

	async update() {
		throw new Error(`${this.name}.update() not implemented`);
	}

	async upsert() {
		throw new Error(`${this.name}.upsert() not implemented`);
	}

	async remove() {
		throw new Error(`${this.name}.remove() not implemented`);
	}
}

/** Applies select options to a plain array. Shared by memory-like adapters. */
export function applySelectOptions(rows, opts = {}) {
	let out = rows;
	if (opts.where && typeof opts.where === "object") {
		const entries = Object.entries(opts.where);
		out = out.filter((row) => entries.every(([k, v]) => row?.[k] === v));
	}
	if (opts.since && opts.since.column) {
		const { column, value } = opts.since;
		if (value !== undefined && value !== null) {
			out = out.filter((row) => {
				const cell = row?.[column];
				if (cell == null) return false;
				return String(cell) > String(value);
			});
		}
	}
	if (opts.orderBy) {
		const dir = opts.ascending === false ? -1 : 1;
		out = [...out].sort((a, b) => {
			const av = a?.[opts.orderBy];
			const bv = b?.[opts.orderBy];
			if (av === bv) return 0;
			return (av > bv ? 1 : -1) * dir;
		});
	}
	if (typeof opts.limit === "number" && opts.limit >= 0) {
		out = out.slice(0, opts.limit);
	}
	return out;
}
