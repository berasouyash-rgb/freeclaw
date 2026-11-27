import {
	ArrowLeft,
	Check,
	CheckCircle,
	Scale,
	Search,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import FadeIn from "../components/FadeIn";
import { CopyrightShieldDiagram, StaticFooter } from "../components/visual/PolicyVisuals";

const SECTIONS = [
	{
		id: "acceptance",
		title: "1. Acceptance of Terms",
		plainText: "By using Voice Flow, you agree to these ground rules. They exist solely to protect your safety and keep school dialogue constructive.",
		content: `By accessing or using Voice Flow ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. These terms apply to all users, including students, administrators, and visitors.`,
	},
	{
		id: "description",
		title: "2. Description of Service",
		plainText: "Voice Flow is an anonymous feedback platform with 24/7 autonomous triage harnesses designed to resolve student concerns without social retaliation.",
		content: `Voice Flow is an anonymous feedback platform that enables students to submit concerns, suggestions, and polls to school administrators. The Service includes AI-powered analysis, emotional support features, and administrative tools. The Service is provided "as is" and may be modified or discontinued at any time.`,
	},
	{
		id: "anonymity",
		title: "3. Anonymity and Zero-Signup Model",
		plainText: "You never need to log in, provide an email, or enter a password. Your identity is a local cryptographic hardware key stored only in your physical device.",
		content: `Voice Flow operates on a strict zero-signup, zero-login model. No accounts, emails, passwords, or personal credentials are required. Each browser and physical device maintains exactly 1 persistent anonymous identity in local hardware storage. Devices can be linked securely using a single-use 6-digit code or QR code scan without creating an account or forfeiting anonymity.`,
	},
	{
		id: "conduct",
		title: "4. User Conduct & Anti-Bullying Rules",
		plainText: "Speak truth, but do not bully, harass, or dox others. Zero tolerance for personal attacks, threats, or defamation.",
		content: `Users agree to: (a) submit only genuine feedback and concerns; (b) not attempt to circumvent anonymity protections; (c) not submit content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable; (d) not impersonate others or submit false information.`,
	},
	{
		id: "ai-content",
		title: "5. AI-Generated Content & Assistance",
		plainText: "AI assists by summarizing, categorizing, and proposing complaint drafts. Final decisions are always approved by human school administrators.",
		content: `The Service uses artificial intelligence to analyze submissions, generate responses, and provide insights. AI-generated content is provided for informational purposes and should not be considered professional advice. School administrators are responsible for reviewing and approving AI-generated responses before sending.`,
	},
	{
		id: "intellectual-property",
		title: "6. Intellectual Property & Student Voice Ownership",
		plainText: "You own 100% of your voice, thoughts, and writings. Voice Flow owns its platform code, algorithms, and interface designs.",
		content: `The Service, including its original software, design system, algorithms, logos, and features, is owned by Voice Flow and protected by copyright, trademark, and intellectual property laws. Students and users retain full ownership, moral rights, and copyright of all feedback, writings, and content they submit through the Service. Voice Flow receives only a non-exclusive license to display the content anonymously for educational administration.`,
	},
	{
		id: "liability",
		title: "7. Limitation of Liability",
		plainText: "We work tirelessly to keep the platform reliable and secure, but we cannot be held financially liable for third-party service interruptions.",
		content: `To the maximum extent permitted by law, Voice Flow shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses.`,
	},
	{
		id: "disclaimer",
		title: "8. Disclaimer of Warranties",
		plainText: "The platform is provided as-is without commercial guarantees. We strive for 99.98% uptime and flawless privacy execution.",
		content: `The Service is provided "AS IS" without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or secure.`,
	},
	{
		id: "indemnification",
		title: "9. Indemnification",
		plainText: "You agree not to misuse the platform for illegal acts that cause legal damages to Voice Flow or school communities.",
		content: `You agree to indemnify, defend, and hold harmless Voice Flow, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including reasonable attorneys' fees) arising from your use of the Service or violation of these terms.`,
	},
	{
		id: "termination",
		title: "10. Termination & Abuse Suspension",
		plainText: "Repeat violators of bullying or doxxing rules will have their anonymous device keys permanently banned from posting.",
		content: `We may terminate or suspend your access to the Service immediately, without prior notice, for any reason, including breach of these terms. Upon termination, your right to use the Service ceases immediately.`,
	},
	{
		id: "governing-law",
		title: "11. Governing Law",
		plainText: "Legal matters are governed by applicable educational and privacy jurisdiction standards.",
		content: `These terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. Any disputes shall be resolved in the state or federal courts located in Delaware.`,
	},
	{
		id: "changes",
		title: "12. Changes to Terms",
		plainText: "Any updates to terms will be posted publicly with an updated revision date and transparent changelog.",
		content: `We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting. Your continued use of the Service after changes constitutes acceptance of the new terms.`,
	},
	{
		id: "contact",
		title: "13. Contact & Inquiries",
		plainText: "Have legal, copyright, or student protection questions? Reach out to our team anytime.",
		content: `For questions about these Terms or Copyright, please contact us at legal@voicebox.app or through our Contact page.`,
	},
];

export default function Terms() {
	const nav = useNavigate();
	const [viewMode, setViewMode] = useState<"both" | "plain" | "legal">("both");
	const [searchQuery, setSearchQuery] = useState("");

	// Deep links land here with no history to go back to — fall home
	const goBack = () => {
		if (window.history.length > 1) nav(-1);
		else nav("/");
	};

	const filteredSections = useMemo(() => {
		if (!searchQuery.trim()) return SECTIONS;
		const q = searchQuery.toLowerCase();
		return SECTIONS.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				s.content.toLowerCase().includes(q) ||
				s.plainText.toLowerCase().includes(q),
		);
	}, [searchQuery]);

	return (
		<div className="min-h-screen bg-bg vb-page-enter">
			{/* Hero */}
			<section className="relative overflow-hidden pt-20 pb-12 md:pt-28 md:pb-16 text-center">
				<div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent pointer-events-none" />
				<div className="relative max-w-3xl mx-auto px-6">
					<FadeIn>
						<button
							type="button"
							className="btn btn-ghost !px-3 mb-6"
							onClick={goBack}
							aria-label="Go back"
						>
							<ArrowLeft size={15} /> Back
						</button>
						<div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent bg-accent/10 rounded-full px-3 py-1.5 mb-4 border border-accent/20">
							<Scale size={13} /> The Fine Print, In Plain Words
						</div>
						<h1 className="text-4xl md:text-5xl font-display font-bold text-ink mb-4">
							Terms of Service
						</h1>
						<p className="text-sm text-ink3">
							Last updated: 2026 • Effective for all students, faculty, and administrators.
						</p>
					</FadeIn>
				</div>
			</section>

			{/* Interactive Controls & Copyright Highlight */}
			<section className="max-w-4xl mx-auto px-6 mb-8">
				<FadeIn>
					<div className="card p-5 sm:p-6 mb-8 border border-accent/20 bg-surface/80">
						<CopyrightShieldDiagram />
					</div>

					{/* Acceptable Use Visual Grid: Do's and Don'ts */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
						<div className="card p-5 border border-good/30 bg-good/[0.02]">
							<div className="flex items-center gap-2 mb-3 text-good font-semibold text-sm">
								<CheckCircle size={18} /> Permitted & Encouraged
							</div>
							<ul className="space-y-1.5 text-xs text-ink2">
								<li className="flex items-start gap-1.5">
									<Check size={13} className="text-good shrink-0 mt-0.5" />
									<span>Reporting harassment, bullying, or unfair treatment safely.</span>
								</li>
								<li className="flex items-start gap-1.5">
									<Check size={13} className="text-good shrink-0 mt-0.5" />
									<span>Suggesting school facility repairs (labs, water taps, lighting).</span>
								</li>
								<li className="flex items-start gap-1.5">
									<Check size={13} className="text-good shrink-0 mt-0.5" />
									<span>Requesting mental health or academic support anonymously.</span>
								</li>
								<li className="flex items-start gap-1.5">
									<Check size={13} className="text-good shrink-0 mt-0.5" />
									<span>Voting on school polls and voicing community opinions.</span>
								</li>
							</ul>
						</div>

						<div className="card p-5 border border-bad/30 bg-bad/[0.02]">
							<div className="flex items-center gap-2 mb-3 text-bad font-semibold text-sm">
								<XCircle size={18} /> Strictly Prohibited
							</div>
							<ul className="space-y-1.5 text-xs text-ink2">
								<li className="flex items-start gap-1.5">
									<XCircle size={13} className="text-bad shrink-0 mt-0.5" />
									<span>Targeted bullying, threats of violence, or hate speech.</span>
								</li>
								<li className="flex items-start gap-1.5">
									<XCircle size={13} className="text-bad shrink-0 mt-0.5" />
									<span>Doxxing (posting phone numbers, addresses, or private photos).</span>
								</li>
								<li className="flex items-start gap-1.5">
									<XCircle size={13} className="text-bad shrink-0 mt-0.5" />
									<span>Defamation, malicious fabrications, or impersonation.</span>
								</li>
								<li className="flex items-start gap-1.5">
									<XCircle size={13} className="text-bad shrink-0 mt-0.5" />
									<span>Attempting to reverse-engineer other students' anonymous keys.</span>
								</li>
							</ul>
						</div>
					</div>

					{/* Lens Filter and Search Bar */}
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
						{/* View Mode Toggle */}
						<div className="inline-flex p-1 rounded-xl bg-surface2 border border-border text-xs font-semibold self-start">
							<button
								type="button"
								onClick={() => setViewMode("both")}
								className={`px-3 py-1.5 rounded-lg transition-all ${
									viewMode === "both" ? "bg-surface text-ink shadow-xs" : "text-ink3 hover:text-ink"
								}`}
								aria-pressed={viewMode === "both"}
							>
								Dual View
							</button>
							<button
								type="button"
								onClick={() => setViewMode("plain")}
								className={`px-3 py-1.5 rounded-lg transition-all ${
									viewMode === "plain" ? "bg-surface text-ink shadow-xs" : "text-ink3 hover:text-ink"
								}`}
								aria-pressed={viewMode === "plain"}
							>
								Plain English Only
							</button>
							<button
								type="button"
								onClick={() => setViewMode("legal")}
								className={`px-3 py-1.5 rounded-lg transition-all ${
									viewMode === "legal" ? "bg-surface text-ink shadow-xs" : "text-ink3 hover:text-ink"
								}`}
								aria-pressed={viewMode === "legal"}
							>
								Legal Clauses
							</button>
						</div>

						{/* Search Input */}
						<div className="relative w-full sm:w-64">
							<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
							<input
								type="search"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search terms & clauses..."
								className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-surface2 border border-border text-ink focus:outline-none focus:border-accent"
								aria-label="Search terms and conditions"
							/>
						</div>
					</div>
				</FadeIn>
			</section>

			{/* Terms Sections */}
			<section className="max-w-4xl mx-auto px-6 pb-16">
				<div className="space-y-4">
					{filteredSections.map((s, i) => (
						<FadeIn key={s.id} delay={Math.min(i * 0.04, 0.3)}>
							<article className="card p-5 sm:p-6 border border-border/80 hover:border-accent/30 transition-all">
								<div className="flex items-start gap-4">
									<span
										className="shrink-0 w-8 h-8 rounded-xl bg-accent/10 text-accent font-display font-bold text-xs grid place-items-center mt-0.5"
										aria-hidden
									>
										{i + 1}
									</span>
									<div className="min-w-0 flex-1">
										<h2 className="text-base sm:text-lg font-display font-bold text-ink mb-2">
											{s.title.replace(/^\d+\.\s*/, "")}
										</h2>

										{/* Plain English Banner */}
										{(viewMode === "both" || viewMode === "plain") && (
											<div className="p-3 rounded-xl bg-accent-soft/40 border border-accent/15 mb-3 text-xs text-ink leading-relaxed">
												<span className="font-bold text-accent uppercase tracking-wider text-[10px] block mb-0.5">
													💡 In Plain English:
												</span>
												{s.plainText}
											</div>
										)}

										{/* Full Legal Text */}
										{(viewMode === "both" || viewMode === "legal") && (
											<p className="text-ink2 leading-relaxed text-xs sm:text-sm font-sans">
												{s.content}
											</p>
										)}
									</div>
								</div>
							</article>
						</FadeIn>
					))}

					{filteredSections.length === 0 && (
						<div className="card p-8 text-center border border-border">
							<p className="text-sm text-ink2">
								No clauses match "{searchQuery}". Clear your search to view all sections.
							</p>
						</div>
					)}
				</div>

				<div className="mt-12 text-center text-xs text-ink3">
					<p>
						Questions regarding these Terms or Copyright?{" "}
						<Link to="/contact" className="text-accent font-semibold hover:underline">
							Contact our legal team
						</Link>
					</p>
				</div>

				<StaticFooter />
			</section>
		</div>
	);
}
