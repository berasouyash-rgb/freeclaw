// ─── Backend error taxonomy ─────────────────────────────────────
// Every failure crossing the data-plane boundary is classified so the
// failover controller can make a decision instead of guessing, and so no
// raw driver message ever reaches a user.

export class BackendError extends Error {
	/**
	 * @param {string} message
	 * @param {{ code?: string, retryable?: boolean, cause?: unknown, adapter?: string }} [opts]
	 */
	constructor(message, opts = {}) {
		super(message);
		this.name = "BackendError";
		this.code = opts.code || "BACKEND_ERROR";
		this.retryable = opts.retryable ?? false;
		this.adapter = opts.adapter || null;
		if (opts.cause) this.cause = opts.cause;
	}
}

/** The adapter has no usable configuration (missing credentials). */
export class AdapterUnavailableError extends BackendError {
	constructor(adapter, reason) {
		super(`${adapter} is unavailable: ${reason}`, {
			code: "ADAPTER_UNAVAILABLE",
			retryable: false,
			adapter,
		});
		this.name = "AdapterUnavailableError";
	}
}

/** A call exceeded its deadline. Always retryable. */
export class AdapterTimeoutError extends BackendError {
	constructor(adapter, ms) {
		super(`${adapter} timed out after ${ms}ms`, {
			code: "ADAPTER_TIMEOUT",
			retryable: true,
			adapter,
		});
		this.name = "AdapterTimeoutError";
	}
}

/** A write was rejected because the entity version is stale. Never retry blindly. */
export class StaleWriteError extends BackendError {
	constructor(table, id, expected, actual) {
		super(`Stale write rejected for ${table}/${id}`, {
			code: "STALE_WRITE",
			retryable: false,
		});
		this.name = "StaleWriteError";
		this.table = table;
		this.id = id;
		this.expected = expected;
		this.actual = actual;
	}
}

/** Failover is active and the requested operation is a write. */
export class ReadOnlyError extends BackendError {
	constructor(reason) {
		super(reason || "Writes are paused while the primary data plane recovers", {
			code: "READ_ONLY_MODE",
			retryable: true,
		});
		this.name = "ReadOnlyError";
	}
}

/** Converts any thrown value into a classified BackendError. */
export function classify(err, adapter) {
	if (err instanceof BackendError) return err;
	const message = String(err?.message || err || "unknown error");
	if (/timeout|timed out|ETIMEDOUT|aborted/i.test(message)) {
		return new AdapterTimeoutError(adapter || "backend", 0);
	}
	if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(message)) {
		return new BackendError(message, {
			code: "ADAPTER_UNREACHABLE",
			retryable: true,
			adapter,
			cause: err,
		});
	}
	return new BackendError(message, {
		code: "ADAPTER_ERROR",
		retryable: false,
		adapter,
		cause: err,
	});
}

/** User-safe message. Never includes driver detail, SQL, or credentials. */
export function userSafeMessage(err) {
	if (err instanceof ReadOnlyError) return "Saving is paused for a moment. Please try again shortly.";
	if (err instanceof StaleWriteError) return "This item changed since you opened it. Reload and try again.";
	if (err instanceof BackendError && err.retryable) {
		return "The service is briefly unavailable. Please try again.";
	}
	return "Something went wrong. Please try again.";
}
