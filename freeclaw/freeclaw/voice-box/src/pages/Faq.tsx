import {
	ArrowRight,
	ChevronDown,
	HelpCircle,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
	DataFlowDiagram,
	SolvingPipelineDiagram,
	StaticFooter,
} from "../components/visual/PolicyVisuals";

const FAQS = [
	{
		q: "Is Voice Flow really anonymous?",
		a: "Yes. There is no registration, and we never ask for names, emails, or phone numbers. We don’t log IP addresses against posts or use tracking scripts. Your only identifier is a random ID generated in your own browser using cryptographic hardware entropy.",
		category: "anonymity",
	},
	{
		q: "Can teachers or admins find out who posted?",
		a: "No. Admins only ever see the random anonymous ID (like “anon_x7k2…”). There is no technical link between that ID and your real identity — it exists only in your browser’s local storage and cannot be traced backwards.",
		category: "anonymity",
	},
	{
		q: "How do I delete something I posted?",
		a: "Open the post (or go to My Activity) and tap the delete button. You get a 30-second undo window. Because ownership lives strictly in your browser's private hardware key, only you have the cryptographic authority to delete your own content.",
		category: "posting",
	},
	{
		q: "What happens after I report a problem?",
		a: "Admins review it and move it through the pipeline: Reported → Verified → In Progress → Waiting → Solved. You can follow every step with timestamps on the public Solving Board, and you’ll get a notification when the status changes.",
		category: "posting",
	},
	{
		q: "Why was my post hidden or removed?",
		a: "Content that breaks the rules (bullying, spam, personal attacks, naming individuals) may be hidden by moderators. Repeated misuse can lead to your anonymous ID being suspended — but no personal data is ever involved or leaked.",
		category: "posting",
	},
	{
		q: "What if I clear my browser data or switch devices?",
		a: "Your anonymous ID lives only in this browser. Clearing site data or switching devices creates a fresh identity — your old posts stay public but can no longer be edited or deleted by you. You can export your activity first from My Activity or link devices with a 6-digit code.",
		category: "technical",
	},
	{
		q: "How does voting work?",
		a: "Each anonymous ID can support a post once, and there is no downvote — if a post is wrong or harmful, report it instead. Vote once per poll (you can change your poll vote while it’s open). Votes are counted anonymously.",
		category: "community",
	},
	{
		q: "Who runs the AI features?",
		a: "AI summaries and analysis run on our server — your posts are processed to cluster duplicates and rank urgency, but no identity data exists to share. AI suggestions to admins are drafts only; a human administrator must approve every action.",
		category: "ai",
	},
];

// FAQPage structured data — derived from FAQS so the JSON-LD always matches
// the visible Q&A verbatim (schema.org requires it, and it is what lets AI
// answer engines cite the page).
const FAQ_SCHEMA = JSON.stringify({
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: FAQS.map((f) => ({
		"@type": "Question",
		name: f.q,
		acceptedAnswer: { "@type": "Answer", text: f.a },
	})),
});

export default function Faq() {
	const [open, setOpen] = useState<number | null>(0);
	const [search, setSearch] = useState("");
	const [activeCategory, setActiveCategory] = useState<string>("all");
	const [showVisual, setShowVisual] = useState<boolean>(false);

	const CATEGORIES = [
		{ id: "all", label: "All Questions" },
		{ id: "anonymity", label: "Anonymity & Safety" },
		{ id: "posting", label: "Posting & Deleting" },
		{ id: "ai", label: "AI & Automation" },
		{ id: "community", label: "Voting & Board" },
		{ id: "technical", label: "Devices & Cache" },
	];

	const filtered = useMemo(() => {
		let list = FAQS.map((f, i) => ({ ...f, idx: i }));
		if (activeCategory !== "all") {
			list = list.filter((f) => f.category === activeCategory);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q),
			);
		}
		return list;
	}, [search, activeCategory]);

	return (
		<div className="max-w-4xl mx-auto px-4 py-8">
			{/* Schema.org JSON-LD */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: FAQ_SCHEMA }}
			/>

			{/* Hero */}
			<div className="text-center mb-10 vb-rise">
				<span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent mb-4 shadow-xs">
					<HelpCircle size={28} />
				</span>
				<h1 className="font-display font-bold text-3xl sm:text-4xl text-ink">
					Frequently asked questions
				</h1>
				<p className="text-sm sm:text-base text-ink3 mt-2 max-w-lg mx-auto">
					Everything you need to know about staying anonymous, submitting feedback,
					and driving real school improvements.
				</p>
			</div>

			{/* Search & Filter Bar */}
			<div className="card p-4 sm:p-5 mb-8 border border-border/80 bg-surface shadow-xs">
				<div className="relative mb-4">
					<Search
						size={16}
						className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3"
					/>
					<input
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search questions or keywords (e.g., 'delete', 'anonymous', 'voting')..."
						className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-surface2 border border-border text-sm text-ink placeholder:text-ink3 focus:outline-none focus:border-accent"
						aria-label="Search frequently asked questions"
					/>
					{search && (
						<button
							type="button"
							onClick={() => setSearch("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink p-1"
							aria-label="Clear search"
						>
							<X size={14} />
						</button>
					)}
				</div>

				{/* Category Pills */}
				<div className="flex flex-wrap items-center gap-1.5">
					{CATEGORIES.map((cat) => (
						<button
							key={cat.id}
							type="button"
							onClick={() => setActiveCategory(cat.id)}
							className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
								activeCategory === cat.id
									? "bg-accent text-white shadow-xs font-semibold"
									: "bg-surface2 text-ink2 hover:bg-surface3"
							}`}
							aria-pressed={activeCategory === cat.id}
						>
							{cat.label}
						</button>
					))}
				</div>
			</div>

			{/* Interactive Visual Explanations Banner */}
			<div className="mb-8">
				<div className="card p-5 border border-accent/20 bg-accent-soft/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div>
						<span className="text-xs font-bold uppercase tracking-wider text-accent flex items-center gap-1.5 mb-1">
							<Sparkles size={13} /> Visual Architecture Explanations
						</span>
						<h3 className="font-display font-bold text-base text-ink">
							Curious how Zero-Knowledge and the Solving Pipeline work?
						</h3>
						<p className="text-xs text-ink2 mt-0.5">
							Toggle our interactive diagrams to see the mathematical privacy flow.
						</p>
					</div>
					<button
						type="button"
						onClick={() => setShowVisual(!showVisual)}
						className="btn btn-primary !text-xs self-start sm:self-center px-4 py-2"
					>
						{showVisual ? "Hide Diagram" : "Explore Visual Flow"}
					</button>
				</div>

				{showVisual && (
					<div className="mt-4 space-y-6 vb-rise">
						<DataFlowDiagram />
						<SolvingPipelineDiagram />
					</div>
				)}
			</div>

			{/* Accordion List */}
			<div className="space-y-3 mb-12">
				{filtered.map(({ q, a, idx }) => {
					const isOpen = open === idx;
					return (
						<div
							key={q}
							className={`card border transition-all duration-200 overflow-hidden ${
								isOpen
									? "border-accent/40 bg-surface shadow-xs"
									: "border-border/80 bg-surface/80 hover:border-accent/20"
							}`}
						>
							<button
								type="button"
								onClick={() => setOpen(isOpen ? null : idx)}
								className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4"
								aria-expanded={isOpen}
								aria-controls={`faq-answer-${idx}`}
							>
								<span className="font-display font-semibold text-sm sm:text-base text-ink">
									{q}
								</span>
								<span
									className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 transition-transform duration-200 ${
										isOpen
											? "rotate-180 bg-accent text-white"
											: "bg-surface2 text-ink3"
									}`}
								>
									<ChevronDown size={16} />
								</span>
							</button>

							{isOpen && (
								<div
									id={`faq-answer-${idx}`}
									className="px-4 pb-5 sm:px-5 sm:pb-5 text-xs sm:text-sm text-ink2 leading-relaxed border-t border-border/40 pt-3 vb-rise"
								>
									<p>{a}</p>
								</div>
							)}
						</div>
					);
				})}

				{filtered.length === 0 && (
					<div className="card p-8 text-center border border-border">
						<HelpCircle size={32} className="mx-auto text-ink3 mb-2" />
						<p className="font-semibold text-sm text-ink">No questions found</p>
						<p className="text-xs text-ink3 mt-1">
							Try adjusting your keywords or clearing the category filter.
						</p>
					</div>
				)}
			</div>

			{/* Still have questions CTA */}
			<div className="card p-6 sm:p-8 text-center border border-border/80 bg-surface2/40">
				<h3 className="font-display font-bold text-base sm:text-lg text-ink mb-1.5">
					Have a question not listed here?
				</h3>
				<p className="text-xs sm:text-sm text-ink2 max-w-md mx-auto mb-5">
					Reach out directly to our platform support team or counseling advisors.
					All contact submissions remain completely confidential.
				</p>
				<Link
					to="/contact"
					className="btn btn-primary !text-xs px-6 py-2.5 inline-flex items-center gap-2"
				>
					Contact Support Team
					<ArrowRight size={14} />
				</Link>
			</div>

			<StaticFooter />
		</div>
	);
}
