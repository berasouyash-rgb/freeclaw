import {
	AlertTriangle,
	BarChart3,
	CheckCircle2,
	Copy,
	Eye,
	ImagePlus,
	Lightbulb,
	Loader2,
	Lock,
	Megaphone,
	Pencil,
	Save,
	Send,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { fireConfetti } from "../components/Confetti";
import RelevanceNote from "../components/RelevanceNote";
import AppealPanel, { type AppealSurface } from "../components/AppealPanel";
import { useApp } from "../contexts/AppContext";
import { useCategories } from "../hooks/useCategories";
import { api } from "../lib/api";
import { downscaleImage } from "../lib/image";
import { checkCooldown, lsGet, lsSet, stampCooldown } from "../lib/identity";
import {
	isBlockedByServer,
	type ModerationResult,
	moderateContent,
	normalizePrePubResult,
	type PrePubCheckKey,
	PREPUB_CHECK_KEYS,
	type PrePubResult,
	submitBlockMessage,
} from "../lib/moderation";

import { CAT_EMOJI, sanitize } from "../lib/utils";
import type { PostData, PostType } from "../types";

const DRAFT_KEY = "vb:drafts";


interface Draft {
	title?: string;
	desc?: string;
	category?: string;
	priority?: string;
	tags?: string;
	type?: PostType;
	savedAt?: string;
}
interface AiSuggest {
	category: string;
	confidence?: number;
	priority?: string;
	tags?: string[];
	improved_title?: string;
}
interface PollSuggest {
	engine?: string;
	improved_title?: string | null;
	suggested_options?: string[];
	ptype?: string | null;
	note?: string | null;
}
/**
 * The pre-publish verdict type and its normalizer live together in
 * ../lib/moderation. This page only ever renders a NORMALIZED verdict, so the
 * shape it reads and the shape the boundary guarantees cannot drift apart.
 */

export default function Submit() {
	const { anonId, toast, pushNotif, accountStatus } = useApp();
	const restricted = !!(accountStatus?.banned || accountStatus?.suspended);
	const nav = useNavigate();
	const [params] = useSearchParams();
	const initialType: PostType =
		params.get("type") === "suggestion"
			? "suggestion"
			: params.get("type") === "poll"
				? "poll"
				: "problem";

	const [type, setType] = useState<PostType>(initialType);
	const [title, setTitle] = useState("");
	const [desc, setDesc] = useState("");
	const [category, setCategory] = useState("Academics");
	const categories = useCategories();
	const [tags, setTags] = useState("");
	/** Private post → visible only to admins/moderators (and you) */
	const [isPrivate, setIsPrivate] = useState(false);
	const [image, setImage] = useState<{
		preview: string;
		base64: string;
		type: string;
	} | null>(null);
	const [preview, setPreview] = useState(false);
	const [busy, setBusy] = useState(false);
	const [draftSaved, setDraftSaved] = useState(false);
	// Recourse: when safety blocks the write (client pre-gate or server 403),
	// offer a human appeal carrying the exact blocked text.
	const [blockedAppeal, setBlockedAppeal] = useState<{
		surface: AppealSurface;
		title: string;
		body: string;
		context?: { ptype?: string; options?: string[]; category?: string };
	} | null>(null);
	// Inline validation errors
	const [titleError, setTitleError] = useState("");
	const [descError, setDescError] = useState("");
	// poll fields
	const [pollType, setPollType] = useState<"yesno" | "single" | "multi">(
		"yesno",
	);
	const [options, setOptions] = useState<string[]>(["", ""]);
	const [expiry, setExpiry] = useState("");
	const [linkPost, setLinkPost] = useState("");
	const [linkablePosts, setLinkablePosts] = useState<PostData[]>([]);
	const [attachPoll, setAttachPoll] = useState(false);
	const [attachQuestion, setAttachQuestion] = useState("");
	const [attachOptions, setAttachOptions] = useState<string[]>(["", ""]);

	// Load the author's open problems AND suggestions for the poll link selector
	useEffect(() => {
		if (type !== "poll") return;
		Promise.all([
			api.get<PostData[]>(`/api/posts?type=problem&viewer=${encodeURIComponent(anonId)}`).catch((): PostData[] => []),
			api.get<PostData[]>(`/api/posts?type=suggestion&viewer=${encodeURIComponent(anonId)}`).catch((): PostData[] => []),
		])				.then(([problems, suggestions]) =>
					setLinkablePosts(
						[...problems, ...suggestions]
							.filter((p) =>
								!["solved", "archived"].includes(p.status) &&
								p.author_id === anonId,
						)
							.filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
							.slice(0, 50),
					),
				)
			.catch((e: unknown) => {
				console.warn(
					"[Submit] Failed to load linkable posts:",
					e instanceof Error ? e.message : e,
				);
			});
	}, [type, anonId]);
	const fileRef = useRef<HTMLInputElement>(null);
	const restoredRef = useRef(false);
	/** Synchronous double-submit guard (ref, not state): two fast clicks run
	 *  before React re-renders `busy`, so state alone can't stop a second
	 *  concurrent publish — which creates twin posts + twin notifications. */
	const submitBusyRef = useRef(false);
	const [duplicates, setDuplicates] = useState<PostData[]>([]);
	const allPostsRef = useRef<PostData[] | null>(null);
	/** Real-time AI suggestions (category + tags + priority + improved title) */
	const [aiSuggest, setAiSuggest] = useState<AiSuggest | null>(null);
	const suggestSeq = useRef(0);

	/** Smart poll AI suggestions — improved question + options while the user types */
	const [pollSuggest, setPollSuggest] = useState<PollSuggest | null>(null);
	const pollSuggestSeq = useRef(0);
	const pollSuggestBusy = useRef(false);

	/**
	 * Content moderation state — live checks as user types.
	 *
	 * The verdict is stored WITH the text it was computed for. A verdict is a
	 * claim about one exact string, so applying it to whatever is on screen
	 * invents facts: deleting a flagged word used to keep "Fix issues first"
	 * and the appeal panel alive (for a debounce + a round-trip) over text that
	 * was already clean, and typing on after a clean verdict kept "No issues
	 * found by the safety check" over text no check had ever seen.
	 * `moderation` — derived below, next to `liveText` — is null unless the
	 * verdict describes the current text. Unknown, never a stale claim.
	 */
	const [modVerdict, setModVerdict] = useState<{
		text: string;
		result: ModerationResult;
	} | null>(null);
	/**
	 * True while a check is in flight. The UI must NOT render
	 * "Content looks good — no issues detected" while this is true: the old
	 * code ran a client-side word list, which had no notion of "Dhansiri,
	 * I will hate you" and so congratulated a student on publishing a
	 * targeted threat. Silence pending a verdict is honest; a false green
	 * checkmark is not.
	 */
	const [modChecking, setModChecking] = useState(false);
	const modSeq = useRef(0);

	/** Pre-publish AI review result */
	const [prePubResult, setPrePubResult] = useState<PrePubResult | null>(null);
	const [prePubBusy, setPrePubBusy] = useState(false);

	// Smart poll AI suggestions — fires only on the poll tab, debounced while typing
	useEffect(() => {
		if (type !== "poll") {
			setPollSuggest(null);
			return;
		}
		if (title.trim().length < 5) {
			setPollSuggest(null);
			return;
		}
		const seq = ++pollSuggestSeq.current;
		if (pollSuggestBusy.current) return;
		const t = setTimeout(async () => {
			pollSuggestBusy.current = true;
			try {
				const r = await api.post<PollSuggest>("/api/assist", {
					task: "suggest_poll",
					text: title,
				});
				if (
					seq === pollSuggestSeq.current &&
					(r.improved_title || (r.suggested_options || []).length > 0)
				)
					setPollSuggest(r);
			} catch {
				/* non-blocking */
			} finally {
				pollSuggestBusy.current = false;
			}
		}, 700);
		return () => {
			clearTimeout(t);
			pollSuggestBusy.current = false;
		};
	}, [title, type]);

	useEffect(() => {
		if (type === "poll") {
			setAiSuggest(null);
			return;
		}
		const text = `${title}. ${desc}`.trim();
		if (text.length < 10) {
			setAiSuggest(null);
			return;
		}
		const seq = ++suggestSeq.current;
		const t = setTimeout(async () => {
			try {
				const r = await api.post<AiSuggest>("/api/assist", {
					task: "suggest",
					text,
				});
				if (seq === suggestSeq.current && r.category) setAiSuggest(r);
			} catch {
				/* non-blocking */
			}
		}, 600);
		return () => clearTimeout(t);
	}, [title, desc, type]);

	// Live validation — show errors as user types (after first blur or submit attempt)
	const [touched, setTouched] = useState({ title: false, desc: false });

	useEffect(() => {
		if (touched.title) {
			if (title.trim().length === 0) setTitleError("Title is required");
			else if (title.trim().length < 5)
				setTitleError("Title must be at least 5 characters");
			else setTitleError("");
		}
	}, [title, touched.title]);

	useEffect(() => {
		if (touched.desc) {
			if (type !== "poll") {
				if (desc.trim().length === 0) setDescError("Description is required");
				else if (desc.trim().length < 10)
					setDescError("Description must be at least 10 characters");
				else setDescError("");
			}
		}
	}, [desc, touched.desc, type]);

	// Every text field the author can type into. The live check used to send
	// only `title + desc`, so PII typed into a poll option (or an attached
	// poll's question/options) never reached the endpoint and the user got
	// zero real-time feedback — the privacy flag simply never appeared until
	// submit. One memo feeds both the live check and the pre-send gate so
	// they can never disagree about what was checked.
	const liveText = useMemo(() => {
		const parts = [title, desc];
		if (type === "poll") parts.push(...options);
		if (attachPoll) parts.push(attachQuestion, ...attachOptions);
		return parts
			.map((p) => String(p || "").trim())
			.filter(Boolean)
			.join("\n");
	}, [title, desc, type, options, attachPoll, attachQuestion, attachOptions]);

	/**
	 * The live verdict — present ONLY while it describes the text on screen.
	 * Anything else is "not checked yet", which every consumer below already
	 * knows how to render: silence, with the local scan standing in as the
	 * pre-send backstop. See the state comment above for the bugs this closes.
	 */
	const moderation =
		modVerdict && modVerdict.text === liveText ? modVerdict.result : null;
	/**
	 * Render-safe flag list. `moderation` comes from the network and may be a
	 * partial/mocked shape without `flags` — every direct `moderation.flags`
	 * access below crashed the entire page (empty render, no error UI) the
	 * moment one such response arrived. A missing list means "no flags", never
	 * an exception.
	 */
	const modFlags = moderation?.flags ?? [];

	/**
	 * Advisory relevance verdict for the current text, or null when the check
	 * has not run or has failed. Null must never render as a positive claim.
	 */
	const relevance = moderation?.relevance ?? null;

	/**
	 * A pre-publish verdict describes the exact text it reviewed. Once the
	 * author rewrites that text, the panel's risk score and its reason are
	 * claims about words that no longer exist — drop it rather than keep
	 * asserting them.
	 */
	useEffect(() => {
		setPrePubResult(null);
	}, [liveText]);

	/**
	 * The checks the advisory verdict actually reported, in canonical order,
	 * carrying their display labels. An absent check is omitted — a check that
	 * never ran is not a pass — so the render below never indexes a missing
	 * entry (which used to throw and unmount the page).
	 */
	const prePubCheckRows = useMemo(() => {
		const checks = prePubResult?.checks;
		if (!checks) return [];
		const labels: Record<PrePubCheckKey, string> = {
			privacy: "Personal info",
			safety: "Safety",
			spam: "Spam",
			quality: "Quality",
		};
		return PREPUB_CHECK_KEYS.flatMap((key) => {
			const check = checks[key];
			return check ? [{ key, label: labels[key], check }] : [];
		});
	}, [prePubResult]);

	// Live moderation on all author text.
	//
	// This calls the SERVER (`/api/moderate`), which runs the full pipeline:
	// deterministic keyword gates PLUS the contextual classifier that resolves
	// the target of hostile language. The old client-side `moderateContent()`
	// was a bare word list, which is exactly why "Dhansiri, I will hate you"
	// showed as clean.
	//
	// The server call is deterministic-only (~0-14ms measured, no provider
	// round-trip), so awaiting it costs nothing perceptible.
	useEffect(() => {
		const text = liveText;
		if (text.length < 3) {
			setModVerdict(null);
			setModChecking(false);
			return;
		}
		const seq = ++modSeq.current;
		let cancelled = false;
		const t = setTimeout(() => {
			setModChecking(true);
			api
				.post<ModerationResult & { checked?: boolean; serverBlocked?: boolean }>(
					"/api/moderate",
					// Polls publish through the "direct" surface (no review
					// queue); previewing them as "queued" understated blocking.
					{ text, surface: type === "poll" ? "direct" : "queued" },
				)
				.then((r) => {
					// Ignore a response for text the user has already typed past.
					if (cancelled || seq !== modSeq.current) return;
					// A failed check must never render as a pass.
					if (r?.checked === false) {
						setModVerdict(null);
						return;
					}
					// A response without a flags array is unusable (test mock,
					// proxy, older server). Fall back to the local scan for the
					// exact text that was checked — crashing the page or
					// silently reporting clean are both worse.
					if (!r || !Array.isArray(r.flags)) {
						setModVerdict({ text, result: moderateContent(text) });
						return;
					}
					setModVerdict({ text, result: r });
				})
				.catch(() => {
					if (cancelled || seq !== modSeq.current) return;
					// Deliberately null, not an empty result: the UI shows
					// "could not check" rather than "no issues found".
					setModVerdict(null);
				})
				.finally(() => {
					if (cancelled || seq !== modSeq.current) return;
					setModChecking(false);
				});
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [liveText, type]);

	const [voiceBusy, setVoiceBusy] = useState(false);
	const [voiceDraft, setVoiceDraft] = useState<{
		title: string;
		description: string;
		category: string;
		tags: string[];
		priority: string;
		details: string[];
	} | null>(null);






	/** Send the typed text to the AI: ramble in, formal complaint draft out */
	const runStructure = async (
		task: "structure_complaint",
		tooShortHint: string,
	) => {
		const spoken = desc.trim();
		if (spoken.length < 8) {
			toast(tooShortHint, "err");
			return;
		}
		if (!navigator.onLine) {
			toast("You're offline — the AI needs a connection. Your words are saved above.", "err");
			return;
		}
		setVoiceBusy(true);
		setVoiceDraft(null);
		try {
			const r = await api.postSlow<{
				engine?: string;
				draft: {
					title: string;
					description: string;
					category: string;
					tags: string[];
					priority: string;
					details: string[];
				} | null;
			}>(`/api/assist`, { task, text: spoken });
			if (r.draft) {
				setVoiceDraft(r.draft);
				toast(
					r.engine === "local"
						? "Ready — review and apply"
						: "AI drafted your complaint — review and apply",
					"ok",
				);
			} else {
				// 200 with no draft = the AI service is down or overloaded —
				// say so plainly instead of blaming the user's words.
				toast("AI is busy right now — your words are safe above, tap again in a moment", "err");
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "";
			toast(
				/network|fetch|failed|timeout|connection|offline/i.test(msg)
					? "Connection failed — your words are saved above, try again when online"
					: "AI is busy right now — your words are safe above, tap again in a moment",
				"err",
			);
		}
		setVoiceBusy(false);
	};

	/** Type-mode button: rambling paragraph → the same structured draft */
	const structureText = () =>
		runStructure(
			"structure_complaint",
			"Write a little more first — one full sentence is enough",
		);

	/** The structured-draft card for the typed Transform.
	 *  Details are display-only extracted facts (dates, places) — Apply
	 *  fills title/description/category/tags for final review + publish. */
	const renderDraftCard = () => {
		if (!voiceDraft) return null;
		return (
			<div className="mt-3 rounded-xl bg-surface border border-accent/30 p-3 vb-rise">
				<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5">
					AI draft — error-free and structured
				</p>
				<p className="text-sm font-semibold text-ink">
					{voiceDraft.title}
				</p>
				<p className="text-xs text-ink2 mt-1 leading-relaxed">
					{voiceDraft.description}
				</p>
				{(voiceDraft.details || []).length > 0 && (
					<p className="text-[10px] text-ink3 mt-1.5">
						📎 {(voiceDraft.details || []).join(" · ")}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-1.5 mt-2">
					<span className="chip !text-[10px]">
						{CAT_EMOJI[voiceDraft.category]} {voiceDraft.category}
					</span>
					{voiceDraft.tags.map((t) => (
						<span key={t} className="chip !text-[10px]">
							#{t}
						</span>
					))}
				</div>
				<button
					type="button"
					onClick={applyVoiceDraft}
					className="btn btn-primary w-full mt-2.5 !py-2.5"
				>
					<Send size={14} /> Use this — review & publish
				</button>
			</div>
		);
	};

	const applyVoiceDraft = () => {
		if (!voiceDraft) return;
		setTitle(voiceDraft.title.slice(0, 120));
		setDesc(voiceDraft.description.slice(0, 500));
		setCategory(voiceDraft.category);
		if (voiceDraft.tags.length)
			setTags((prev) =>
				prev ? `${prev}, ${voiceDraft.tags.join(", ")}` : voiceDraft.tags.join(", "),
			);
		setVoiceDraft(null);
		// The form stays up for final review + publish.

		toast("Complaint filled in — review and publish", "ok");
	};

	/** Duplicate detection: word-overlap similarity against open posts in the same category */
	const checkDuplicates = useCallback(
		async (titleText: string, descText: string, category: string) => {
			const words = (t: string) =>
				new Set(
					t
						.toLowerCase()
						.split(/\W+/)
						.filter((w) => w.length > 3),
				);
			const mine = words(titleText + " " + descText);
			if (mine.size < 2) {
				setDuplicates([]);
				return;
			}
			try {
				if (!allPostsRef.current)
					allPostsRef.current = await api.get<PostData[]>("/api/posts");
				const matches = (allPostsRef.current || [])
					.filter(
						(p) =>
							p.category === category &&
							!["solved", "archived"].includes(p.status),
					)
					.map((p) => {
						const theirs = words(p.title + " " + p.description);
						const overlap = [...mine].filter((w) => theirs.has(w)).length;
						return {
							post: p,
							score: overlap / Math.max(3, Math.min(mine.size, theirs.size)),
						};
					})
					.filter((m) => m.score >= 0.45)
					.sort((a, b) => b.score - a.score)
					.slice(0, 2);
				setDuplicates(matches.map((m) => m.post));
			} catch {
				/* non-blocking */
			}
		},
		[],
	);

	useEffect(() => {
		if (type === "poll") {
			setDuplicates([]);
			return;
		}
		const t = setTimeout(() => checkDuplicates(title, desc, category), 700);
		return () => clearTimeout(t);
	}, [title, desc, category, type, checkDuplicates]);

	// restore draft once
	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;
		const d = lsGet<Draft | null>(DRAFT_KEY, null);
		if (d && (d.title || d.desc)) {
			setTitle(d.title || "");
			setDesc(d.desc || "");
			setCategory(d.category || "Academics");
			setTags(d.tags || "");
			setType(d.type || initialType);
			// A restored draft means unfinished typing.

			toast("Draft restored", "info");
		}
	}, [initialType, toast]);

	// autosave draft (debounced)
	useEffect(() => {
		const t = setTimeout(() => {
			if (title || desc) {
				lsSet(DRAFT_KEY, {
					title,
					desc,
					category,
					tags,
					type,
					savedAt: new Date().toISOString(),
				});
				setDraftSaved(true);
				setTimeout(() => setDraftSaved(false), 1600);
			}
		}, 900);
		return () => clearTimeout(t);
	}, [title, desc, category, tags, type]);

	const pickImage = (f: File) => {
		if (f.size > 3 * 1024 * 1024) {
			toast("Image must be under 3 MB", "err");
			return;
		}
		// Downscale before upload: a 3 MB phone photo becomes ~4 MB of base64
		// (server cap is 4 MB) and bills full-size storage + egress forever.
		// Re-encoded to a 1280px JPEG client-side — silent upgrade, preview
		// shows the exact bytes that will upload. Falls back to the original
		// file on old browsers (GIF/SVG always pass through untouched).
		void downscaleImage(f).then((d) => {
			if (!d.base64) {
				toast("Couldn't read that image — try another file", "err");
				return;
			}
			setImage({
				preview: d.dataUrl,
				base64: d.base64,
				type: d.type,
			});
		});
	};

	const submit = async () => {
		// Mark fields as touched to show inline errors
		setTouched({ title: true, desc: true });
		// Capture before the poll early-return narrows `type`.
		const isPollSubmit = type === "poll";

		const cd = checkCooldown("post", 20);
		if (cd) {
			toast(`Cooldown active — wait ${cd}s before posting again`, "err");
			return;
		}

		// Pre-send gate: saves a doomed round-trip only. The SERVER is
		// authoritative and re-runs the full pipeline on write.
		//
		// Two sources, because neither is sufficient alone:
		//  - `serverBlocked` is the real verdict from /api/moderate, which
		//    includes the contextual classifier. This is what catches
		//    "Dhansiri, I will hate you".
		//  - the local word list is a synchronous backstop for the instant
		//    after a keystroke, before the debounce has answered.
		// Same text the live check evaluated — never a narrower slice, or the
		// gate and the panel disagree (PII in a poll option blocked at submit
		// with no prior warning, or vice versa).
		const fullText = liveText;
		const mod: ModerationResult = moderation ?? moderateContent(fullText);
		const blockedByServer =
			moderation?.serverBlocked === true || isBlockedByServer(mod);
		if (blockedByServer) {
			toast(submitBlockMessage(mod, type === "poll" ? "poll" : "post"), "err");
			setBlockedAppeal(
				type === "poll"
					? {
							surface: "poll",
							title: sanitize(title, 140),
							body: options.map((o) => sanitize(o, 60)).filter(Boolean).join("\n"),
							context: { ptype: pollType, options: options.map((o) => sanitize(o, 60)).filter(Boolean) },
						}
					: {
							surface: "post",
							title: sanitize(title, 120),
							body: sanitize(desc, 500),
							context: { category },
						},
			);
			return;
		}
		setBlockedAppeal(null);

		// Double-fire guard: runs synchronously on click, before any await,
		// so a second click can never start a concurrent publish.
		if (submitBusyRef.current) return;
		submitBusyRef.current = true;
		try {
		if (type === "poll") {
			if (title.trim().length < 5) {
				toast("Poll question must be at least 5 characters", "err");
				submitBusyRef.current = false;
			return;
			}
			const opts =
				pollType === "yesno"
					? []
					: options.map((o) => sanitize(o, 60)).filter(Boolean);
			if (pollType !== "yesno" && opts.length < 2) {
				toast("Add at least 2 options", "err");
				submitBusyRef.current = false;
			return;
			}
			setBusy(true);
			try {
				await api.postLong("/api/polls", {
					title: sanitize(title, 140),
					ptype: pollType,
					options: opts,
					author_id: anonId,
					expires_at: expiry ? new Date(expiry).toISOString() : null,
					post_id: linkPost || null,
				});
				stampCooldown("post");
				lsSet(DRAFT_KEY, null);
				fireConfetti();
				toast("Poll published anonymously", "ok");
				nav("/polls");
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : "Publish failed";
				toast(msg, "err");
				if (/safety guidelines|personal information|previously removed/i.test(msg)) {
					setBlockedAppeal({
						surface: "poll",
						title: sanitize(title, 140),
						body: opts.join("\n"),
						context: { ptype: pollType, options: opts },
					});
				}
			}
			setBusy(false);
			return;
		}

		if (title.trim().length < 5) {
			toast("Title must be at least 5 characters", "err");
			submitBusyRef.current = false;
			return;
		}
		if (desc.trim().length < 10) {
			toast("Description must be at least 10 characters", "err");
			submitBusyRef.current = false;
			return;
		}

		const attachOpts = attachOptions.map((o) => sanitize(o, 60)).filter(Boolean);
		if (attachPoll) {
			if (attachQuestion.trim().length < 5) {
				toast("Poll question must be at least 5 characters", "err");
				submitBusyRef.current = false;
				return;
			}
			if (attachOpts.length < 2) {
				toast("Add at least 2 poll options", "err");
				submitBusyRef.current = false;
				return;
			}
		}
		setBusy(true);
		setPrePubResult(null);
		try {
			// Step 1: Ask the advisory server-side pre-publish agent for a
			// quality/safety signal. The POST route below remains authoritative.
			setPrePubBusy(true);
			let prePub: PrePubResult | null = null;
			let holdForReview = false; // true → post is queued for admin review instead of publishing
			try {
				prePub = normalizePrePubResult(
				// The advisory verdict is untrusted network input: normalize it
				// at the boundary so no later render can index a missing field.
				await api.postLong<unknown>("/api/pre-publish", {
					content_type: type,
					title: sanitize(title, 140),
					description: sanitize(desc, 500),
					category,
					author_id: anonId,
				}),
			);
			} catch (ppErr) {
				// The advisory AI check is best-effort. The /api/posts handler is
				// the authoritative safety boundary and runs deterministic PII,
				// violence, profanity and weak-signal checks on every write. A
				// timed-out advisory request must not turn an otherwise valid
				// complaint into an invisible pending_review post (and must not
				// be replayed by the offline queue).
				console.warn(
					"[Submit] pre-publish advisory check unavailable; server gate will validate:",
					ppErr,
				);
				toast(
					"Moderation check is taking longer than usual — your post will still be checked when submitted.",
					"info",
				);
			}
			setPrePubBusy(false);

			// Step 2: Handle pre-publish decision
			if (prePub) {
				setPrePubResult(prePub);
				// PII (address/phone/email) is always blocked — never allow a leak to publish
				const privacyFailed =
					prePub.checks?.privacy && !prePub.checks.privacy.pass;
				if (prePub.decision === "high_risk" || privacyFailed) {
					toast(
						`Content held for review: ${prePub.reason || "Personal information detected — remove addresses, phone numbers, or emails"}.`,
						"err",
					);
					setBusy(false);
					return;
				}
				if (prePub.decision === "revision") {
					// 'revision' content is NOT safe to publish immediately — queue it for
					// admin review so the "reviewed before going public" promise holds.
					holdForReview = true;
					toast(
						`AI flagged this: ${prePub.reason}. It will be reviewed before going public.`,
						"info",
					);
				}
			}

			// Step 3: Publish the post
			let image_url = null;
			if (image) {
				image_url = await api.uploadImage(image.base64, image.type, anonId);
			}
			// Send RAW sanitized fields — the server masks at insert (_posts.js
			// masks profanity on the way into the DB). Masking here would feed
			// masked text to the pre-publish gate, blinding it to the real
			// content, and would show the user text they never typed.
			const post = await api.postLong<{ id: string; title?: string; status?: string; deduped?: boolean }>(
				"/api/posts",
				{
					type,
					title: sanitize(title, 120),
					description: sanitize(desc, 500),
					category,						author_id: anonId,
					image_url,
					tags: tags
						.split(",")
						.map((t) => sanitize(t.trim(), 24))
						.filter(Boolean)
						.slice(0, 6),
					pending_review: holdForReview,
					visibility: isPrivate ? "private" : "public",
				},
			);
			stampCooldown("post");
			lsSet(DRAFT_KEY, null);
			// Server truth wins: a spam-held or deduped-held post reports
			// pending_review even when the client pre-gate saw nothing wrong.
			const held = holdForReview || post.status === "pending_review";
			pushNotif({
				kind: "submitted",
				title: held
					? "Your post is under review"
					: "Your post is live",
				body: post.title ?? title,
				link: `/post/${post.id}`,
			});
			// Celebration only for actually-published posts — a held post is
			// not live, and confetti would teach users that review == posted.
			if (!held) fireConfetti();
			if (post.deduped) {
				toast("Already published — opened your existing post", "ok");
			} else {
				toast(
					held
						? "Submitted — a moderator will review it before it goes public"
						: "Submitted anonymously",
					"ok",
				);
			}
						if (attachPoll && post.deduped) {
				// The post API matched this submission to a complaint the
				// author ALREADY published. Attaching a poll here would put a
				// second poll on someone else's (or an earlier) post — the
				// reported "two polls on the same post" bug. This submission
				// created no new post, so it owns no new poll.
				toast(
					"That complaint was already posted — opened it without adding a second poll.",
					"info",
				);
			} else if (attachPoll && !held) {
				try {
					await api.postLong("/api/polls", {
						title: sanitize(attachQuestion, 140),
						ptype: "single",
						options: attachOpts,
						post_id: post.id,
					});
					toast("Post and poll published", "ok");
				} catch (e: unknown) {
					toast(`Post published, but the poll failed: ${e instanceof Error ? e.message : "Publish failed"}. You can add it later from the post page.`, "err");
				}
			} else if (attachPoll && held) {
				toast("Post held for review — add the poll after it's approved.", "info");
			}
			nav(type === "suggestion" ? "/suggestions" : `/post/${post.id}`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "Publish failed";
			toast(msg, "err");
			// Safety 403s (blocked / repost-fingerprint) get the same recourse
			// as the client pre-gate — any other failure does not.
			if (/safety guidelines|personal information|previously removed/i.test(msg)) {
				setBlockedAppeal({
					surface: isPollSubmit ? "poll" : "post",
					title: sanitize(title, 140),
					body: sanitize(desc, 500),
					context:
						isPollSubmit
							? { ptype: pollType, options: options.map((o) => sanitize(o, 60)).filter(Boolean) }
							: { category },
				});
			}
		}
		setBusy(false);
		} finally {
			submitBusyRef.current = false;
		}
	};

	/**
	 * Live moderation feedback, shared by every submission type.
	 *
	 * This used to live only inside the non-poll branch, so a poll author whose
	 * wording tripped the gate saw a disabled "Fix issues first" button with no
	 * on-screen explanation of what was wrong. `liveText` already covers the poll
	 * question + options, so the verdict is valid here too — it just was not
	 * rendered. One definition, called from both branches, so the two can never
	 * drift apart.
	 */
	const renderLiveModerationFeedback = () => (
		<>
			{/* Advisory: does this read as an actionable school problem? */}
			<RelevanceNote
				relevance={relevance}
				text={liveText}
				checking={modChecking}
			/>
			{moderation && modFlags.length > 0 && (
				<div
					className={`rounded-xl p-3.5 vb-rise ${isBlockedByServer(moderation) ? "moderation-blocked" : moderation.overallSeverity === "high" ? "moderation-danger" : moderation.overallSeverity === "medium" ? "moderation-warn" : "moderation-info"}`}
				>
					<p className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
						{isBlockedByServer(moderation) ? (
							<>
								<ShieldAlert size={12} /> Content blocked
							</>
						) : (
							<>
								<ShieldCheck size={12} /> Content review
							</>
						)}
					</p>
					<div className="space-y-1.5">
						{modFlags.map((flag, i) => (
							<div key={i} className="flex items-start gap-2 text-xs">
								<span
									className={`shrink-0 mt-0.5 ${
										flag.severity === "critical" || flag.severity === "high"
											? "text-bad"
											: flag.severity === "medium"
												? "text-warn"
												: "text-ink3"
									}`}
								>
									{flag.severity === "critical" ||
									flag.severity === "high" ? (
										<X size={12} />
									) : (
										<AlertTriangle size={12} />
									)}
								</span>
								<span className="text-ink2">{flag.message}</span>
							</div>
						))}
					</div>
					{isBlockedByServer(moderation) && (
						<p
							className="text-[11px] mt-2 font-semibold"
							style={{ color: "var(--vb-bad)" }}
						>
							Please remove the flagged content to continue. Repeated
							violations may result in a temporary suspension.
						</p>
					)}
					{!isBlockedByServer(moderation) &&
						moderation.overallSeverity !== "none" && (
							<p className="text-[11px] mt-2 text-ink3">
								Your content will be reviewed before publishing. Please
								ensure all feedback is constructive and respectful.
							</p>
						)}
				</div>
			)}
			{modChecking && (
				<div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink3">
					<Loader2 size={13} className="animate-spin" />
					<span>Checking content against the safety policy…</span>
				</div>
			)}
			{moderation &&
				!modChecking &&
				modFlags.length === 0 &&
				(title.length > 10 || desc.length > 10 || liveText.trim().length > 10) && (
					<div
						className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs vb-rise"
						style={{
							background: "rgba(22,160,106,0.08)",
							border: "1px solid rgba(22,160,106,0.2)",
						}}
					>
						<ShieldCheck size={13} style={{ color: "var(--vb-good)" }} />
						<span style={{ color: "var(--vb-good)" }}>
							No issues found so far — final AI review runs when you publish
						</span>
					</div>
				)}
		</>
	);

	const TABS = [
		{ key: "problem", label: "Problem", icon: Megaphone },
		{ key: "suggestion", label: "Suggestion", icon: Lightbulb },
		{ key: "poll", label: "Poll", icon: BarChart3 },
	] as const;

	return (
		<div className="max-w-2xl mx-auto vb-page-enter">
			{restricted && (
				<div
					className="card p-4 mb-5 text-sm font-medium vb-rise"
					style={{ borderColor: "rgba(220,75,75,0.35)", color: "#dc4b4b" }}
					role="alert"
				>
					{accountStatus?.banned
						? "This anonymous ID has been permanently banned — publishing is disabled."
						: `Your ID is suspended until ${new Date(accountStatus!.suspended_until!).toLocaleDateString()} — publishing is paused.`}
				</div>
			)}
			<h1 className="font-display font-bold text-2xl mb-1" id="submit-heading">
				Submit anonymously
			</h1>
			<p className="text-sm text-ink3 mb-5" id="submit-description">
				No name, no email, no tracking. Only your anonymous browser ID is
				attached — and only you know it's yours.
			</p>

			<div
				className="flex gap-2 mb-5"
				role="tablist"
				aria-label="Content type selection"
			>
				{TABS.map(({ key, label, icon: Icon }) => (
					<button
						key={key}
						role="tab"
						aria-selected={type === key}
						onClick={() => setType(key)}						className={`btn flex-1 ${type === key ? "btn-primary" : "btn-ghost"}`}
					>
						<Icon size={15} /> {label}
					</button>
				))}
			</div>

			<div className="card p-5 sm:p-6 space-y-5 vb-rise">
				<div>
					<label
						className="text-xs font-semibold text-ink2 block mb-1.5"
						htmlFor="f-title"
					>
						{type === "poll" ? "Poll question" : "Title"}{" "}
						<span className="text-bad">*</span>
					</label>
					<input
						id="f-title"
						className={`input ${titleError ? "moderation-flag" : ""} ${modFlags.some((f) => f.category === "profanity" || f.category === "hate_speech" || f.category === "privacy") ? "moderation-flag" : moderation && modFlags.length === 0 && title.length > 10 ? "moderation-ok" : ""}`}
						placeholder={
							type === "poll"
								? "Should the library stay open until 8pm?"
								: type === "suggestion"
									? "Add water fountains near the gym"
									: "Broken AC in classroom 2B"
						}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						onBlur={() => setTouched((t) => ({ ...t, title: true }))}
						maxLength={type === "poll" ? 140 : 120}
						aria-required="true"
						aria-describedby="f-title-help"
						aria-invalid={!!titleError}
					/>
					{titleError && (
						<p className="text-[11px] text-bad mt-1 font-medium flex items-center gap-1">
							<AlertTriangle size={11} /> {titleError}
						</p>
					)}
					<p
						id="f-title-help"
						className="text-[10px] text-ink3 mt-1 text-right"
					>
						{title.length}/{type === "poll" ? 140 : 120}
					</p>
				</div>

				{type === "poll" ? (
					<>
						<div>
							<label className="text-xs font-semibold text-ink2 block mb-1.5">
								Poll type
							</label>
							<div className="flex gap-2">
								{(
									[
										["yesno", "Yes / No"],
										["single", "Single choice"],
										["multi", "Multiple choice"],
									] as const
								).map(([k, l]) => (
									<button
										key={k}
										onClick={() => setPollType(k)}
										className={`btn flex-1 !text-xs ${pollType === k ? "btn-soft" : "btn-ghost"}`}
									>
										{l}
									</button>
								))}
							</div>
						</div>
						{pollType !== "yesno" && (
							<div>
								<label className="text-xs font-semibold text-ink2 block mb-1.5">
									Options (2–10)
								</label>
								<div className="space-y-2">
									{options.map((o, i) => (
										<div key={i} className="flex gap-2">
											<input
												name={`poll-option-${i}`}
												className="input"
												placeholder={`Option ${i + 1}`}
												value={o}
												maxLength={60}
												onChange={(e) =>
													setOptions((prev) =>
														prev.map((x, j) => (j === i ? e.target.value : x)),
													)
												}
											/>
											{options.length > 2 && (
												<button
													className="btn btn-ghost !p-2.5"
													onClick={() =>
														setOptions((prev) => prev.filter((_, j) => j !== i))
													}
													aria-label="Remove option"
												>
													<X size={14} />
												</button>
											)}
										</div>
									))}
								</div>
								{options.length < 10 && (
									<button
										className="btn btn-ghost !text-xs mt-2"
										onClick={() => setOptions((p) => [...p, ""])}
									>
										+ Add option
									</button>
								)}
							</div>
						)}
						{/* Smart poll AI suggestion panel */}
						{pollSuggest &&
							(pollSuggest.improved_title ||
								(pollSuggest.suggested_options || []).length > 0) && (
								<div
									className="rounded-xl p-3.5 vb-rise"
									style={{
										background: "var(--vb-accent-soft)",
										border: "1px solid rgba(86,82,214,0.2)",
									}}
								>
									<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2 flex items-center gap-1.5">
										<Sparkles size={12} /> Smart poll AI · update as you type
									</p>
									{pollSuggest.improved_title &&
										pollSuggest.improved_title.toLowerCase() !==
											title.toLowerCase() && (
											<button
												type="button"
												className="w-full text-left text-xs px-2.5 py-2 rounded-lg bg-surface border border-border hover:border-accent transition-all flex items-center gap-2"
												onClick={() =>
													setTitle(pollSuggest.improved_title!.slice(0, 140))
												}
											>
												<Pencil size={12} className="text-accent shrink-0" />{" "}
												Better question: <b>"{pollSuggest.improved_title}"</b>{" "}
												<span className="text-accent font-bold ml-auto">
													use
												</span>
											</button>
										)}
									{(pollSuggest.suggested_options || []).length > 0 && (
										<div className="mt-2">
											<p className="text-[10px] text-ink3 mb-1">
												Suggested options:
											</p>
											<div className="flex flex-wrap gap-1.5">
												{(pollSuggest.suggested_options || []).map((o, i) => (
													<button
														key={i}
														type="button"
														className="chip cursor-pointer !bg-surface hover:!border-accent transition-all"
														onClick={() => {
															if (pollType === "yesno") {
																setPollType("single");
																setOptions(["", ""]);
															}
															setOptions((prev) => {
																const existing = prev
																	.map((x) => x.trim())
																	.filter(Boolean);
																if (existing.length >= 10) return prev;
																const filled = [...prev];
																const idx = filled.findIndex((x) => !x.trim());
																if (idx >= 0) filled[idx] = o.slice(0, 60);
																else filled.push(o.slice(0, 60));
																return filled.length < 2
																	? [...filled, ""]
																	: filled;
															});
														}}
													>
														+ {o}
													</button>
												))}
											</div>
										</div>
									)}
									{pollSuggest.note && (
										<p className="text-[10px] text-ink3 mt-2 italic">
											💡 {pollSuggest.note}
										</p>
									)}
								</div>
							)}
						<div>
							<label
								className="text-xs font-semibold text-ink2 block mb-1.5"
								htmlFor="f-link"
							>
								Link to one of your posts (optional)
							</label>
							<select
								id="f-link"
								className="input"
								value={linkPost}
								onChange={(e) => setLinkPost(e.target.value)}
							>
								<option value="">— Standalone poll (no link) —</option>
								{linkablePosts.map((p) => (
									<option key={p.id} value={p.id}>
										{p.title.slice(0, 60)}
									</option>
								))}
							</select>
							<p className="text-[10px] text-ink3 mt-1">
								Linked polls appear on the complaint's page and help admins
								gauge community opinion.
							</p>
						</div>
						<div>								<label
									className="text-xs font-semibold text-ink2 block mb-1.5"
									htmlFor="f-expiry"
								>
									Expiration date (optional)
								</label>
								<div className="flex flex-wrap gap-1.5 mb-2">
									{[
										{ label: "1 hour", ms: 3600000 },
										{ label: "24 hours", ms: 86400000 },
										{ label: "7 days", ms: 604800000 },
										{ label: "30 days", ms: 2592000000 },
									].map((p) => (
										<button
											key={p.ms}
											type="button"
											onClick={() => {
												const d = new Date(Date.now() + p.ms);
												setExpiry(d.toISOString().slice(0, 16));
											}}
											className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
												expiry === new Date(Date.now() + p.ms).toISOString().slice(0, 16)
													? "border-accent bg-accent-soft text-accent"
													: "border-border text-ink3 hover:border-accent/50"
											}`}
										>
											{p.label}
										</button>
									))}
								</div>
								<input
									id="f-expiry"
									type="datetime-local"
									className="input"
									value={expiry}
									onChange={(e) => setExpiry(e.target.value)}									min={new Date().toISOString().slice(0, 16)}
								/>
							</div>
						{renderLiveModerationFeedback()}
					</>
				) : (
					<>


							<>
						<div>
							<div className="flex items-center justify-between mb-1.5">
								<label
									className="text-xs font-semibold text-ink2"
									htmlFor="f-desc"
								>
									Description <span className="text-bad">*</span>
								</label>
							</div>
							<div className="relative">
								<textarea
									id="f-desc"
									className={`input min-h-32 resize-y ${descError ? "moderation-flag" : ""} modFlags.some((f) => f.category === "profanity" || f.category === "hate_speech" || f.category === "privacy" || f.category === "dangerous") ? "moderation-flag" : moderation && modFlags.length === 0 && desc.length > 10 ? "moderation-ok" : ""}`}
									placeholder="Describe the issue clearly. What happened? Where? How often? (max 500 characters)"
									value={desc}
									onChange={(e) => setDesc(e.target.value.slice(0, 500))}
									onBlur={() => setTouched((t) => ({ ...t, desc: true }))}
									maxLength={500}
									aria-required="true"
									aria-describedby="f-desc-help"
									aria-invalid={!!descError}
								/>
							</div>
							<div className="flex justify-between mt-1">
								{descError ? (
									<p className="text-[11px] text-bad font-medium flex items-center gap-1">
										<AlertTriangle size={11} /> {descError}
									</p>
								) : (
									<span />
								)}
								<p
									id="f-desc-help"
									className={`text-[10px] ${desc.length > 450 ? "text-warn font-semibold" : "text-ink3"}`}
								>
									{desc.length}/500
								</p>
							</div>
							{(type === "problem" || type === "suggestion") && (
								<button
									type="button"
									onClick={structureText}
									disabled={voiceBusy || desc.trim().length < 8}
									className="btn btn-ghost w-full mt-2 !py-2.5 disabled:opacity-50"
								>
									<Sparkles size={15} />{" "}
									{voiceBusy ? "Writing your complaint…" : "Turn into complaint"}
								</button>
							)}
							{renderDraftCard()}
						</div>

						{/* Live content moderation feedback — shared across all submission types */}
						{renderLiveModerationFeedback()}

						{/* Pre-publish AI review panel — shows after server-side AI analysis */}
						{prePubBusy && (
							<div
								className="rounded-xl p-4 vb-rise animate-pulse"
								style={{
									background: "var(--vb-accent-soft)",
									border: "1px solid rgba(86,82,214,0.2)",
								}}
							>
								<div className="flex items-center gap-2 mb-3">
									<Sparkles size={12} className="text-accent animate-spin" />
									<p className="text-[10px] font-bold uppercase tracking-wider text-accent">
										AI analyzing your content…
									</p>
								</div>
								<div className="space-y-2">
									<div className="h-3 w-full rounded bg-accent/10" />
									<div className="h-3 w-3/4 rounded bg-accent/10" />
									<div className="grid grid-cols-2 gap-2 mt-3">
										<div className="h-6 rounded bg-accent/10" />
										<div className="h-6 rounded bg-accent/10" />
										<div className="h-6 rounded bg-accent/10" />
										<div className="h-6 rounded bg-accent/10" />
									</div>
								</div>
								<p className="text-[10px] text-ink3 mt-2 italic">
									Checking for safety, privacy, spam, and quality issues…
								</p>
							</div>
						)}
						{prePubResult && (
							<div
								className={`rounded-xl p-4 vb-rise ${
									prePubResult.decision === "high_risk"
										? "moderation-blocked"
										: prePubResult.decision === "revision"
											? "moderation-warn"
											: "moderation-info"
								}`}
							>
								<div className="flex items-center justify-between mb-3">
									<p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
										{prePubResult.decision === "high_risk" ? (
											<>
												<ShieldAlert size={12} /> AI review — blocked
											</>
										) : prePubResult.decision === "revision" ? (
											<>
												<AlertTriangle size={12} /> AI review — needs attention
											</>
										) : prePubResult.decision === "safe" ? (
											<>
												<ShieldCheck size={12} /> AI review — safe to publish
											</>
										) : (
											// Any other value — including a missing one — is a verdict we
											// cannot read. The old fallthrough crowned it "safe to
											// publish": a green light nobody issued.
											<>
												<AlertTriangle size={12} /> AI review — could not confirm
											</>
										)}
									</p>
									{prePubResult.analysis?.llm_analyzed && (
										<span
											className="text-[9px] font-mono px-1.5 py-0.5 rounded"
											style={{
												background: "rgba(86,82,214,0.15)",
												color: "var(--vb-accent)",
											}}
										>
											{prePubResult.analysis.estimated_resolution_time
												? `~${prePubResult.analysis.estimated_resolution_time}`
												: "analyzed"}
										</span>
									)}
								</div>

								{/* Risk score bar */}
								<div className="mb-3">
									<div className="flex items-center justify-between mb-1">
										<span className="text-[11px] font-semibold text-ink2">
											Risk score
										</span>
										<span
											className={`text-[11px] font-bold ${
												prePubResult.risk_score >= 70
													? "text-bad"
													: prePubResult.risk_score >= 30
														? "text-warn"
														: "text-good"
											}`}
										>
											{prePubResult.risk_score}/100
										</span>
									</div>
									<div
										className="w-full h-1.5 rounded-full overflow-hidden"
										style={{ background: "var(--vb-border)" }}
									>
										<div
											className={`h-full rounded-full transition-all duration-700 ${
												prePubResult.risk_score >= 70
													? "bg-bad"
													: prePubResult.risk_score >= 30
														? "bg-warn"
														: "bg-good"
											}`}
											style={{
												width: `${Math.min(100, prePubResult.risk_score)}%`,
											}}
										/>
									</div>
								</div>

								{/* Check results grid */}
								{prePubCheckRows.length > 0 && (
									<div className="grid grid-cols-2 gap-2 mb-3">
										{prePubCheckRows.map(({ key, label, check }) => (
											<div
												key={key}
												className="flex items-center gap-1.5 text-[11px]"
											>
												{check.pass ? (
													<span className="text-good">
														<CheckCircle2 size={11} />
													</span>
												) : (
													<span className="text-bad">
														<X size={11} />
													</span>
												)}
												<span
													className={
														check.pass ? "text-ink3" : "text-ink2 font-semibold"
													}
												>
													{label}
												</span>
												{check.issues.length > 0 && (
													<span className="text-[9px] text-bad font-mono">
														({check.issues.length})
													</span>
												)}
											</div>
										))}
									</div>
								)}

								{/* AI reason */}
								<p className="text-[11px] text-ink2 leading-relaxed">
									{prePubResult.reason}
								</p>

								{/* Action hint */}
								{prePubResult.decision === "high_risk" && (
									<>
										<p className="text-[11px] mt-2 font-semibold text-bad">
											Not submitted — remove personal info and try again.
											Your draft is preserved above.
										</p>
										<button
											type="button"
											onClick={() => setPrePubResult(null)}
											className="mt-2 text-[11px] font-semibold text-ink3 hover:text-accent"
										>
											Dismiss
										</button>
									</>
								)}
								{prePubResult.decision === "revision" && (
									<p className="text-[11px] mt-2 text-warn">
										AI flagged something — you can still submit, but it will be
										reviewed before going public.
									</p>
								)}
								{prePubResult.decision === "safe" && (
									<p className="text-[11px] mt-2 text-good">
										All checks passed — ready to publish.
									</p>
								)}
							</div>
						)}

						{/* Live AI suggestions: category, priority, tags, improved title */}
						{aiSuggest?.category && (
							<div
								className="rounded-xl p-3.5 vb-rise"
								style={{
									background: "var(--vb-accent-soft)",
									border: "1px solid rgba(86,82,214,0.2)",
								}}
							>
								<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2 flex items-center gap-1.5">
									<Sparkles size={12} /> AI suggestions · updating live
								</p>
								<div className="flex flex-wrap gap-1.5">
									{aiSuggest.category !== category ? (
										<button
											type="button"
											className="chip cursor-pointer !bg-surface hover:!border-accent transition-all"
											onClick={() => {
												setCategory(aiSuggest.category);
												toast(`Category → ${aiSuggest.category}`, "ok");
											}}
										>
											{CAT_EMOJI[aiSuggest.category]} {aiSuggest.category} ·{" "}
											{Math.round((aiSuggest.confidence || 0) * 100)}%{" "}
											<span className="text-accent font-bold">apply</span>
										</button>
									) : (
										<span
											className="chip !border-transparent"
											style={{
												background: "rgba(22,160,106,0.12)",
												color: "var(--vb-good)",
											}}
										>
											<CheckCircle2 size={11} /> {CAT_EMOJI[category]}{" "}
											{category}
										</span>
									)}
	
									{(aiSuggest.tags || [])
										.filter(
											(t: string) =>
												!tags.toLowerCase().includes(t.toLowerCase()),
										)
										.slice(0, 3)
										.map((t: string) => (
											<button
												key={t}
												type="button"
												className="chip cursor-pointer !bg-surface hover:!border-accent transition-all"
												onClick={() =>
													setTags((prev) => (prev ? `${prev}, ${t}` : t))
												}
											>
												#{t} <span className="text-accent font-bold">+</span>
											</button>
										))}
								</div>
								{aiSuggest.improved_title &&
									aiSuggest.improved_title.toLowerCase() !==
										title.toLowerCase() && (
										<button
											type="button"
											className="w-full text-left text-xs mt-2 px-2.5 py-2 rounded-lg bg-surface border border-border hover:border-accent transition-all flex items-center gap-2"
											onClick={() =>
												setTitle(aiSuggest.improved_title!.slice(0, 120))
											}
										>
											<Pencil size={12} className="text-accent shrink-0" />{" "}
											Better title: <b>"{aiSuggest.improved_title}"</b>{" "}
											<span className="text-accent font-bold ml-auto">use</span>
										</button>
									)}
							</div>
						)}
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<label
									className="text-xs font-semibold text-ink2 block mb-1.5"
									htmlFor="f-cat"
								>
									Category
								</label>
								<select
									id="f-cat"
									className="input"
									value={category}
									onChange={(e) => setCategory(e.target.value)}
								>
									{categories.map((c) => (
										<option key={c} value={c}>
											{CAT_EMOJI[c]} {c}
										</option>
									))}
								</select>
							</div>
						</div>
						{/* Private visibility — admins/moderators + you only */}
						<button
							type="button"
							role="switch"
							aria-checked={isPrivate}
							onClick={() => setIsPrivate((v) => !v)}
							className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all border ${
								isPrivate
									? "border-accent/40 bg-accent-soft/60"
									: "border-border bg-surface hover:border-accent/30"
							}`}
						>
							<span
								className={`shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors ${isPrivate ? "bg-accent" : "bg-surface3"}`}
								aria-hidden
							>
								<span
									className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${isPrivate ? "translate-x-4" : "translate-x-0.5"}`}
								/>
							</span>
							<span className="min-w-0">
								<span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
									<Lock size={12} className={isPrivate ? "text-accent" : "text-ink3"} />
									Private post
								</span>
								<span className="block text-[10px] text-ink3 mt-0.5">
									Only you, admins and moderators can read this. Hidden from the
									public feed.
								</span>
							</span>
						</button>
						<div>
							<label
								className="text-xs font-semibold text-ink2 block mb-1.5"
								htmlFor="f-tags"
							>
								Tags (optional, comma-separated)
							</label>
							<input
								id="f-tags"
								className="input"
								placeholder="wifi, second-floor, recurring"
								value={tags}
								onChange={(e) => setTags(e.target.value)}
							/>
						</div>
						<div>
							<label className="text-xs font-semibold text-ink2 block mb-1.5">
								Image (optional)
							</label>
							{image ? (
								<div className="relative inline-block">
									<img
										src={image.preview}
										alt="Upload preview"
										className="h-28 rounded-xl border border-border object-cover"
									/>
									<button
										className="absolute -top-2 -right-2 bg-bad text-white rounded-full p-1"
										onClick={() => setImage(null)}
										aria-label="Remove image"
									>
										<X size={12} />
									</button>
								</div>
							) : (
								<button
									className="btn btn-ghost"
									onClick={() => fileRef.current?.click()}
									aria-label="Attach image to your submission"
								>
									<ImagePlus size={15} /> Attach image
								</button>
							)}
							<input
								ref={fileRef}
								type="file"
								name="submission-image"
								accept="image/png,image/jpeg,image/gif,image/webp"
								className="hidden"
								onChange={(e) =>
									e.target.files?.[0] && pickImage(e.target.files[0])
								}
							/>
						</div>
							</>
					</>
				)}

				{type !== "poll" && (
					<div className="rounded-xl border border-border p-4 space-y-3">
						<button
							type="button"
							onClick={() => setAttachPoll((v) => !v)}
							aria-expanded={attachPoll}
							className="flex items-center gap-2 text-xs font-semibold text-ink2 hover:text-ink transition-colors"
						>
							<BarChart3 size={14} className="text-accent" />
							{attachPoll ? "Poll attached — tap to remove" : "Attach a poll (optional)"}
						</button>
						{attachPoll && (
							<>
								<div>
									<label className="text-xs font-semibold text-ink2 block mb-1.5" htmlFor="f-attach-q">
										Poll question
									</label>
									<input
										id="f-attach-q"
										className="input"
										placeholder="What should we ask?"
										value={attachQuestion}
										onChange={(e) => setAttachQuestion(e.target.value)}
										maxLength={140}
									/>
								</div>
								<div>
									<span className="text-xs font-semibold text-ink2 block mb-1.5">
										Options (2–10)
									</span>
									<div className="space-y-2">
										{attachOptions.map((o, i) => (
											<div key={i} className="flex gap-2">
												<input
													className="input"
													placeholder={`Option ${i + 1}`}
													aria-label={`Attach poll option ${i + 1}`}
													value={o}
													maxLength={60}
													onChange={(e) =>
														setAttachOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)),
											)
												}
											/>
												{attachOptions.length > 2 && (
													<button
														className="btn btn-ghost !p-2.5"
														onClick={() => setAttachOptions((prev) => prev.filter((_, j) => j !== i))}
														aria-label="Remove option"
													>
														<X size={14} />
													</button>
												)}
											</div>
										))}
									</div>
									{attachOptions.length < 10 && (
										<button
											className="btn btn-ghost !text-xs mt-2"
											onClick={() => setAttachOptions((prev) => [...prev, ""])}
										>
											+ Add option
										</button>
									)}
								</div>
								<p className="text-[10px] text-ink3">
									Created together with your post and linked to it.
								</p>
							</>
						)}
					</div>
				)}


				{/* Duplicate warning — similar open posts in this category */}
				{type !== "poll" && duplicates.length > 0 && (
					<div
						className="rounded-xl p-3.5 vb-rise"
						style={{
							background: "rgba(217,138,11,0.08)",
							border: "1px solid rgba(217,138,11,0.3)",
						}}
					>
						<p className="text-xs font-bold flex items-center gap-1.5 text-warn mb-2">
							<Copy size={12} /> Similar post{duplicates.length > 1 ? "s" : ""}{" "}
							already exist{duplicates.length === 1 ? "s" : ""}
						</p>
						{duplicates.map((d) => (
							<Link
								key={d.id}
								to={`/post/${d.id}`}
								className="block text-sm font-medium py-1.5 border-b last:border-0 hover:text-accent transition-colors"
								style={{ borderColor: "rgba(217,138,11,0.15)" }}
							>
								{d.title}{" "}
								<span className="text-[11px] text-ink3">
									· {(d.status || "open").replace("_", " ")} ·{" "}
								{d.reactions?.support || 0}{" "}
									supports
								</span>
							</Link>
						))}
						<p className="text-[11px] text-ink3 mt-2">
							Consider supporting the existing post instead — combined votes get
							solved faster. You can still publish yours.
						</p>
					</div>
				)}

				{type !== "poll" && preview && (
					<div className="border border-dashed border-accent/40 rounded-xl p-4 bg-accent-soft/40">
						<p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2">
							Preview
						</p>
						<div className="flex gap-2 mb-1.5">
							<span className="chip">{category}</span>
						</div>
						<h3 className="font-display font-semibold">
							{title || "Your title"}
						</h3>
						<p className="text-sm text-ink2 mt-1 prose-desc">
							{desc || "Your description will appear here."}
						</p>
					</div>
				)}

				<div className="flex items-center gap-3 pt-2 border-t border-border">
					{type !== "poll" && (
						<button
							className="btn btn-ghost"
							onClick={() => setPreview((p) => !p)}
							aria-label={preview ? "Hide preview" : "Show preview"}
						>
							<Eye size={15} /> {preview ? "Hide" : "Preview"}
						</button>
					)}
					<span
						className={`text-[11px] text-ink3 flex items-center gap-1 transition-opacity duration-300 ${draftSaved ? "opacity-100" : "opacity-0"}`}
					>
						<Save size={11} /> Draft saved
					</span>
					<button
						className={`btn btn-primary ml-auto ${busy ? "btn-loading" : ""}`}
						onClick={submit}
						disabled={
							busy ||
							restricted ||
							prePubBusy ||
							(moderation ? isBlockedByServer(moderation) : false)
						}
						aria-label={
							busy
								? "Publishing your submission"
								: prePubBusy
									? "Running AI content check"
									: moderation && isBlockedByServer(moderation)
										? "Content has issues that must be fixed first"
										: "Publish anonymously"
						}
					>
						{prePubBusy ? (
							<>
								<Sparkles size={15} /> AI checking…
							</>
						) : busy ? (
							"Publishing…"
						) : moderation && isBlockedByServer(moderation) ? (
							<>
								<ShieldAlert size={15} /> Fix issues first
							</>
						) : (
							<>
								<Send size={15} /> Publish anonymously
							</>
						)}
					</button>
				</div>

				{blockedAppeal ? (
					<AppealPanel
						surface={blockedAppeal.surface}
						title={blockedAppeal.title}
						body={blockedAppeal.body}
						context={blockedAppeal.context}
						onFiled={() => setBlockedAppeal(null)}
					/>
				) : (
					moderation && isBlockedByServer(moderation) && (
						<AppealPanel
							surface={type === "poll" ? "poll" : "post"}
							title={sanitize(title, 140)}
							body={sanitize(desc, 500)}
							context={
								type === "poll"
									? { ptype: pollType, options: options.map((o) => sanitize(o, 60)).filter(Boolean) }
									: { category }
							}
						/>
					)
				)}

				<p className="text-[11px] text-ink3 flex items-start gap-1.5 pt-1">
					<AlertTriangle size={12} className="mt-0.5 shrink-0" />
					{isPrivate
						? "Private post — visible only to you and the moderation team. Still filtered for abuse."
						: "Posts are public. Content is filtered for abuse and spam. Repeated misuse can lead to your anonymous ID being suspended — no personal data is ever collected."}
				</p>
			</div>
		</div>
	);
}
