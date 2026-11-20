export const ADMIN_AUTH_KEY = "vb:adminAuth";
export const ADMIN_AUTH_EVENT = "vb:admin-session";

interface StoredAdminAuth {
	token: string;
	exp: number;
}

/**
 * Read one stored admin credential. Returns null for missing, malformed or
 * expired entries and purges the bad value so `hasAdminSession()` never
 * claims a session the server would reject.
 */
export function readAdminAuth(store: Storage | undefined): StoredAdminAuth | null {
	if (!store) return null;
	try {
		const raw = store.getItem(ADMIN_AUTH_KEY);
		if (!raw) return null;
		const { token, exp } = JSON.parse(raw) as {
			token?: unknown;
			exp?: unknown;
		};
		const expMs = typeof exp === "number" ? exp : Number(exp) || 0;
		if (typeof token !== "string" || !token || (expMs && expMs < Date.now())) {
			store.removeItem(ADMIN_AUTH_KEY);
			return null;
		}
		return { token, exp: expMs };
	} catch {
		try {
			store.removeItem(ADMIN_AUTH_KEY);
		} catch {
			/* storage unavailable — treat as no session */
		}
		return null;
	}
}

/**
 * Admin credential, shared across tabs.
 */
export function adminToken(): string | null {
	let local: Storage | undefined;
	let session: Storage | undefined;
	try {
		local = localStorage;
	} catch {
		/* private mode / blocked */
	}
	try {
		session = sessionStorage;
	} catch {
		/* blocked */
	}
	const fromLocal = readAdminAuth(local);
	const fromSession = readAdminAuth(session);
	const chosen =
		fromLocal && (!fromSession || fromLocal.exp >= fromSession.exp)
			? fromLocal
			: fromSession;
	return chosen?.token ?? null;
}

export function hasAdminSession(): boolean {
	return !!adminToken();
}

/**
 * Subscribe to admin-session changes made here (custom event) or in another
 * tab (storage event). Used by `useSyncExternalStore` so mounted feed cards
 * gain/lose moderation controls without a reload.
 */
export function subscribeAdminSession(onChange: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	const onStorage = (e: StorageEvent) => {
		if (e.key === ADMIN_AUTH_KEY || e.key === null) onChange();
	};
	window.addEventListener("storage", onStorage);
	window.addEventListener(ADMIN_AUTH_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", onStorage);
		window.removeEventListener(ADMIN_AUTH_EVENT, onChange);
	};
}

export function setAdminSession(token: string, exp: string | number) {
	const expMs = typeof exp === "number" ? exp : Date.parse(String(exp)) || 0;
	const value = JSON.stringify({ token, exp: expMs });
	try {
		localStorage.setItem(ADMIN_AUTH_KEY, value);
	} catch {
		/* fall through to the per-tab copy */
	}
	try {
		sessionStorage.setItem(ADMIN_AUTH_KEY, value);
	} catch {
		/* storage unavailable — hasAdminSession() stays false, server rejects */
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent(ADMIN_AUTH_EVENT));
	}
}

export function clearAdminSession() {
	try {
		localStorage.removeItem(ADMIN_AUTH_KEY);
	} catch {
		/* ignore */
	}
	try {
		sessionStorage.removeItem(ADMIN_AUTH_KEY);
	} catch {
		/* ignore */
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent(ADMIN_AUTH_EVENT));
	}
}
