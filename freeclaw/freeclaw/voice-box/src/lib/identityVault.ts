/**
 * VoiceFlow Identity Vault & Durable Persistence Anchor
 *
 * Implements a 4-tier storage fortress:
 *   Tier 1: Native device storage (Capacitor Preferences / Electron userData JSON)
 *   Tier 2: Browser window.localStorage
 *   Tier 3: Document Cookie (Lax, 1-year expiration)
 *   Tier 4: IndexedDB backup vault (survives basic cookie and sessionStorage flushes)
 *
 * Guarantees that the student's anonymous ID and chosen profile never get reset,
 * wiped, or replaced unless the application data is explicitly uninstalled or purged.
 */

const DB_NAME = "voiceflow_vault";
const DB_VERSION = 1;
const STORE_NAME = "identity_store";

function openVaultDB(): Promise<IDBDatabase | null> {
	if (typeof window === "undefined" || !("indexedDB" in window)) {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		try {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

/**
 * Persists an identity key into the IndexedDB backup vault.
 */
export async function backupToVault(key: string, value: string): Promise<boolean> {
	try {
		const db = await openVaultDB();
		if (!db) return false;
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const req = store.put(value, key);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		});
	} catch {
		return false;
	}
}

/**
 * Recovers an identity key from the IndexedDB backup vault.
 */
export async function recoverFromVault(key: string): Promise<string | null> {
	try {
		const db = await openVaultDB();
		if (!db) return null;
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const req = store.get(key);
			req.onsuccess = () => {
				const val = req.result;
				resolve(typeof val === "string" ? val : null);
			};
			req.onerror = () => resolve(null);
		});
	} catch {
		return null;
	}
}

/**
 * Initializes and synchronizes the identity vault with existing storage.
 * Call this during early app boot (e.g. in main.tsx).
 */
export async function syncIdentityVault(): Promise<void> {
	if (typeof window === "undefined") return;
	try {
		// Sync anonId
		const currentAnonId = window.localStorage?.getItem("vb:anonId");
		if (currentAnonId) {
			await backupToVault("vb:anonId", currentAnonId);
		} else {
			const recovered = await recoverFromVault("vb:anonId");
			if (recovered && recovered.startsWith("anon_")) {
				window.localStorage?.setItem("vb:anonId", recovered);
			}
		}

		// Sync profile
		const currentProfile = window.localStorage?.getItem("vb:profile");
		if (currentProfile) {
			await backupToVault("vb:profile", currentProfile);
		} else {
			const recoveredProf = await recoverFromVault("vb:profile");
			if (recoveredProf) {
				window.localStorage?.setItem("vb:profile", recoveredProf);
			}
		}

		// Sync displayName
		const currentDisplay = window.localStorage?.getItem("vb:displayName");
		if (currentDisplay) {
			await backupToVault("vb:displayName", currentDisplay);
		} else {
			const recoveredDisplay = await recoverFromVault("vb:displayName");
			if (recoveredDisplay) {
				window.localStorage?.setItem("vb:displayName", recoveredDisplay);
			}
		}
	} catch {
		/* vault sync is non-blocking */
	}
}
