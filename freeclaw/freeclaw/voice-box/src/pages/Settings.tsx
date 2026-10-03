// ─── User Settings Page ──────────────────────────────────────────
// Full user-facing preferences:
//   • Notifications — sound / mentions / replies / updates / email
//   • Display — REAL theme (system/light/dark), glass morphism,
//     animations, compact density, avatars (all actually applied)
//   • Account — display name, avatar + bio, tutorial reset, data export
//   • Privacy — what we collect / don't collect
//
// Every toggle here takes real effect (AppContext applies <html> data
// attributes that index.css reacts to). No fake buttons.

import {
	Bell,
	Camera,
	Check,
	Download,
	Eye,
	Image as ImageIcon,
	Monitor,
	Moon,
	PenLine,
	RotateCcw,
	Settings as SettingsIcon,
	Shield,
	Sparkles,
	Sun,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resetTutorial } from "../components/Tutorial";
import { ConfirmDialog } from "../components/ui";
import { useApp } from "../contexts/AppContext";
import {
	browserNotifyPermission,
	requestBrowserNotifyPermission,
	showBrowserNotification,
} from "../lib/browserNotify";
import { api } from "../lib/api";
import { sendNotificationEmail } from "../lib/email";
import {
	adoptIdentity,
	createLinkCode,
	getDisplayName,
	parseLinkCode,
	resetAnonId,
} from "../lib/identity";
import {
	INFRASTRUCTURE_COPY,
	LOCAL_PROFILE_COPY,
	NOTIFY_PRIVACY_COPY,
	RETENTION_COPY,
} from "../lib/privacyCopy";

interface NotifyChannelPrefs {
	phone: string;
	email: string;
	sms_enabled: boolean;
	email_enabled: boolean;
	browser_enabled: boolean;
	status_updates: boolean;
}

type SettingsTab = "notifications" | "display" | "account" | "privacy";

const AVATAR_CHOICES = ["🦊", "🐱", "🐼", "🦉", "🐸", "🦄", "🐙", "🌙", "⚡", "🎧", "📚", "🎮", "🌊", "🔥", "💎", "🌵"];

export default function Settings() {
	const {
		anonId,
		toast,
		refreshIdentity,
		setDisplayName: persistDisplayName,
		theme,
		setTheme,
		displayPrefs,
		setDisplayPrefs,
		profile,
		setProfile,
		notifications: _notifications,
		bookmarks,
		recentlyViewed,
	} = useApp();
	const [tab, setTab] = useState<SettingsTab>("notifications");
	const [nameDraft, setNameDraft] = useState(getDisplayName);
	const [avatarDraft, setAvatarDraft] = useState(profile.avatar || "");
	const [bioDraft, setBioDraft] = useState(profile.bio || "");
	const [photoDraft, setPhotoDraft] = useState(profile.photo || "");
	const [dialog, setDialog] = useState<"resetTutorial" | "resetIdentity" | "adoptIdentity" | null>(null);

	// Identity linking: one ID across this student's browser, APK, and EXE.
	// Storage silos are OS-segregated, so linking is explicit and typed.
	const [linkRevealed, setLinkRevealed] = useState(false);
	const [linkInput, setLinkInput] = useState("");
	const [linkError, setLinkError] = useState("");
	const photoRef = useRef<HTMLInputElement | null>(null);

	// Notification preferences (stored in localStorage)
	const [notifPrefs, setNotifPrefs] = useState(() => {
		try {
			const raw = localStorage.getItem("vb:notif-prefs");
			return raw
				? JSON.parse(raw)
				: {
						push: true,
						email: false,
						sound: true,
						mentions: true,
						replies: true,
						updates: false,
					};
		} catch {
			return {
				push: true,
				email: false,
				sound: true,
				mentions: true,
				replies: true,
				updates: false,
			};
		}
	});

	const saveNotifPrefs = (prefs: typeof notifPrefs) => {
		setNotifPrefs(prefs);
		localStorage.setItem("vb:notif-prefs", JSON.stringify(prefs));
		toast("Notification preferences saved", "ok");
	};

	// ── Phone & email alert channels (real: saved to the server so a solved
	//    post can SMS/email you — see api/_notify-prefs.js + _dispatch.js) ──
	const [channelPrefs, setChannelPrefs] = useState<NotifyChannelPrefs>({
		phone: "",
		email: "",
		sms_enabled: false,
		email_enabled: false,
		browser_enabled: true,
		status_updates: true,
	});
	const [channelSaving, setChannelSaving] = useState(false);
	const channelLoaded = useRef(false);
	/** Last email persisted on the server — detects added/changed addresses. */
	const lastSavedEmail = useRef("");

	useEffect(() => {
		if (channelLoaded.current) return;
		channelLoaded.current = true;
		api
			.get<Partial<NotifyChannelPrefs>>(`/api/notify-prefs?user_id=${anonId}`)
			.then((p) =>
				setChannelPrefs({
					phone: p.phone || "",
					email: p.email || "",
					sms_enabled: p.sms_enabled !== false,
					browser_enabled: p.browser_enabled !== false,
					status_updates: p.status_updates !== false,
					email_enabled: p.email_enabled !== false,
				}),
			)
			.then(() =>
				setChannelPrefs((cur) => {
					lastSavedEmail.current = cur.email || "";
					return cur;
				}),
			)
			.catch(() => {
				/* offline / prefs endpoint unavailable — keep defaults */
			});
	}, [anonId]);

	const saveChannelPrefs = async () => {
		setChannelSaving(true);
		try {
			const prevEmail = lastSavedEmail.current;
			const saved = await api.post<NotifyChannelPrefs>(
				"/api/notify-prefs",
				{
					user_id: anonId,
					phone: channelPrefs.phone,
					email: channelPrefs.email,
					sms_enabled: channelPrefs.sms_enabled,
					browser_enabled: channelPrefs.browser_enabled,
					status_updates: channelPrefs.status_updates !== false,
					email_enabled: channelPrefs.email_enabled,
				},
			);
			setChannelPrefs({
				phone: saved.phone || "",
				email: saved.email || "",
				sms_enabled: saved.sms_enabled !== false,
				browser_enabled: saved.browser_enabled !== false,
				status_updates: saved.status_updates !== false,
				email_enabled: saved.email_enabled !== false,
			});
			try {
				localStorage.setItem(
					"vb:browser-notify",
					JSON.stringify({ enabled: saved.browser_enabled !== false }),
				);
			} catch {
				/* local mirror is best-effort */
			}
			lastSavedEmail.current = saved.email || "";
			toast(
				saved.phone || saved.email
					? "Alert channels saved — you'll get SMS/email on updates"
					: "Alert channels cleared",
				"ok",
			);
			// Free welcome email the moment an email is added (or changed) with
			// alerts on — proves delivery works and confirms the address.
			// Best-effort: a failed send never blocks the saved prefs.
			if (
				saved.email &&
				saved.email_enabled !== false &&
				saved.email.trim().toLowerCase() !== prevEmail.trim().toLowerCase()
			) {
				sendNotificationEmail({
					to_email: saved.email.trim(),
					notification_title: "Email alerts are on",
					notification_body:
						"You'll now get an email when a post you follow is solved or updated by the team. You can switch this off anytime in Settings → Notifications.",
					notification_url: "https://voicebox.app/activity",
				})
					.then((r) => {
						if (r.success) toast("Welcome email sent — check your inbox", "ok");
					})
					.catch(() => {
						/* welcome send is best-effort — prefs are already saved */
					});
			}
		} catch (e: unknown) {
			const msg =
				e instanceof Error ? e.message : "Could not save alert channels";
			toast(msg, "err");
		} finally {
			setChannelSaving(false);
		}
	};

	const SCALE_OPTIONS = [85, 90, 95, 100, 105, 110];

	const handleResetTutorial = () => {
		resetTutorial();
		toast("Tutorial will show again on next visit", "ok");
		setDialog(null);
	};

	const saveProfile = () => {
		const clean = setProfile({ avatar: avatarDraft, bio: bioDraft, photo: photoDraft });
		setAvatarDraft(clean.avatar || "");
		setBioDraft(clean.bio || "");
		setPhotoDraft(clean.photo || "");
		toast(clean.avatar || clean.bio || clean.photo ? "Profile updated" : "Profile cleared", "ok");
	};

	const pickPhoto = (f: File) => {
		if (f.size > 2 * 1024 * 1024) {
			toast("Photo must be under 2 MB", "err");
			return;
		}
		if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) {
			toast("Only PNG, JPG, GIF or WebP images", "err");
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			if (result.length > 450000) {
				toast("Photo is too large — try a smaller image", "err");
				return;
			}
			setPhotoDraft(result);
		};
		reader.readAsDataURL(f);
	};

	const tabs: { key: SettingsTab; label: string; icon: typeof Bell }[] = [
		{ key: "notifications", label: "Notifications", icon: Bell },
		{ key: "display", label: "Display & Feel", icon: Eye },
		{ key: "account", label: "Account", icon: Shield },
		{ key: "privacy", label: "Privacy", icon: Shield },
	];

	return (
		<div className="max-w-3xl mx-auto px-4 py-8 vb-page-enter">
			{/* Header */}
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
					<SettingsIcon size={20} className="text-accent" />
				</div>
				<div>
					<h1 className="font-display font-bold text-xl">Settings</h1>
					<p className="text-sm text-ink3">
						Manage your preferences and account
					</p>
				</div>
			</div>

			<div className="flex flex-col sm:flex-row gap-6">
				{/* Tab sidebar */}
				<nav className="sm:w-48 flex-shrink-0 flex sm:flex-col gap-1 overflow-x-auto pb-1 sm:pb-0">
					{tabs.map(({ key, label, icon: Icon }) => (
						<button
							key={key}
							onClick={() => setTab(key)}
							className={`whitespace-nowrap flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all ${
								tab === key
									? "bg-accent/10 text-accent font-medium"
									: "text-ink3 hover:text-ink hover:bg-surface2"
							}`}
						>
							<Icon size={15} />
							{label}
						</button>
					))}
				</nav>

				{/* Content */}
				<div className="flex-1 min-w-0">
					{/* ── Notifications Tab ─────────────────────────── */}
					{tab === "notifications" && (
						<div className="space-y-6">
							<Section
								title="Notification Preferences"
								desc="Control how and when you receive notifications"
							/>
							<ToggleRow
								label="Push notifications"
								desc="Receive browser push notifications for new activity"
								checked={notifPrefs.push}
								onChange={(v) => saveNotifPrefs({ ...notifPrefs, push: v })}
							/>
							<ToggleRow
								label="Sound alerts"
								desc="Play a sound when notifications arrive"
								checked={notifPrefs.sound}
								onChange={(v) => saveNotifPrefs({ ...notifPrefs, sound: v })}
							/>
							<ToggleRow
								label="Mentions"
								desc="Get notified when someone mentions you"
								checked={notifPrefs.mentions}
								onChange={(v) => saveNotifPrefs({ ...notifPrefs, mentions: v })}
							/>
							<ToggleRow
								label="Replies"
								desc="Get notified when someone replies to your posts"
								checked={notifPrefs.replies}
								onChange={(v) => saveNotifPrefs({ ...notifPrefs, replies: v })}
							/>
							<ToggleRow
								label="System updates"
								desc="Receive notifications about platform updates and changes"
								checked={notifPrefs.updates}
								onChange={(v) => saveNotifPrefs({ ...notifPrefs, updates: v })}
							/>
							<div className="pt-4 border-t border-border/50">
								<p className="text-sm font-medium text-ink mb-0.5">
									Phone & email alerts
								</p>
								<p className="text-xs text-ink3 mb-3">
									{NOTIFY_PRIVACY_COPY}
								</p>
								<div className="space-y-3">
									<label className="block">
										<span className="text-xs text-ink3">Phone number</span>
										<input
											type="tel"
											value={channelPrefs.phone}
											onChange={(e) =>
												setChannelPrefs({ ...channelPrefs, phone: e.target.value })
											}
											placeholder="+1 555 123 4567"
											maxLength={20}
											className="input !py-2 !text-sm w-full"
										/>
									</label>
									<label className="block">
										<span className="text-xs text-ink3">Email address</span>
										<input
											type="email"
											value={channelPrefs.email}
											onChange={(e) =>
												setChannelPrefs({ ...channelPrefs, email: e.target.value })
											}
											placeholder="you@example.com"
											maxLength={120}
											className="input !py-2 !text-sm w-full"
										/>
									</label>
									<ToggleRow
										label="SMS alerts"
										desc="Text me when a followed post is solved or updated"
										checked={channelPrefs.sms_enabled}
										onChange={(v) =>
											setChannelPrefs({ ...channelPrefs, sms_enabled: v })
										}
									/>
									<ToggleRow
										label="Email alerts"
										desc="Email me when a followed post is solved or updated"
										checked={channelPrefs.email_enabled}
										onChange={(v) =>
											setChannelPrefs({ ...channelPrefs, email_enabled: v })
										}
									/>
									<ToggleRow
										label="Browser notifications"
										desc="On-device alerts on this phone or PC \u2014 no phone number needed"
										checked={channelPrefs.browser_enabled}
										onChange={(v) =>
											setChannelPrefs({ ...channelPrefs, browser_enabled: v })
										}
									/>
									{channelPrefs.browser_enabled && <BrowserNotifyPrimer toast={toast} />}
									<ToggleRow
										label="Status-change notifications"
										desc="In-app alerts when a followed post moves to verified, in progress, solved — or gets an admin reply"
										checked={channelPrefs.status_updates !== false}
										onChange={(v) =>
											setChannelPrefs({ ...channelPrefs, status_updates: v })
										}
									/>
									<button
										className="btn btn-primary !py-2 !px-4 !text-xs"
										onClick={saveChannelPrefs}
										disabled={channelSaving}
									>
										{channelSaving ? "Saving…" : "Save alert channels"}
									</button>
								</div>
							</div>
						</div>
					)}

					{/* ── Display Tab ───────────────────────────────── */}
					{tab === "display" && (
						<div className="space-y-6">
							<Section
								title="Display & Feel"
								desc="Customize how Voice Flow looks and feels — every option applies instantly"
							/>

							{/* Theme selector — real, applies immediately */}
							<div className="space-y-2">
								<label className="text-sm font-medium text-ink">Theme</label>
								<p className="text-xs text-ink3">
									System follows your device preference automatically
								</p>
								<div className="flex gap-2 mt-2 flex-wrap">
									{(
										[
											{ value: "system", label: "System", icon: Monitor },
											{ value: "dark", label: "Dark", icon: Moon },
											{ value: "light", label: "Light", icon: Sun },
										] as const
									).map(({ value, label, icon: Icon }) => (
										<button
											key={value}
											onClick={() => {
												setTheme(value);
												toast(
													value === "system"
														? "Theme follows your device"
														: `Theme set to ${label}`,
													"ok",
												);
											}}
											className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
												theme === value
													? "border-accent bg-accent/10 text-accent"
													: "border-border hover:border-accent/30 text-ink3"
											}`}
										>
											<Icon size={14} />
											{label}
										</button>
									))}
								</div>
							</div>

							<ToggleRow
								label="Glass morphism"
								desc="Frosted-glass surfaces with blur on cards, panels, and the nav"
								checked={displayPrefs.glassEnabled}
								onChange={(v) =>
									setDisplayPrefs({ ...displayPrefs, glassEnabled: v })
								}
							/>
							<ToggleRow
								label="Animations"
								desc="Enable smooth transitions and motion effects"
								checked={displayPrefs.animationsEnabled}
								onChange={(v) =>
									setDisplayPrefs({ ...displayPrefs, animationsEnabled: v })
								}
							/>
							<ToggleRow
								label="Compact mode"
								desc="Reduce spacing and padding for a denser layout"
								checked={displayPrefs.compactMode}
								onChange={(v) =>
									setDisplayPrefs({ ...displayPrefs, compactMode: v })
								}
							/>
							<ToggleRow
								label="Show avatars"
								desc="Display avatars next to posts, comments, and community activity"
								checked={displayPrefs.showAvatars}
								onChange={(v) =>
									setDisplayPrefs({ ...displayPrefs, showAvatars: v })
								}
							/>

							{/* UI scale — the whole interface, proportionally */}
							<div className="pt-4 border-t border-border/50">
								<label className="text-sm font-medium text-ink">
									UI scale
								</label>
								<p className="text-xs text-ink3 mt-0.5 mb-2">
									Make everything smaller or larger on this device.
								</p>
								<div className="flex gap-2 flex-wrap">
									{SCALE_OPTIONS.map((s) => (
										<button
											key={s}
											onClick={() =>
												setDisplayPrefs({ ...displayPrefs, uiScale: s })
											}
											aria-pressed={displayPrefs.uiScale === s}
											className={`px-3.5 py-2 rounded-xl border text-sm transition-all ${
												displayPrefs.uiScale === s
													? "border-accent bg-accent/10 text-accent font-medium"
													: "border-border text-ink3 hover:text-ink"
											}`}
										>
											{s}%
										</button>
									))}
								</div>
								<p className="text-[11px] text-ink3 mt-1.5">
									{displayPrefs.uiScale < 100
										? `Compact: ${100 - displayPrefs.uiScale}% smaller than default`
										: displayPrefs.uiScale > 100
											? `${displayPrefs.uiScale - 100}% larger than default`
											: "Default size"}
								</p>
							</div>
						</div>
					)}

					{/* ── Account Tab ───────────────────────────────── */}
					{tab === "account" && (
						<div className="space-y-6">
							<Section
								title="Account Settings"
								desc="Manage your anonymous identity and profile"
							/>

							{/* Identity info */}
							<div className="p-4 rounded-xl border border-border bg-surface2/50">
								<div className="flex items-center gap-2 mb-2">
									<Shield size={14} className="text-accent" />
									<span className="text-sm font-medium text-ink">
										Anonymous Identity
									</span>
								</div>
								<p className="text-xs text-ink3 mb-2">
									Your anonymous ID:{" "}
									<code className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded">
										{anonId}
									</code>
								</p>
								<p className="text-xs text-ink3">
									This ID is stored locally in your browser and is used to
									identify your posts, comments, and votes. No personal
									information is collected.
								</p>
							</div>

							{/* Identity linking — one ID on every device. Showing the code is
explicit (anyone holding it owns this identity); adopting swaps
this device to the other identity after confirmation. */}
<div className="p-4 rounded-xl border border-border bg-surface2/50">
							<div className="flex items-center gap-2 mb-2">
								<Shield size={14} className="text-accent" />
								<span className="text-sm font-medium text-ink">
									Use the same ID on another device
								</span>
							</div>
							<p className="text-xs text-ink3 mb-2">
								Your browser, the Android app, and the Windows app each keep a separate ID. To unite them, show the code here and type it on the other device.
							</p>
							{!linkRevealed ? (
								<button type="button" className="btn btn-ghost !py-2 !px-4 !text-xs" onClick={() => setLinkRevealed(true)}>
									Show my link code
								</button>
							) : (
								<div className="rounded-lg bg-bg border border-warn/30 px-3 py-2.5">
									<p className="font-mono text-sm font-bold tracking-wider text-ink break-all" aria-label="Your identity link code">
										{createLinkCode(anonId) ?? "Unavailable"}
									</p>
									<p className="text-[11px] text-warn mt-1">Anyone with this code owns your posts and votes. Share it only with yourself.</p>
								</div>
							)}
							<div className="flex gap-2 mt-2">
								<input value={linkInput} onChange={(e) => { setLinkInput(e.target.value); setLinkError(""); }} placeholder="Type a link code, e.g. VF-AB12-CD34-EF" maxLength={40} className="input !py-2 !text-sm flex-1 font-mono" aria-label="Identity link code" />
								<button type="button" className="btn btn-soft !py-2 !px-4 !text-xs" onClick={() => { const parsed = parseLinkCode(linkInput); if (!parsed) { setLinkError("That code doesn't look right — check each character and try again."); return; } if (parsed === anonId) { setLinkError("That's already this device's ID."); return; } setLinkError(""); setDialog("adoptIdentity"); }}>
									Link this device
								</button>
							</div>
							{linkError && <p className="text-[11px] text-bad mt-1.5" role="alert">{linkError}</p>}
</div>

{/* Session recovery: an expired or cleared session cannot
								be restored server-side (doing so would let anyone
								claim any ID), so the way back is a fresh ID. Old
								posts stay published; this device simply stops
								owning them. */}
							<ActionRow
								icon={RotateCcw}
								label="Start fresh with a new ID"
								desc="If this device was ever signed out by an expired session, get a working identity again"
								action="Start fresh"
								onClick={() => setDialog("resetIdentity")}
								variant="warning"
							/>

							{/* Display name — keep the anonymous ID, but sound like you */}
							<div className="p-4 rounded-xl border border-border bg-surface2/50">
								<div className="flex items-center gap-2 mb-2">
									<PenLine size={14} className="text-accent" />
									<span className="text-sm font-medium text-ink">
										Display name
									</span>
								</div>
								<p className="text-xs text-ink3 mb-2">
									Give yourself a friendly name shown on this device. Leave
									it empty to keep your anonymous ID everywhere.
								</p>
								<div className="flex gap-2">
									<input
										type="text"
										value={nameDraft}
										onChange={(e) => setNameDraft(e.target.value)}
										placeholder="e.g. Curious Cat"
										maxLength={24}
										className="input !py-2 !text-sm flex-1"
										aria-label="Display name"
									/>
									<button
										className="btn btn-primary !py-2 !px-4 !text-xs"
										onClick={() => {
											persistDisplayName(nameDraft);
											setNameDraft(getDisplayName());
											toast(
												nameDraft.trim()
													? "Display name saved"
													: "Using your anonymous ID",
												"ok",
											);
										}}
									>
										Save
									</button>
								</div>
							</div>

							{/* Avatar + bio — your local profile */}
							<div className="p-4 rounded-xl border border-border bg-surface2/50">
								<div className="flex items-center gap-2 mb-2">
									<ImageIcon size={14} className="text-accent" />
									<span className="text-sm font-medium text-ink">
										Avatar & bio
									</span>
								</div>
							<p className="text-xs text-ink3 mb-3">
								Pick an avatar, upload a profile photo, and add a short bio.
								All of it stays on this device only — photos are stored as
								local images and never leave your browser.
							</p>
							<div className="flex items-center gap-4 mb-3">
								{photoDraft ? (
									<img
										src={photoDraft}
										alt="Your profile photo"
										className="w-16 h-16 rounded-2xl object-cover flex-shrink-0 vb-avatar"
									/>
								) : (
									<div className="w-16 h-16 rounded-2xl bg-surface3 flex items-center justify-center text-3xl vb-avatar">
										{avatarDraft || "🙂"}
									</div>
								)}
								<div className="flex flex-col gap-1.5">
									<input
										ref={photoRef}
										type="file"
										accept="image/png,image/jpeg,image/gif,image/webp"
										className="hidden"
										onChange={(e) => {
											const f = e.target.files?.[0];
											if (f) pickPhoto(f);
										}}
										aria-label="Upload profile photo"
									/>
									<button
										className="btn btn-ghost !text-xs !py-1.5 !px-3"
										onClick={() => photoRef.current?.click()}
									>
										<Camera size={13} /> {photoDraft ? "Change photo" : "Upload photo"}
									</button>
									{photoDraft && (
										<button
											className="btn btn-ghost !text-xs !py-1 !px-3 !text-bad"
											onClick={() => setPhotoDraft("")}
										>
											Remove photo
										</button>
									)}
								</div>
							</div>
							<div className="flex flex-wrap gap-1.5 mb-3">
								{AVATAR_CHOICES.map((e) => (
									<button
										key={e}
										onClick={() => {
											setAvatarDraft(e);
											setPhotoDraft("");
										}}
										aria-label={`Avatar ${e}`}
										className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-all ${
											avatarDraft === e
												? "bg-accent/20 ring-1 ring-accent"
												: "bg-surface3 hover:bg-surface2"
										}`}
									>
										{e}
									</button>
								))}
							</div>
								<textarea
									className="input !py-2 !text-sm w-full min-h-16 resize-none"
									placeholder="A short line about you (optional, max 160 chars)"
									value={bioDraft}
									onChange={(e) => setBioDraft(e.target.value)}
									maxLength={160}
									aria-label="Bio"
								/>
								<div className="flex justify-end mt-2">
									<button
										className="btn btn-primary !py-2 !px-4 !text-xs"
										onClick={saveProfile}
									>
										<Sparkles size={13} /> Save profile
									</button>
								</div>
							</div>

							{/* Action rows */}
							<ActionRow
								icon={RotateCcw}
								label="Show tutorial again"
								desc="Re-enable the onboarding tutorial for next visit"
								action="Reset"
								onClick={() => setDialog("resetTutorial")}
								variant="default"
							/>
							<ActionRow
								icon={Download}
								label="Export on-device settings"
								desc="Download the settings and activity stored in this browser as JSON"
								action="Export"
								onClick={() => {
									const data = {
										anonymous_id: anonId,
										exported_at: new Date().toISOString(),
										bookmarks,
										recently_viewed: recentlyViewed,
										notification_prefs: notifPrefs,
										display_prefs: displayPrefs,
										profile,
									};
									const blob = new Blob([JSON.stringify(data, null, 2)], {
										type: "application/json",
									});
									const url = URL.createObjectURL(blob);
									const a = document.createElement("a");
									a.href = url;
									a.download = `voicebox-data-${anonId.slice(0, 8)}.json`;
									a.click();
									URL.revokeObjectURL(url);
									toast("Data exported", "ok");
								}}
								variant="default"
							/>
						</div>
					)}

					{/* ── Privacy Tab ───────────────────────────────── */}
					{tab === "privacy" && (
						<div className="space-y-6">
							<Section
								title="Privacy Settings"
								desc="Control your privacy and data sharing"
							/>

							<div className="p-4 rounded-xl border border-border bg-surface2/50 space-y-3">
								<h3 className="text-sm font-medium text-ink">
									Anonymous by Design
								</h3>
								<p className="text-xs text-ink3 leading-relaxed">
									Voice Flow is built for anonymous participation. Here's what we
									collect and don't collect:
								</p>
								<ul className="text-xs text-ink3 space-y-2">
									<li className="flex items-start gap-2">
										<Check
											size={12}
											className="text-good mt-0.5 flex-shrink-0"
										/>
										<span>
											<strong className="text-ink">Public content:</strong> Posts,
											comments, votes, and reactions are linked to an anonymous ID.
										</span>
									</li>
									<li className="flex items-start gap-2">
										<Check
											size={12}
											className="text-good mt-0.5 flex-shrink-0"
										/>
										<span>{NOTIFY_PRIVACY_COPY}</span>
									</li>
									<li className="flex items-start gap-2">
										<Check
											size={12}
											className="text-good mt-0.5 flex-shrink-0"
										/>
										<span>{LOCAL_PROFILE_COPY}</span>
									</li>
									<li className="flex items-start gap-2">
										<Check
											size={12}
											className="text-good mt-0.5 flex-shrink-0"
										/>
										<span>{INFRASTRUCTURE_COPY}</span>
									</li>
								</ul>
							</div>

							<div className="p-4 rounded-xl border border-border bg-surface2/50">
								<h3 className="text-sm font-medium text-ink mb-2">
									Data Retention
								</h3>
								<p className="text-xs text-ink3 leading-relaxed">
									{RETENTION_COPY}
								</p>
							</div>

							<div className="p-4 rounded-xl border border-border bg-surface2/50">
								<h3 className="text-sm font-medium text-ink mb-2">
									Open Source
								</h3>
								<p className="text-xs text-ink3 leading-relaxed">
									Voice Flow is open source. Review the code and current deployment
									settings together, including the server-side contact and moderation
									paths described above.
								</p>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Confirm dialogs */}
			{dialog === "resetTutorial" && (
				<ConfirmDialog
					open
					title="Reset Tutorial?"
					message="The onboarding tutorial will show again on your next page visit."
					confirmLabel="Reset"
					onConfirm={handleResetTutorial}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog === "adoptIdentity" && (
	<ConfirmDialog
		open
		title="Link this device to another ID?"
		message="This device will adopt the linked identity — its posts, votes, and ownership move here. This device's current ID is abandoned (its published content stays up, but unmanaged). This cannot be undone from here."
		confirmLabel="Link devices"
		onConfirm={() => {
			const adopted = adoptIdentity(linkInput);
			if (!adopted) {
				setLinkError("That code doesn't look right — check each character and try again.");
				setDialog(null);
				return;
			}
			setLinkInput("");
			setLinkRevealed(false);
			setDialog(null);
			refreshIdentity();
			toast("Devices linked — one ID everywhere now", "ok");
		}}
		onClose={() => setDialog(null)}
	/>
)}
{dialog === "resetIdentity" && (
				<ConfirmDialog
					open
					title="Start fresh with a new ID?"
					message="This device gets a brand-new anonymous identity. Your previously published posts stay up, but this device will no longer own or manage them."
					confirmLabel="Start fresh"
					onConfirm={() => {
						resetAnonId();
						refreshIdentity();
						setDialog(null);
						toast("Fresh anonymous ID ready", "ok");
					}}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}

/* ─── Helper components ──────────────────────────────────────────── */
function Section({ title, desc }: { title: string; desc: string }) {
	return (
		<div className="pb-4 border-b border-border">
			<h2 className="font-display font-bold text-base text-ink">{title}</h2>
			<p className="text-xs text-ink3 mt-0.5">{desc}</p>
		</div>
	);
}

function ToggleRow({
	label,
	desc,
	checked,
	onChange,
}: {
	label: string;
	desc: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between py-3 border-b border-border/50">
			<div className="flex-1 min-w-0 pr-4">
				<p className="text-sm font-medium text-ink">{label}</p>
				<p className="text-xs text-ink3 mt-0.5">{desc}</p>
			</div>
			<button
				onClick={() => onChange(!checked)}
				aria-pressed={checked}
				aria-label={label}
				className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
					checked ? "bg-accent" : "bg-surface2 border border-border"
				}`}
			>
				<span
					className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
						checked ? "translate-x-5" : ""
					}`}
				/>
			</button>
		</div>
	);
}

function ActionRow({
	icon: Icon,
	label,
	desc,
	action,
	onClick,
	variant,
}: {
	icon: typeof RotateCcw;
	label: string;
	desc: string;
	action: string;
	onClick: () => void;
	variant: "default" | "warning" | "danger";
}) {
	const colors = {
		default: "text-accent hover:bg-accent/5",
		warning: "text-amber-400 hover:bg-amber-400/5",
		danger: "text-red-400 hover:bg-red-400/5",
	};
	return (
		<div className="flex items-center justify-between py-3 border-b border-border/50">
			<div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
				<Icon size={16} className="text-ink3 flex-shrink-0" />
				<div>
					<p className="text-sm font-medium text-ink">{label}</p>
					<p className="text-xs text-ink3 mt-0.5">{desc}</p>
				</div>
			</div>
			<button
				onClick={onClick}
				className={`btn !text-xs !px-3 !py-1.5 flex-shrink-0 transition-all ${colors[variant]}`}
			>
				{action}
			</button>
		</div>
	);
}

/**
 * Permission-first primer for on-device browser notifications. Explains
 * what the user gets (and how to undo) BEFORE the browser prompt appears —
 * the prompt itself offers no context and can only be asked once with full
 * effect. Includes a test ping so delivery is proven, not assumed.
 */
function BrowserNotifyPrimer({ toast }: { toast: (msg: string, kind: "ok" | "err" | "info") => void }) {
	const [busy, setBusy] = useState(false);
	const [state, setState] = useState(() => browserNotifyPermission());
	if (state === "unsupported") {
		return (
			<p className="text-[11px] text-ink3 mt-1.5">
				This browser can’t show device notifications — in-app alerts, SMS and email still work.
			</p>
		);
	}
	if (state === "denied") {
		return (
			<p className="text-[11px] text-ink3 mt-1.5">
				Notifications are blocked for this site. Re-enable them in your browser’s site settings to get device alerts.
			</p>
		);
	}
	if (state === "granted") {
		return (
			<button
				type="button"
				disabled={busy}
				onClick={() => {
					const shown = showBrowserNotification({
						title: "Voice Flow notifications work",
						body: "You’ll get one like this when something you follow changes.",
						tag: "voice-flow-test",
					});
					toast(shown ? "Test notification sent" : "Could not show a notification", shown ? "ok" : "err");
				}}
				className="btn btn-ghost !text-xs !py-1.5 mt-1.5"
			>
				Send a test notification
			</button>
		);
	}
	return (
		<div className="rounded-xl border border-border p-3 mt-1.5">
			<p className="text-[11px] text-ink2 leading-relaxed">
				Allow notification access and this device will ping you the moment a followed post is solved, updated, or replied to — even when Voice Flow isn’t open in front of you. Turn it off anytime here or in your browser settings.
			</p>
			<button
				type="button"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					const next = await requestBrowserNotifyPermission();
					setState(next);
					setBusy(false);
					if (next === "granted") {
						showBrowserNotification({
							title: "Voice Flow notifications on",
							body: "You’ll get one like this when something you follow changes.",
							tag: "voice-flow-test",
						});
					} else if (next === "denied") {
						toast("Notifications blocked — re-enable them in site settings anytime", "info");
					}
				}}
				className="btn btn-primary !text-xs !py-1.5 mt-2"
			>
				{busy ? "Waiting for browser…" : "Enable device notifications"}
			</button>
		</div>
	);
}
