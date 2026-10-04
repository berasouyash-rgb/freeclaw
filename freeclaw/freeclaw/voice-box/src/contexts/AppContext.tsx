import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { api } from "../lib/api";
import { showBrowserNotification } from "../lib/browserNotify";
import {
	getAnonId,
	getDisplayName,
	getProfile,
	lsGet,
	lsSet,
	setDisplayName as persistDisplayName,
	setProfile as persistProfile,
	type LocalProfile,
} from "../lib/identity";
import { navigateTo } from "../lib/platform";
import type {
	AccountStatus,
	ChatMessage,
	Notification,
	NotificationKind,
	PostData,
} from "../types";

/** Lightweight shapes for the notification-polling responses */
interface PollVote {
	poll_id: string;
}
interface PollWithMeta extends PollVote {
	id: string;
	archived: boolean;
	expires_at?: string;
	title: string;
}
interface ChatResponse {
	messages?: ChatMessage[];
}

interface NotifSnapshot {
	[postId: string]:
		| { status: string; comments: number; reply: boolean }
		| boolean // poll_* endings
		| number // __chatUnread
		| undefined; // optional named props (e.g. __chatUnread?) add undefined
	/** Chat unread count — typed explicitly for type-safe access. */
	__chatUnread?: number;
}

/** Shape of a notification stored server-side (admin warnings, suspensions, bans). */
interface ServerNotif {
	id: string;
	type: string;
	title: string;
	body: string;
	post_id?: string | null;
	read: boolean;
	created_at: string;
}

// Map a server-side notification (from /api/notifications, written by admin
// actions like warn/suspend/ban) into the client Notification shape. Returns
// null for malformed entries so a corrupt row can never crash the UI.
// Server types pass through verbatim when known; anything unrecognized
// becomes generic info instead of crashing KIND_META lookups downstream.
const KNOWN_NOTIF_TYPES: NotificationKind[] = [
	"status",
	"reply",
	"comment",
	"chat",
	"poll",
	"info",
	"submitted",
	"mention",
	"warning",
	"success",
	"suspension",
	"suspension_lifted",
	"ban",
	"unban",
	"moderation",
];
function mapServerNotif(n: ServerNotif): Notification | null {
	if (!n || typeof n.id !== "string" || !n.id) return null;
	const t = String(n.type || "");
	const kind: NotificationKind =
		t === "success"
			? "status"
			: KNOWN_NOTIF_TYPES.includes(t as NotificationKind)
				? (t as NotificationKind)
				: "info";
	return {
		id: n.id,
		kind,
		title: String(n.title || "Notification"),
		body: String(n.body || ""),
		link: n.post_id ? `/post/${n.post_id}` : undefined,
		at: n.created_at || new Date().toISOString(),
		read: !!n.read,
	};
}

export type { Notification, NotificationKind };

interface Toast {
	id: number;
	text: string;
	kind: "ok" | "err" | "info";
	action?: { label: string; fn: () => void };
}

type ThemePref = "system" | "light" | "dark";

/** Appearance preferences that actually take effect (via <html> data attrs). */
interface DisplayPrefs {
	compactMode: boolean;
	showAvatars: boolean;
	animationsEnabled: boolean;
	glassEnabled: boolean;
	/** Base UI scale in percent — 95 = 5% smaller than the browser default. */
	uiScale: number;
}

const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
	compactMode: false,
	showAvatars: true,
	animationsEnabled: true,
	glassEnabled: false,
	uiScale: 95,
};

interface AppCtx {
	anonId: string;
	displayName: string;
	setDisplayName: (name: string) => void;
	profile: LocalProfile;
	setProfile: (p: LocalProfile) => LocalProfile;
	theme: ThemePref;
	setTheme: (t: ThemePref) => void;
	toggleTheme: () => void;
	displayPrefs: DisplayPrefs;
	setDisplayPrefs: (p: DisplayPrefs) => void;
	bookmarks: string[];
	toggleBookmark: (id: string) => void;
	notifications: Notification[];
	markNotifsRead: () => void;
	/** Mark one notification read when its deep link is opened (§11). */
	markNotifRead: (id: string) => void;
	clearNotifs: () => void;
	pushNotif: (n: Omit<Notification, "id" | "at" | "read">) => void;
	/** Drop notices pointing at a deleted/retired link (e.g. `/post/:id`) so
	 *  the notification list can never claim more live posts than exist. */
	retireNotifsForLink: (link: string) => void;
	toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
	toasts: Toast[];
	refreshIdentity: () => void;
	recentlyViewed: string[];
	addRecentlyViewed: (id: string) => void;
	chatUnread: number;
	setChatUnread: (n: number) => void;
	accountStatus: AccountStatus | null;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error("useApp must be used within <AppProvider>");
	return ctx;
};

let toastSeq = 1;

/* v8 ignore start -- @preserve */
// Toast action callback — never exercised in unit tests because the
// toast UI button renders outside <AppProvider>.
const _toastAction = () => {
	navigateTo("/chat");
};
/* v8 ignore stop -- @preserve */

export function AppProvider({ children }: { children: ReactNode }) {
	const [anonId, setAnonId] = useState(getAnonId);
	const [displayName, setDisplayNameState] = useState(getDisplayName);
	const setDisplayName = useCallback((name: string) => {
		const clean = name.trim().slice(0, 24);
		persistDisplayName(clean);
		setDisplayNameState(clean);
	}, []);
	// Tracks the last-known account status across heartbeats. Must be a ref:
	// the heartbeat effect only re-runs on [anonId], so a state value captured
	// in its closure would be frozen at the initial `null` forever — silently
	// disabling strike/warning detection.
	const prevStatusRef = useRef<AccountStatus | null>(null);
	const [profile, setProfileState] = useState<LocalProfile>(getProfile);
	const setProfile = useCallback((p: LocalProfile): LocalProfile => {
		const clean = persistProfile(p);
		setProfileState(clean);
		return clean;
	}, []);
	// Theme preference: "system" follows the OS via a matchMedia listener.
	const [theme, setThemeState] = useState<ThemePref>(() =>
		lsGet<ThemePref>("vb:theme", "system"),
	);
	const [systemDark, setSystemDark] = useState(
		() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
	);
	const resolvedTheme: "light" | "dark" =
		theme === "system" ? (systemDark ? "dark" : "light") : theme;
	// Follow OS changes while the preference is "system".
	useEffect(() => {
		if (theme !== "system") return;
		let mq: MediaQueryList | undefined;
		try {
			mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		} catch {
			/* not supported — static fallback is fine */
		}
		if (!mq?.addEventListener) return;
		const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, [theme]);
	// Display preferences — owned here so every consumer gets the same applied
	// state and the <html> attributes stay in sync.
	const [displayPrefs, setDisplayPrefs] = useState<DisplayPrefs>(() =>
		lsGet("vb:display-prefs", DEFAULT_DISPLAY_PREFS),
	);
	const [bookmarks, setBookmarks] = useState<string[]>(() =>
		lsGet("vb:bookmarks", []),
	);
	const [notifications, setNotifications] = useState<Notification[]>(() =>
		lsGet("vb:notifications", []),
	);
	const [recentlyViewed, setRecentlyViewed] = useState<string[]>(() =>
		lsGet("vb:recentlyViewed", []),
	);
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [chatUnread, setChatUnread] = useState(0);
	const [accountStatus, setAccountStatus] =
		useState<AppCtx["accountStatus"]>(null);

	// Latest bookmarks mirror for the persist call (avoids stale closure)
	const bookmarksRef = useRef<string[]>(bookmarks);
	useEffect(() => {
		bookmarksRef.current = bookmarks;
	}, [bookmarks]);
	// Latest notifications mirror — lets markNotifsRead/clearNotifs act on the
	// current list without a stale closure and without side effects inside a
	// state updater.
	const notificationsRef = useRef<Notification[]>(notifications);
	/** True when the last engine pass was skipped while hidden. */
	const wasAwayRef = useRef(false);
	useEffect(() => {
		notificationsRef.current = notifications;
	}, [notifications]);

	// Heartbeat: registers this browser's anonymous ID (so it appears in admin
	// immediately, before any post) AND returns live ban/suspension/warning status.
	// Also detects new warnings/strikes and fires a notification popup.
	useEffect(() => {
		let cancelled = false;
		const beat = () =>
			api
				.post<AccountStatus>("/api/users", { anon_id: anonId })
				.then((s) => {
					if (cancelled) return;
					const prev = prevStatusRef.current;
					prevStatusRef.current = s;
					setAccountStatus(s);
					// Detect NEW warning (strike increased) or NEW ban — only fire on a
					// real change. The pre-publish review queue issues ban + strike in a
					// single update, so the strike branch alone would never fire for it:
					// banning must ALWAYS produce a popup.
					if (prev && s) {
						const prevStrikes = prev.strikes || 0;
						const newStrikes = s.strikes || 0;
						const newlyBanned = !prev.banned && !!s.banned;
						if (newlyBanned) {
							pushNotif({
								kind: "info",
								title: "🚫 Your account has been banned",
								body: "This anonymous ID can no longer post, comment, or vote. Contact an admin if you believe this is a mistake.",
								link: "/chat",
							});
							toast("🚫 Your anonymous ID has been permanently banned", "err", {
								label: "Details",
								fn: _toastAction,
							});
						} else if (newStrikes > prevStrikes && !s.banned) {
							const warningText = s.latest_warning || "";
							pushNotif({
								kind: "info",
								title: "⚠️ You received a warning from admin",
								body: warningText
									? `"${warningText}"`
									: `Strike ${newStrikes} of 3. Too many strikes may result in a ban.`,
								link: "/chat",
							});
							// Also show as toast (auto-dismissed after 30s)
							toast(
								warningText
									? `⚠️ Warning: "${warningText.slice(0, 80)}" (${newStrikes}/3 strikes)`
									: `⚠️ Strike ${newStrikes} of 3 issued against your account`,
								"err",
								{ label: "View", fn: _toastAction },
							);
						}
					}
				})
				.catch((e: unknown) => {
					console.warn(
						"[AppContext] heartbeat failed:",
						e instanceof Error ? e.message : e,
					);
				});
		beat();
		// One initial heartbeat per identity. Do not poll every open tab or
		// re-register on visibility; route entry or an explicit user action is
		// the refresh boundary.
		return () => {
			cancelled = true;
		};
	}, [anonId]); // eslint-disable-line react-hooks/exhaustive-deps

	// Apply the REAL appearance: resolved theme + glass/animation/density
	// toggles become <html> data attributes that index.css reacts to.
	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", resolvedTheme === "dark");
		root.dataset.glass = displayPrefs.glassEnabled ? "on" : "off";
		root.dataset.anim = displayPrefs.animationsEnabled ? "on" : "off";
		root.dataset.density = displayPrefs.compactMode ? "compact" : "relaxed";
		root.dataset.avatars = displayPrefs.showAvatars ? "on" : "off";
		root.dataset.scale = String(displayPrefs.uiScale ?? 100);
		lsSet("vb:theme", theme);
		lsSet("vb:display-prefs", displayPrefs);
	}, [resolvedTheme, displayPrefs, theme]);

	const setTheme = useCallback((t: ThemePref) => setThemeState(t), []);
	const toggleTheme = useCallback(
		() =>
			setThemeState((t) =>
				t === "system"
					? (resolvedTheme === "dark" ? "light" : "dark")
					: t === "dark"
						? "light"
						: "dark",
			),
		[resolvedTheme],
	);

	const toggleBookmark = useCallback(
		(id: string) => {
			const currentlySaved = bookmarksRef.current.includes(id);
			setBookmarks((prev) => {
				const next = prev.includes(id)
					? prev.filter((b) => b !== id)
					: [...prev, id];
				lsSet("vb:bookmarks", next);
				return next;
			});
			// Persist server-side so saves survive across devices (fire-and-forget, offline-safe)
			api
				.post("/api/saved", {
					user_id: anonId,
					post_id: id,
					saved: !currentlySaved,
				})
				.catch(() => {
					/* offline-friendly: local list stays authoritative until next sync */
				});
		},
		[anonId],
	);

	// Sync server-persisted saved posts into local bookmarks on load.
	// Union-merge so offline-only saves are never clobbered.
	useEffect(() => {
		// Defense-in-depth: getAnonId() always returns a string; this guard
		// is unreachable but documents the dependency invariant.
		/* v8 ignore next -- @preserve */
		if (!anonId) return;
		let cancelled = false;
		api
			.get<{ saved: string[] }>(`/api/saved?user_id=${anonId}`)
			.then((r) => {
				if (cancelled) return;
				const server = r.saved || [];
				setBookmarks((prev) => {
					const merged = Array.from(new Set([...prev, ...server]));
					lsSet("vb:bookmarks", merged);
					return merged;
				});
			})
			.catch(() => {
				/* offline-friendly */
			});
		return () => {
			cancelled = true;
		};
	}, [anonId]);

	const addRecentlyViewed = useCallback((id: string) => {
		setRecentlyViewed((prev) => {
			const next = [id, ...prev.filter((p) => p !== id)].slice(0, 20);
			lsSet("vb:recentlyViewed", next);
			return next;
		});
	}, []);

	const pushNotif = useCallback(
		(n: Omit<Notification, "id" | "at" | "read">) => {
			setNotifications((prev) => {
				// Dedupe: an identical unread notice within 60s is a double-fire
				// (double submit, re-mount replay), never two real events.
				const now = Date.now();
				const dup = prev.some(
					(p) =>
						!p.read &&
						p.kind === n.kind &&
						p.title === n.title &&
						p.body === n.body &&
						(p.link || null) === (n.link || null) &&
						now - new Date(p.at).getTime() < 60000,
				);
				if (dup) return prev;
				const next = [
					{
						...n,
						id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
						at: new Date().toISOString(),
						read: false,
					},
					...prev,
				].slice(0, 60);
				lsSet("vb:notifications", next);
				return next;
			});
		},
		[],
	);

	const markNotifsRead = useCallback(() => {
		// Mirror read state to the server for admin-issued notifications so a
		// later re-sync doesn't resurrect the unread badge (fire-and-forget).
		notificationsRef.current
			.filter((n) => !n.read && n.id.startsWith("notif_"))
			.forEach((n) => {
				api
					.post("/api/notifications", {
						user_id: anonId,
						notification_id: n.id,
					})
					.catch(() => {
						/* offline-friendly */
					});
			});
		setNotifications((prev) => {
			const next = prev.map((n) => ({ ...n, read: true }));
			lsSet("vb:notifications", next);
			return next;
		});
	}, [anonId]);

	const markNotifRead = useCallback(
		(id: string) => {
			const target = notificationsRef.current.find((n) => n.id === id);
			if (target && !target.read && target.id.startsWith("notif_")) {
				api
					.post("/api/notifications", {
						user_id: anonId,
						notification_id: target.id,
					})
					.catch(() => {
						/* offline-friendly */
					});
			}
			setNotifications((prev) => {
				if (prev.every((n) => n.id !== id || n.read)) return prev;
				const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
				lsSet("vb:notifications", next);
				return next;
			});
		},
		[anonId],
	);

	const clearNotifs = useCallback(() => {		setNotifications([]);
		lsSet("vb:notifications", []);
		// Clear the server store too so a re-sync can't resurrect cleared items.
		api
			.del(`/api/notifications?user_id=${anonId}`, {})
			.catch(() => {
				/* offline-friendly */
			});
	}, [anonId]);

	const retireNotifsForLink = useCallback((link: string) => {
		setNotifications((prev) => {
			const next = prev.filter((n) => n.link !== link);
			if (next.length === prev.length) return prev;
			lsSet("vb:notifications", next);
			return next;
		});
	}, []);

	const toast = useCallback(
		(text: string, kind: Toast["kind"] = "info", action?: Toast["action"]) => {
			const id = toastSeq++;
			setToasts((prev) => [...prev, { id, text, kind, action }]);
			setTimeout(
				() => setToasts((prev) => prev.filter((t) => t.id !== id)),
				action ? 30000 : 3800,
			);
		},
		[],
	);

	const refreshIdentity = useCallback(() => {
		setAnonId(getAnonId());
		setBookmarks(lsGet("vb:bookmarks", []));
		setNotifications(lsGet("vb:notifications", []));
		setRecentlyViewed(lsGet("vb:recentlyViewed", []));
	}, []);

	// ---------- presence heartbeat ----------
	// One lightweight last_seen touch per minute while the tab is visible so
	// the admin Users table can show real "online now" presence. Paused when
	// the tab is hidden; the server additionally throttles to one write per
	// id per 45s. This is the single sanctioned background write in the
	// client — failures are silent (presence is advisory, never blocking).
	useEffect(() => {
		const beat = () => {
			if (document.hidden) return;
			api.post("/api/me", { action: "heartbeat" }).catch(() => {});
		};
		beat();
		const iv = window.setInterval(beat, 60_000);
		return () => window.clearInterval(iv);
	}, []);

	// ---------- background notification engine ----------
	// Runs every 120s, pauses when tab is hidden to save API calls.
	useEffect(() => {
		let cancelled = false;
		async function check() {
			// Skip if tab is hidden — will catch up when user returns
			if (document.hidden) {
				wasAwayRef.current = true;
				return;
			}
			const freshTitles: string[] = [];
			const notifyFresh = (n: Omit<Notification, "id" | "at" | "read">) => {
				freshTitles.push(n.title);
				pushNotif(n);
			};
			try {
				const [mine, chat, serverNotifs] = await Promise.all([
					api
						.getSlow<PostData[]>(`/api/posts?author=${anonId}&viewer=${anonId}`)
						.catch((): PostData[] => []),
					api
						.get<ChatResponse | null>(`/api/chat?thread_id=${anonId}`)
						.catch((): null => null),
					api
						.get<{ notifications?: ServerNotif[] }>(
							`/api/notifications?user_id=${anonId}`,
						)
						.catch((): { notifications?: ServerNotif[] } => ({})),
				]);
				if (cancelled) return;
				// Merge admin-issued notifications (warnings, suspensions, bans) that
				// were written server-side — they must reach the user even on a fresh
				// visit or after localStorage was cleared. Client notifications keep
				// their ids (n_*) so nothing gets clobbered or duplicated.
				if (serverNotifs?.notifications?.length) {
					const mapped = serverNotifs.notifications
						.map(mapServerNotif)
						.filter((n): n is Notification => n !== null);
					setNotifications((prev) => {
						const have = new Set(prev.map((p) => p.id));
						const fresh = mapped.filter((m) => !have.has(m.id));
						if (fresh.length === 0) return prev;
						const next = [...fresh, ...prev].slice(0, 60);
						lsSet("vb:notifications", next);
						return next;
					});
				}
				const snapshot = lsGet<NotifSnapshot>("vb:notifSnapshot", {});
				const nextSnap: NotifSnapshot = {};
				for (const p of mine) {
					nextSnap[p.id] = {
						status: p.status,
						comments: p.comment_count ?? 0,
						reply: !!p.admin_reply,
					};
					const prev = snapshot[p.id];
					if (!prev || typeof prev !== "object" || !("status" in prev))
						continue;
					if (prev.status !== p.status) {
						notifyFresh({
							kind: "status",
							title:
								p.status === "solved"
									? "✅ Your issue was solved!"
									: `Status updated: ${p.status.replace("_", " ")}`,
							body: p.title,
							link: `/post/${p.id}`,
						});
					}
					if (!prev.reply && p.admin_reply) {
						notifyFresh({
							kind: "reply",
							title: "💬 Admin replied to your post",
							body: p.title,
							link: `/post/${p.id}`,
						});
					}
					if ((p.comment_count ?? 0) > prev.comments) {
						notifyFresh({
							kind: "comment",
							title: `💬 ${(p.comment_count ?? 0) - prev.comments} new comment(s)`,
							body: p.title,
							link: `/post/${p.id}`,
						});
					}
				}
				// unread admin AND ai chat messages → badge in nav + notification.
				// AI replies used to be invisible here (only "admin" counted), so a
				// reply landing while the user was on another page never raised
				// any signal — the inbox looked dead until reopened.
				if (chat) {
					const unreadIncoming = (chat.messages ?? []).filter(
						(m) => m.sender !== "user" && !m.read,
					);
					setChatUnread(unreadIncoming.length);
					const prevUnread =
						typeof snapshot.__chatUnread === "number"
							? snapshot.__chatUnread
							: 0;
					if (unreadIncoming.length > prevUnread) {
						const hasAdmin = unreadIncoming.some(
							(m) => m.sender === "admin",
						);
						notifyFresh({
							kind: "chat",
							title: hasAdmin
								? "✉️ New message from admin"
								: "🤖 New reply in your inbox",
							body: "Open your inbox to read it.",
							link: "/chat",
						});
					}
					nextSnap.__chatUnread = unreadIncoming.length;
				}

				// poll endings — voted ids joined against the full poll list for metadata
				try {
					const polls = await api
						.get<PollVote[]>(`/api/polls?voter=${anonId}`)
						.catch((): PollVote[] => []);
					const votedIds = new Set(polls.map((v) => v.poll_id));
					if (votedIds.size) {
						// /api/polls?voter= returns only { poll_id, choices } rows — fetch the
						// full listing (which carries id/title/archived/expires_at) to detect ends.
						const allPolls = await api
							.get<PollWithMeta[]>(`/api/polls`)
							.catch((): PollWithMeta[] => []);
						const byId = new Map(allPolls.map((p) => [p.id, p]));
						for (const pid of votedIds) {
							const poll = byId.get(pid);
							if (!poll) continue;
							const ended =
								poll.archived ||
								(poll.expires_at && new Date(poll.expires_at) < new Date());
							nextSnap[`poll_${pid}`] = !!ended;
							if (ended && snapshot[`poll_${pid}`] === false) {
								notifyFresh({
									kind: "poll",
									title: "📊 A poll you voted in has ended",
									body: poll.title,
									link: "/polls",
								});
							}
						}
					}
				} catch {
					/* skip */
				}

				lsSet("vb:notifSnapshot", nextSnap);
				if (wasAwayRef.current && freshTitles.length > 0) {
				try {
				const mirror = lsGet<{ enabled?: boolean }>("vb:browser-notify", {});
				if (mirror.enabled !== false) {
				const first = freshTitles[0] || "New update";
				showBrowserNotification({
				title: freshTitles.length === 1 ? first : freshTitles.length + " updates while you were away",
				body: freshTitles.slice(0, 3).join(" \u00b7 ").slice(0, 160),
				tag: "voice-flow-catchup",
				url: "/activity",
				});
				}
				} catch {
					/* ping is best-effort — in-app notifications already delivered */
				}
				}
				wasAwayRef.current = false;
			} catch {
				/* offline-friendly: silently skip */
			}
		}
		check();
		// Catch-up is intentionally one-shot after mount. A quiet tab must not
		// generate recurring full-history notification requests.
		return () => {
			cancelled = true;
		};
	}, [anonId, pushNotif]);

	// Memoize context value to prevent unnecessary re-renders in consumers.
	// All callbacks are already stable via useCallback; useMemo prevents a new
	// object reference on every render which would force all 44+ useApp() callers
	// to re-render even when their consumed values haven't changed.
	const value = useMemo<AppCtx>(
		() => ({
			anonId,
			theme,
			setTheme,
			toggleTheme,
			displayPrefs,
			setDisplayPrefs,
			profile,
			setProfile,
			bookmarks,
			toggleBookmark,
			notifications,
			markNotifsRead,
			markNotifRead,
			clearNotifs,
			pushNotif,
			retireNotifsForLink,
			toast,
			toasts,
			refreshIdentity,
			recentlyViewed,
			addRecentlyViewed,
			chatUnread,
			setChatUnread,
			accountStatus,
			displayName,
			setDisplayName,
		}),
		[
			anonId,
			displayName,
			setDisplayName,
			profile,
			setProfile,
			theme,
			setTheme,
			toggleTheme,
			displayPrefs,
			setDisplayPrefs,
			bookmarks,
			toggleBookmark,
			notifications,
			markNotifsRead,
			markNotifRead,
			clearNotifs,
			pushNotif,
			retireNotifsForLink,
			toast,
			toasts,
			refreshIdentity,
			recentlyViewed,
			addRecentlyViewed,
			chatUnread,
			setChatUnread,
			accountStatus,
		],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
