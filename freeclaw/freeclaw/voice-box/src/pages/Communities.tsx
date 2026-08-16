// ─── Communities — browse + create your own group with a discussion feed ───
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
	Eye,
	EyeOff,
	MessageSquare,
	Plus,
	Trash2,
	Users,
} from "lucide-react";
import { Modal } from "../components/ui";
import { useApp } from "../contexts/AppContext";
import { api, hasAdminSession } from "../lib/api";

export interface CommunityCard {
	slug: string;
	name: string;
	description: string;
	avatar: string;
	photo?: string;
	created_by: string;
	created_at: string;
	hidden: boolean;
	member_count: number;
	post_count: number;
}

const AVATAR_CHOICES = ["🌐", "🎧", "🎮", "📚", "⚽", "🎨", "💻", "🧠", "🌱", "🚀", "🎬", "🏀"];

export default function Communities() {
	const { anonId, toast, displayName } = useApp();
	const isAdmin = hasAdminSession();
	const [communities, setCommunities] = useState<CommunityCard[] | null>(null);
	const [error, setError] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	// create form
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [avatar, setAvatar] = useState("🌐");
	const [photo, setPhoto] = useState("");
	const [photoDraft, setPhotoDraft] = useState<{ base64: string; type: string } | null>(null);
	const fileRef = useRef<HTMLInputElement | null>(null);

	const load = async () => {
		try {
			const r = await api.get<{ communities: CommunityCard[] }>(
				"/api/communities?action=list",
			);
			setCommunities(r.communities);
			setError("");
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Failed to load communities");
		}
	};

	useEffect(() => {
		void load();
		const iv = setInterval(() => void load(), 30000);
		const onVis = () => !document.hidden && void load();
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(iv);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, []);

	const adminOp = async (slug: string, op: "hide" | "unhide" | "delete") => {
		setBusy(slug);
		try {
			await api.post("/api/communities", { action: "admin", slug, op });
			toast(
				op === "delete" ? "Community deleted" : op === "hide" ? "Community hidden" : "Community restored",
				"ok",
			);
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed", "err");
		} finally {
			setBusy(null);
		}
	};

	const create = async () => {
		if (name.trim().length < 2) {
			toast("Community name must be at least 2 characters", "err");
			return;
		}
		setBusy("create");
		try {
			// Upload the photo first (server storage, data-URL fallback), then create.
			let photoUrl = "";
			if (photoDraft) {
				photoUrl = await api.uploadImage(photoDraft.base64, photoDraft.type, anonId);
			}
			await api.post("/api/communities", {
				action: "create",
				name: name.trim(),
				description: description.trim(),
				avatar,
				photo: photoUrl,
				anon_id: anonId,
			});
			toast("Community created 🎉", "ok");
			setCreateOpen(false);
			setName("");
			setDescription("");
			setAvatar("🌐");
			setPhoto("");
			setPhotoDraft(null);
			await load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to create community", "err");
		} finally {
			setBusy(null);
		}
	};

	const pickPhoto = (f: File) => {
		if (f.size > 3 * 1024 * 1024) {
			toast("Photo must be under 3 MB", "err");
			return;
		}
		if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) {
			toast("Only PNG, JPG, GIF or WebP images", "err");
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			setPhotoDraft({ base64: result.split(",")[1] ?? "", type: f.type });
			setPhoto(result);
		};
		reader.readAsDataURL(f);
	};

	return (
		<div className="max-w-5xl mx-auto px-4 py-8 vb-page-enter">
			<div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
				<div>
					<h1 className="font-display font-bold text-xl">Communities</h1>
					<p className="text-sm text-ink3 mt-0.5">
						Groups with their own discussion feeds — create one or join the conversation.
					</p>
				</div>
				<button
					className="btn btn-primary !py-2 !px-4 !text-sm"
					onClick={() => setCreateOpen(true)}
				>
					<Plus size={15} /> New community
				</button>
			</div>

			{error && (
				<div className="p-4 rounded-xl border border-bad/30 bg-bad/5 text-sm text-bad mb-4">
					{error}
				</div>
			)}

			{communities === null ? (
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{[0, 1, 2].map((i) => (
						<div key={i} className="card p-5 animate-pulse bg-surface2/60">
							<div className="h-4 w-1/3 rounded bg-surface3 mb-3" />
							<div className="h-3 w-3/4 rounded bg-surface3" />
						</div>
					))}
				</div>
			) : communities.length === 0 ? (
				<div className="card p-10 text-center">
					<div className="text-4xl mb-3">🌐</div>
					<h2 className="font-display font-semibold text-lg text-ink">No communities yet</h2>
					<p className="text-sm text-ink3 mt-1 mb-4">
						Be the first — create a group around any topic you care about.
					</p>
					<button
						className="btn btn-primary !text-sm"
						onClick={() => setCreateOpen(true)}
					>
						<Plus size={15} /> Create your community
					</button>
				</div>
			) : (
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{communities.map((c) => (
						<div key={c.slug} className="card p-5 flex flex-col hover:shadow-md transition-shadow">
							<div className="flex items-start gap-3 mb-3">
								{c.photo ? (
									<img
										src={c.photo}
										alt={c.name}
										className="w-12 h-12 rounded-2xl object-cover flex-shrink-0 vb-avatar"
									/>
								) : (
									<div className="w-12 h-12 rounded-2xl bg-surface3 flex items-center justify-center text-2xl flex-shrink-0 vb-avatar">
										{c.avatar}
									</div>
								)}
								<div className="min-w-0">
									<Link
										to={`/communities/${c.slug}`}
										className="font-display font-semibold text-ink hover:text-accent transition-colors truncate block"
									>
										{c.name}
									</Link>
									<div className="flex items-center gap-2 text-[11px] text-ink3 mt-0.5">
										<span className="inline-flex items-center gap-1">
											<Users size={11} /> {c.member_count}
										</span>
										<span className="inline-flex items-center gap-1">
											<MessageSquare size={11} /> {c.post_count}
										</span>
									</div>
								</div>
							</div>
							<p className="text-xs text-ink2 leading-relaxed line-clamp-2 flex-1 mb-3">
								{c.description || "No description yet."}
							</p>
							<div className="flex items-center gap-2">
								<Link
									to={`/communities/${c.slug}`}
									className="btn btn-primary !text-xs !py-1.5 !px-3 flex-1"
								>
									Open
								</Link>
								{isAdmin && (
									<>
										<button
											className="btn btn-ghost !text-xs !p-1.5"
											title={c.hidden ? "Unhide" : "Hide"}
											onClick={() => adminOp(c.slug, c.hidden ? "unhide" : "hide")}
										>
											{c.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
										</button>
										<button
											className="btn btn-ghost !text-xs !p-1.5 !text-bad"
											title="Delete community"
											onClick={() => {
												if (confirm(`Delete "${c.name}"? This removes all its discussions.`))
													void adminOp(c.slug, "delete");
											}}
										>
											<Trash2 size={14} />
										</button>
									</>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Create dialog */}
			<Modal
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				title="Create a community"
				footer={
					<div className="flex gap-2 justify-end">
						<button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
							Cancel
						</button>
						<button
							className="btn btn-primary"
							disabled={busy === "create"}
							onClick={() => void create()}
						>
							{busy === "create" ? "Creating…" : "Create community"}
						</button>
					</div>
				}
			>
				<div className="space-y-4">
					<div>
						<label htmlFor="cm-name" className="text-xs font-medium text-ink3 block mb-1">
							Name
						</label>
						<input
							id="cm-name"
							className="input !py-2 !text-sm w-full"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Study Gang"
							maxLength={40}
							autoFocus
						/>
					</div>
					<div>
						<label htmlFor="cm-desc" className="text-xs font-medium text-ink3 block mb-1">
							Description (optional)
						</label>
						<textarea
							id="cm-desc"
							className="input !py-2 !text-sm w-full min-h-16 resize-none"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What is this community about?"
							maxLength={240}
						/>
					</div>
					<div>
						<label className="text-xs font-medium text-ink3 block mb-1">
							Profile photo (optional)
						</label>
						<input
							ref={fileRef}
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							className="hidden"
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) pickPhoto(f);
							}}
						/>
						<div className="flex items-center gap-3">
							{photo ? (
								<img
									src={photo}
									alt="Community preview"
									className="w-16 h-16 rounded-2xl object-cover"
								/>
							) : (
								<div className="w-16 h-16 rounded-2xl bg-surface3 flex items-center justify-center text-2xl">
									{avatar}
								</div>
							)}
							<div className="flex flex-col gap-1.5">
								<button
									type="button"
									className="btn btn-ghost !text-xs !py-1.5 !px-3"
									onClick={() => fileRef.current?.click()}
								>
									{photo ? "Change photo" : "Upload photo"}
								</button>
								{photo && (
									<button
										type="button"
										className="btn btn-ghost !text-xs !py-1 !px-3 !text-bad"
										onClick={() => {
											setPhoto("");
											setPhotoDraft(null);
										}}
									>
										Remove
									</button>
								)}
							</div>
						</div>
					</div>
					<div>
						<label className="text-xs font-medium text-ink3 block mb-1">Avatar</label>
						<div className="flex flex-wrap gap-1.5">
							{AVATAR_CHOICES.map((e) => (
								<button
									key={e}
									onClick={() => setAvatar(e)}
									aria-label={`Avatar ${e}`}
									className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-all ${
										avatar === e ? "bg-accent/20 ring-1 ring-accent" : "bg-surface3 hover:bg-surface2"
									}`}
								>
									{e}
								</button>
							))}
						</div>
					</div>
					<p className="text-[11px] text-ink3">
						You'll appear as {displayName.trim() ? `“${displayName.trim()}”` : "your anonymous ID"} and become the community's creator.
					</p>
				</div>
			</Modal>
		</div>
	);
}
