/** Ten practical admin intelligence features. Every card runs a real backend
 *  action and renders the actual returned data — no static examples. */
import { useState } from "react";
import { api } from "../../lib/api";

type Feature = {
	id: string;
	title: string;
	description: string;
	fields?: Array<{ name: string; label: string; placeholder: string }>;
};

const FEATURES: Feature[] = [
	{ id: "duplicates", title: "Duplicate clusters", description: "Group near-identical complaints reported by different students.", fields: [{ name: "days", label: "Window (days)", placeholder: "30" }] },
	{ id: "priorities", title: "Priority scoring", description: "Rank open issues with the real reasons behind each score.", fields: [{ name: "days", label: "Window (days)", placeholder: "30" }] },
	{ id: "moderation", title: "Moderation triage", description: "Review a reported post against its actual reasons. Never auto-hides.", fields: [{ name: "post_id", label: "Post ID", placeholder: "post id" }] },
	{ id: "reply_draft", title: "Reply drafts", description: "Draft an official reply grounded in the post and its reports. Draft only.", fields: [{ name: "post_id", label: "Post ID", placeholder: "post id" }] },
	{ id: "briefing", title: "Daily briefing", description: "Real new posts, unresolved items and safety signals, verified before display." },
	{ id: "trends", title: "Trend alerts", description: "Category spikes over 7 days compared with the previous 7 days." },
	{ id: "search", title: "Smart search", description: "Expand the query with the model, then search live posts.", fields: [{ name: "query", label: "Search", placeholder: "hostel water" }] },
	{ id: "summary", title: "Thread summary", description: "Summarise a long comment thread into key facts.", fields: [{ name: "post_id", label: "Post ID", placeholder: "post id" }] },
	{ id: "student_status", title: "Student status", description: "Plain-language explanation of a post's live status.", fields: [{ name: "post_id", label: "Post ID", placeholder: "post id" }] },
	{ id: "quota", title: "Provider watchdog", description: "Live view of configured models and availability warnings." },
];

export default function SmartFeatures() {
	const [active, setActive] = useState<Record<string, Record<string, string>>>({});
	const [result, setResult] = useState<Record<string, unknown> | null>(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState("");

	async function run(feature: Feature) {
		setLoading(feature.id);
		setError("");
		setResult(null);
		try {
			const values = active[feature.id] || {};
			const payload: Record<string, unknown> = { action: feature.id };
			for (const f of feature.fields || [])
				if (values[f.name]) payload[f.name] = values[f.name];
			const response = await api.post<Record<string, unknown>>("/api/smart", payload);
			if (response?.error) throw new Error(String(response.error));
			setResult(response);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Feature failed");
		} finally {
			setLoading("");
		}
	}

	return (
		<div className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full space-y-4">
			<header className="mb-2">
				<h1 className="font-display text-2xl font-bold text-ink">Smart features</h1>
				<p className="text-sm text-ink3 mt-1">
					Ten practical tools backed by live platform data. Each result below is what the backend actually returned.
				</p>
			</header>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
				{FEATURES.map((f) => (
					<section key={f.id} className="card p-4 flex flex-col gap-3">
						<div>
							<h2 className="text-sm font-bold text-ink">{f.title}</h2>
							<p className="text-xs text-ink3 mt-1 leading-relaxed">{f.description}</p>
						</div>
						{(f.fields || []).map((field) => (
							<label key={field.name} className="text-[11px] text-ink3">
								{field.label}
								<input
									className="input mt-1 w-full !py-1.5 !text-xs"
									placeholder={field.placeholder}
									value={active[f.id]?.[field.name] || ""}
									onChange={(e) =>
										setActive((prev) => ({
											...prev,
											[f.id]: { ...(prev[f.id] || {}), [field.name]: e.target.value },
										}))
									}
								/>
							</label>
						))}
						<button
							type="button"
							className="btn btn-primary !text-xs !py-1.5 self-start"
							onClick={() => void run(f)}
							disabled={loading === f.id}
						>
							{loading === f.id ? "Running…" : "Run"}
						</button>
					</section>
				))}
			</div>

			{error && (
				<div className="card p-4 border border-bad/30 text-bad text-sm" role="alert">
					{error}. Nothing was changed.
				</div>
			)}
			{result && (
				<div className="card p-4">
					<h2 className="text-sm font-bold text-ink mb-2">Live result</h2>
					<pre className="text-[11px] leading-relaxed overflow-auto max-h-[420px] text-ink2 whitespace-pre-wrap">
						{JSON.stringify(result, null, 2)}
					</pre>
				</div>
			)}
		</div>
	);
}
