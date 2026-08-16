import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { CAT_EMOJI, CATEGORIES } from "../../lib/utils";

// Admin categories manager: view, add, remove, and reset the category list.
// Persisted server-side via PUT /api/categories (admin token required).
export default function Categories() {
	const { toast } = useApp();
	const [cats, setCats] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [name, setName] = useState("");

	const load = useCallback(async () => {
		try {
			setLoading(true);
			const d = await api.get<{ categories: string[] }>("/api/categories");
			setCats(
				(d?.categories || []).filter((c): c is string => typeof c === "string"),
			);
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Could not load categories",
				"err",
			);
		}
		setLoading(false);
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	const save = async (next: string[]) => {
		if (next.length < 3) {
			toast("At least 3 categories are required", "err");
			return;
		}
		try {
			setSaving(true);
			const d = await api.put<{ categories: string[] }>("/api/categories", {
				categories: next,
			});
			setCats(
				(d?.categories || next).filter(
					(c): c is string => typeof c === "string",
				),
			);
			toast("Categories saved", "ok");
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Could not save categories",
				"err",
			);
		}
		setSaving(false);
	};

	const add = () => {
		const n = name.trim();
		if (!n) return;
		if (cats.some((c) => c.toLowerCase() === n.toLowerCase())) {
			toast("Category already exists", "err");
			return;
		}
		setName("");
		save([...cats, n]);
	};

	const remove = (cat: string) => save(cats.filter((c) => c !== cat));
	const reset = () => save([...CATEGORIES]);

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<h1 className="font-display font-bold text-xl">Categories</h1>
				<span className="text-xs text-ink3">{cats.length} active</span>
			</div>

			<div className="flex gap-2 mb-4">
				<input
					className="input flex-1 !py-2 text-sm"
					placeholder="Category name…"
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") add();
					}}
					maxLength={24}
				/>
				<button
					className="btn btn-primary !py-2 !px-4 text-sm"
					onClick={add}
					disabled={saving || !name.trim()}
				>
					{saving ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Plus size={14} />
					)}{" "}
					Add
				</button>
			</div>

			<p className="text-xs text-ink3 mb-3">
				These categories are used across the site for posts, filters, and
				insights. Changing the list affects every form immediately.
			</p>

			{loading ? (
				<div className="space-y-2">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="skeleton h-10" />
					))}
				</div>
			) : (
				<div className="grid grid-cols-2 md:grid-cols-3 gap-2">
					{cats.map((c) => (
						<div
							key={c}
							className="card !p-3 flex items-center justify-between gap-2"
						>
							<span className="text-sm font-medium truncate">
								{CAT_EMOJI[c]} {c}
							</span>
							<button
								className="btn btn-ghost !p-1.5 !rounded-lg shrink-0"
								aria-label={`Remove ${c}`}
								onClick={() => remove(c)}
								disabled={saving}
							>
								<Trash2 size={13} />
							</button>
						</div>
					))}
					{cats.length === 0 && (
						<p className="text-sm text-ink3 col-span-full py-8 text-center">
							No categories loaded.
						</p>
					)}
				</div>
			)}

			<div className="mt-4">
				<button
					className="btn btn-soft !py-2 !px-3 text-sm"
					onClick={reset}
					disabled={saving}
				>
					<RotateCcw size={13} /> Reset to defaults
				</button>
			</div>
		</div>
	);
}
