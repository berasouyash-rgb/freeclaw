import {
	ArrowLeft,
	Check,
	Copy,
	EyeOff,
	Fingerprint,
	KeyRound,
	Lock,
	Server,
	ShieldCheck,
	Smartphone,
	Trash2,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
	DataFlowDiagram,
	StaticFooter,
	ThreatDefenseDiagram,
} from "../components/visual/PolicyVisuals";
import { useApp } from "../contexts/AppContext";
import { storageWhere } from "../lib/platform";
import {
	CACHE_CLEAR_COPY,
	CONTACT_PRIVACY_COPY,
	INFRASTRUCTURE_COPY,
	LOCAL_PROFILE_COPY,
	NOTIFY_PRIVACY_COPY,
	PERFORMANCE_COPY,
	RETENTION_COPY,
	SERVER_PII_COPY,
	ZERO_SIGNUP_COPY,
} from "../lib/privacyCopy";

export default function Privacy() {
	const { anonId } = useApp();
	const nav = useNavigate();
	const [copied, setCopied] = useState(false);
	const [activeCategory, setActiveCategory] = useState<string>("all");

	// Deep links land here with no history to go back to — fall home
	// instead of a dead button (same contract as Terms/Accessibility).
	const goBack = () => {
		if (window.history.length > 1) nav(-1);
		else nav("/");
	};

	const copyId = async () => {
		try {
			await navigator.clipboard.writeText(anonId);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* clipboard unavailable */
		}
	};

	const ITEMS = [
		{
			id: "zero-login",
			category: "core",
			icon: ShieldCheck,
			title: "Zero-Login & Per-Device Architecture",
			body: ZERO_SIGNUP_COPY,
			tag: "Fundamental Protection",
			guarantee: "No user accounts, emails, or phone numbers ever required.",
		},
		{
			id: "server-data",
			category: "server",
			icon: Server,
			title: "Public content and server-side data",
			body: SERVER_PII_COPY,
			tag: "Encrypted Storage",
			guarantee: "Submissions stripped of client metadata before database entry.",
		},
		{
			id: "retention",
			category: "retention",
			icon: Trash2,
			title: "Retention and automatic deletion",
			body: RETENTION_COPY,
			tag: "Auto-Purge Engine",
			guarantee: "Automated 5d / 14d / 30d cleanup sweeps erase inactive data.",
		},
		{
			id: "profile",
			category: "core",
			icon: KeyRound,
			title: "On-device profile data",
			body: LOCAL_PROFILE_COPY,
			tag: "Client-Only Storage",
			guarantee: "Stored in your physical browser; never synchronised across accounts.",
		},
		{
			id: "infrastructure",
			category: "infra",
			icon: Fingerprint,
			title: "Infrastructure and request metadata",
			body: INFRASTRUCTURE_COPY,
			tag: "No IP Tracking",
			guarantee: "No application-level IP logging or advertising cookies.",
		},
		{
			id: "cache",
			category: "infra",
			icon: Smartphone,
			title: "Clearing your browser cache",
			body: CACHE_CLEAR_COPY,
			tag: "Device Safety",
			guarantee: "Clearing cache preserves your anonymous posts and voting record.",
		},
		{
			id: "optional-alerts",
			category: "server",
			icon: Lock,
			title: "Optional alert contacts",
			body: NOTIFY_PRIVACY_COPY,
			tag: "Strictly Opt-In",
			guarantee: "Overwrite or erase your alert contacts anytime in Settings.",
		},
		{
			id: "contact-form",
			category: "server",
			icon: EyeOff,
			title: "Contact-form submissions",
			body: CONTACT_PRIVACY_COPY,
			tag: "Direct Support",
			guarantee: "Routed through moderation pipeline with zero tracking cookies.",
		},
	];

	const CATEGORIES = [
		{ id: "all", label: "All Protections", count: ITEMS.length },
		{ id: "core", label: "Zero-Knowledge Core", count: ITEMS.filter((i) => i.category === "core").length },
		{ id: "server", label: "Server & Retention", count: ITEMS.filter((i) => i.category === "server" || i.category === "retention").length },
		{ id: "infra", label: "Infrastructure Defense", count: ITEMS.filter((i) => i.category === "infra").length },
	];

	const filteredItems = ITEMS.filter((item) => {
		if (activeCategory === "all") return true;
		if (activeCategory === "server") return item.category === "server" || item.category === "retention";
		return item.category === activeCategory;
	});

	return (
		<div className="max-w-4xl mx-auto px-4 py-6">
			{/* Back Button */}
			<button
				type="button"
				className="btn btn-ghost !px-3 mb-6"
				onClick={goBack}
				aria-label="Go back"
			>
				<ArrowLeft size={15} /> Back
			</button>

			{/* Hero Header */}
			<div className="text-center mb-10 vb-rise">
				<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-good/10 text-good border border-good/20 text-xs font-semibold mb-4">
					<ShieldCheck size={14} /> Zero-Knowledge Privacy Architecture
				</div>
				<h1 className="font-display font-bold text-3xl sm:text-4xl text-ink">
					Privacy comes first
				</h1>
				<p className="text-sm sm:text-base text-ink3 mt-3 max-w-xl mx-auto leading-relaxed">
					Voice Flow was engineered from the ground up so that honest student feedback
					carries zero risk of retaliation. Here is our mathematical and technical guarantee.
				</p>
			</div>

			{/* Anonymity ID Vault Card */}
			<div className="card p-5 sm:p-6 mb-8 border border-accent/25 bg-surface/90 shadow-sm relative overflow-hidden vb-rise">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div className="flex items-center gap-3.5">
						<span className="w-12 h-12 rounded-2xl bg-accent-soft text-accent grid place-items-center shrink-0">
							<Fingerprint size={24} />
						</span>
						<div>
							<div className="flex items-center gap-2">
								<span className="text-xs font-bold uppercase tracking-wider text-accent">
									Active Anonymous Key
								</span>
								<span className="w-2 h-2 rounded-full bg-good animate-pulse" />
							</div>
							<p className="text-xs text-ink3 mt-0.5">
								Stored exclusively in your physical device ({storageWhere()}).
							</p>
							<code className="text-sm sm:text-base font-mono font-bold text-accent mt-1 block">
								{anonId || "anon_isolated_hardware_key"}
							</code>
						</div>
					</div>

					<button
						type="button"
						onClick={copyId}
						className="btn btn-ghost !text-xs self-start sm:self-center border border-border"
						aria-label="Copy anonymous ID"
					>
						{copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
						{copied ? "Copied" : "Copy ID"}
					</button>
				</div>
			</div>

			{/* Interactive Visual Explanation: Data Flow */}
			<div className="mb-10 vb-rise">
				<DataFlowDiagram />
			</div>

			{/* Comparison Matrix: Big Tech vs Voice Flow */}
			<div className="card p-5 sm:p-7 mb-10 border border-border/80 bg-surface/70 vb-rise">
				<div className="mb-5 pb-3 border-b border-border">
					<h3 className="font-display font-bold text-base text-ink">
						Architectural Privacy Comparison
					</h3>
					<p className="text-xs text-ink3">
						Why traditional feedback tools fail student safety vs Voice Flow.
					</p>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-xs text-left" role="table">
						<thead>
							<tr className="border-b border-border/60 text-ink3 font-semibold uppercase tracking-wider text-[10px]">
								<th className="py-2.5 px-3">Dimension</th>
								<th className="py-2.5 px-3 text-bad">Traditional School Forms</th>
								<th className="py-2.5 px-3 text-good">Voice Flow Architecture</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border/40 text-ink2">
							<tr>
								<td className="py-3 px-3 font-semibold text-ink">Identity Model</td>
								<td className="py-3 px-3">Requires school email, Google account, or name</td>
								<td className="py-3 px-3 font-semibold text-good">100% Zero-Signup hardware entropy</td>
							</tr>
							<tr>
								<td className="py-3 px-3 font-semibold text-ink">IP Address Logging</td>
								<td className="py-3 px-3">Logged on every form submit; traced by IT admins</td>
								<td className="py-3 px-3 font-semibold text-good">Zero application IP logs; discarded in memory</td>
							</tr>
							<tr>
								<td className="py-3 px-3 font-semibold text-ink">Retaliation Defense</td>
								<td className="py-3 px-3">Admins can trace submission back to student</td>
								<td className="py-3 px-3 font-semibold text-good">Mathematically impossible to reverse ID</td>
							</tr>
							<tr>
								<td className="py-3 px-3 font-semibold text-ink">Data Retention</td>
								<td className="py-3 px-3">Stored indefinitely in centralized spreadsheets</td>
								<td className="py-3 px-3 font-semibold text-good">Automated 5d/14d/30d deletion cycles</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			{/* Category Filter Pills */}
			<div className="flex flex-wrap items-center gap-2 mb-6">
				{CATEGORIES.map((cat) => (
					<button
						key={cat.id}
						type="button"
						onClick={() => setActiveCategory(cat.id)}
						className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
							activeCategory === cat.id
								? "bg-accent text-white shadow-sm font-semibold"
								: "bg-surface2 text-ink2 hover:bg-surface3"
						}`}
						aria-pressed={activeCategory === cat.id}
					>
						{cat.label} ({cat.count})
					</button>
				))}
			</div>

			{/* Policy Detail Cards */}
			<div className="space-y-4 mb-10">
				{filteredItems.map(({ icon: Icon, title, body, tag, guarantee }, i) => (
					<div
						key={title}
						className="card p-5 sm:p-6 border border-border/70 hover:border-accent/40 transition-all duration-200 vb-rise"
						style={{ animationDelay: `${i * 40}ms` }}
					>
						<div className="flex items-start gap-4">
							<span className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0 mt-0.5">
								<Icon size={20} />
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
									<h2 className="font-display font-semibold text-base text-ink">
										{title}
									</h2>
									<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface2 text-ink3 border border-border">
										{tag}
									</span>
								</div>
								<p className="text-sm text-ink2 leading-relaxed">{body}</p>
								<div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-1.5 text-xs text-ink3">
									<Check size={13} className="text-good shrink-0" />
									<span>
										<strong className="text-ink font-semibold">Technical Guarantee: </strong>
										{guarantee}
									</span>
								</div>
							</div>
						</div>
					</div>
				))}
			</div>

			{/* 24/7 Autonomous Threat Defense Guard */}
			<div className="mb-10">
				<ThreatDefenseDiagram />
			</div>

			{/* Performance Copy Card */}
			<div className="card p-5 mb-8 bg-surface2/50 border border-border">
				<div className="flex items-center gap-2 mb-1 text-xs font-semibold text-accent">
					<Zap size={14} /> Sub-300ms Platform Speed SLA
				</div>
				<p className="text-xs text-ink2 leading-relaxed">
					{PERFORMANCE_COPY}
				</p>
			</div>

			{/* Keyboard Shortcuts Helper */}
			<p className="text-center text-[11px] text-ink3 mb-8">
				Keyboard shortcuts: <kbd className="chip !text-[10px]">n</kbd> new post •{" "}
				<kbd className="chip !text-[10px]">g</kbd> feed •{" "}
				<kbd className="chip !text-[10px]">a</kbd> activity •{" "}
				<kbd className="chip !text-[10px]">t</kbd> theme •{" "}
				<kbd className="chip !text-[10px]">/</kbd> search
			</p>

			{/* Universal Static Footer */}
			<StaticFooter />
		</div>
	);
}
