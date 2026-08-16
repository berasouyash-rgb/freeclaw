// Saved — server-persisted bookmarks, one place to revisit what matters.
import { Bookmark, BookmarkX, PlusCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PostCard from "../components/PostCard";
import { useApp } from "../contexts/AppContext";
import { api } from "../lib/api";
import type { PostData } from "../types";

export default function Saved() {
	const { bookmarks, toggleBookmark, toast } = useApp();
	const [posts, setPosts] = useState<PostData[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		if (bookmarks.length === 0) {
			setPosts([]);
			setLoading(false);
			return;
		}
		try {
			setError("");
			setLoading(true);
			const data = await api.get<PostData[]>(
				`/api/posts?ids=${bookmarks.slice(0, 100).join(",")}`,
			);
			// Keep server order aligned to the bookmark list order
			const byId = new Map(data.map((p) => [p.id, p]));
			setPosts(
				bookmarks
					.map((b) => byId.get(b))
					.filter((p): p is PostData => Boolean(p)),
			);
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not load saved posts");
		}
		setLoading(false);
	}, [bookmarks]);

	useEffect(() => {
		load();
	}, [load]);

	const remove = (id: string) => {
		toggleBookmark(id);
		toast("Removed from saved", "ok");
	};

	return (
		<div className="max-w-3xl mx-auto px-4 py-6 vb-page-enter">
			<div className="flex items-center gap-2.5 mb-5">
				<span className="vb-empty-icon !w-9 !h-9">
					<Bookmark size={17} />
				</span>
				<div>
					<h1 className="font-display font-bold text-xl sm:text-2xl leading-tight">
						Saved posts
					</h1>
					<p className="text-xs text-ink3">
						{bookmarks.length} saved · revisit what matters
					</p>
				</div>
			</div>

			{error && (
				<div className="card p-6 text-center">
					<p className="text-bad font-medium text-sm">{error}</p>
					<button
						className="btn btn-soft mt-3"
						onClick={() => {
							setLoading(true);
							load();
						}}
					>
						Retry
					</button>
				</div>
			)}

			{loading && (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-32" />
					))}
				</div>
			)}

			{!loading && !error && bookmarks.length === 0 && (
				<div className="card p-10 text-center vb-rise">
					<div className="vb-empty-icon">
						<BookmarkX size={28} />
					</div>
					<p className="font-display font-semibold">Nothing saved yet</p>
					<p className="text-sm text-ink3 mt-1">
						Tap the bookmark on any post to keep it here.
					</p>
					<Link to="/" className="btn btn-primary mt-4 inline-flex">
						<PlusCircle size={15} /> Browse the feed
					</Link>
				</div>
			)}

			{!loading && !error && bookmarks.length > 0 && posts.length === 0 && (
				<div className="card p-8 text-center">
					<p className="text-sm text-ink3">
						Saved posts are loading or have been removed.
					</p>
					<button className="btn btn-soft mt-3" onClick={() => load()}>
						Refresh
					</button>
				</div>
			)}

			<div className="space-y-3">
				{posts.map((p) => (
					<div key={p.id}>
						<PostCard post={p} onReacted={() => load()} />
						<div className="flex justify-end mt-1">
							<button
								className="text-xs font-semibold text-ink3 hover:text-bad inline-flex items-center gap-1 px-2 py-1"
								onClick={() => remove(p.id)}
								aria-label={`Remove ${p.title} from saved`}
							>
								<BookmarkX size={13} /> Remove
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
