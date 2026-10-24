import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Clock,
	Mail,
	MessageSquare,
	Send,
	ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import FadeIn from "../components/FadeIn";
import { StaticFooter } from "../components/visual/PolicyVisuals";
import { api } from "../lib/api";
import { lsGet } from "../lib/identity";

export default function Contact() {
	const nav = useNavigate();
	const [form, setForm] = useState({
		name: "",
		email: "",
		subject: "",
		message: "",
	});
	const [submitted, setSubmitted] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");

	const goBack = () => {
		if (window.history.length > 1) nav(-1);
		else nav("/");
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.message.trim()) return;
		setSending(true);
		setError("");
		try {
			// Submit as a suggestion post so it enters the real moderation + review pipeline
			await api.post("/api/posts", {
				type: "suggestion",
				title: form.subject || "Contact form message",
				description: [
					form.name ? `From: ${form.name}` : null,
					form.email ? `Email: ${form.email}` : null,
					"",
					form.message,
				]
					.filter(Boolean)
					.join("\n"),
				author_id: lsGet("vb:anonId", ""),
				category: "general",
			});
			setSubmitted(true);
		} catch (err: unknown) {
			setError(
				err instanceof Error ? err.message : "Failed to send message",
			);
		} finally {
			setSending(false);
		}
	};

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
							<MessageSquare size={13} /> We'd love to hear from you
						</div>
						<h1 className="text-4xl md:text-5xl font-display font-bold text-ink mb-4">
							Contact Us & Send a Message
						</h1>
						<p className="text-sm sm:text-base text-ink2 max-w-xl mx-auto leading-relaxed">
							Have questions, feedback, or suggestions for improving Voice Flow?
							Send our team a message below or start an anonymous in-app chat.
						</p>
					</FadeIn>
				</div>
			</section>

			{/* Main Form and Support Channels */}
			<section className="max-w-4xl mx-auto px-6 mb-16">
				<div className="grid grid-cols-1 md:grid-cols-5 gap-8">
					{/* Left Column: Direct Channels */}
					<div className="md:col-span-2 space-y-4">
						<FadeIn>
							<div className="card p-5 border border-border bg-surface">
								<div className="flex items-center gap-2.5 mb-2 text-accent font-semibold text-sm">
									<MessageSquare size={16} /> Anonymous In-App Chat
								</div>
								<p className="text-xs text-ink2 leading-relaxed mb-3">
									Want to talk directly to our 24/7 care assistant or draft a complaint with zero login?
								</p>
								<Link
									to="/chat"
									className="btn btn-primary !text-xs w-full py-2 flex items-center justify-center gap-1.5"
								>
									Open Anonymous Chat <ArrowRight size={13} />
								</Link>
							</div>

							<div className="card p-5 border border-border bg-surface">
								<div className="flex items-center gap-2.5 mb-2 text-ink font-semibold text-sm">
									<Mail size={16} /> Direct Email Inquiries
								</div>
								<p className="text-xs text-ink3 leading-relaxed mb-2">
									For leadership, general questions, or suggestions:
								</p>
								<code className="text-xs font-mono font-semibold text-accent block mb-3">
									support@voicebox.app
								</code>
								<div className="text-[10px] text-ink3 flex items-center gap-1.5">
									<Clock size={12} className="text-good" />
									<span>Reviewed by our team within 24 hours</span>
								</div>
							</div>

							<div className="card p-5 border border-good/25 bg-good/[0.02]">
								<div className="flex items-center gap-2 text-good font-semibold text-xs mb-1">
									<ShieldCheck size={14} /> Privacy Protected
								</div>
								<p className="text-[11px] text-ink2 leading-relaxed">
									Messages sent through Voice Flow do not track IP addresses. Providing your name or email is always completely optional.
								</p>
							</div>
						</FadeIn>
					</div>

					{/* Right Column: Contact Message Form */}
					<div className="md:col-span-3">
						<FadeIn delay={0.1}>
							<div className="card p-6 sm:p-7 border border-border/80 bg-surface shadow-xs">
								<h2 className="font-display font-bold text-lg text-ink mb-1">
									Send a Message
								</h2>
								<p className="text-xs text-ink3 mb-6">
									Fill out this quick form and our administrative team will review your message.
								</p>

								{submitted ? (
									<div className="p-6 rounded-2xl bg-good/10 border border-good/30 text-center vb-rise">
										<CheckCircle2 size={36} className="mx-auto text-good mb-2" />
										<h3 className="font-display font-bold text-base text-ink mb-1">
											Message Sent Successfully
										</h3>
										<p className="text-xs text-ink2 leading-relaxed max-w-sm mx-auto mb-4">
											Thank you for reaching out. Your message has been safely received and our team will review it shortly.
										</p>
										<button
											type="button"
											onClick={() => {
												setSubmitted(false);
												setForm({ name: "", email: "", subject: "", message: "" });
											}}
											className="btn btn-ghost !text-xs border border-border"
										>
											Send Another Message
										</button>
									</div>
								) : (
									<form onSubmit={handleSubmit} className="space-y-4">
										{error && (
											<div className="p-3 rounded-xl bg-bad/10 text-bad border border-bad/20 text-xs flex items-center gap-2">
												<AlertTriangle size={14} className="shrink-0" />
												<span>{error}</span>
											</div>
										)}

										<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
											<div>
												<label
													htmlFor="contact-name"
													className="block text-xs font-semibold text-ink mb-1"
												>
													Name (Optional)
												</label>
												<input
													id="contact-name"
													type="text"
													value={form.name}
													onChange={(e) => setForm({ ...form, name: e.target.value })}
													placeholder="Your name or leave blank"
													className="w-full px-3 py-2 text-xs rounded-xl bg-surface2 border border-border text-ink focus:outline-none focus:border-accent"
												/>
											</div>

											<div>
												<label
													htmlFor="contact-email"
													className="block text-xs font-semibold text-ink mb-1"
												>
													Email (Optional)
												</label>
												<input
													id="contact-email"
													type="email"
													value={form.email}
													onChange={(e) => setForm({ ...form, email: e.target.value })}
													placeholder="Email for reply (optional)"
													className="w-full px-3 py-2 text-xs rounded-xl bg-surface2 border border-border text-ink focus:outline-none focus:border-accent"
												/>
											</div>
										</div>

										<div>
											<label
												htmlFor="contact-subject"
												className="block text-xs font-semibold text-ink mb-1"
											>
												Subject
											</label>
											<input
												id="contact-subject"
												type="text"
												value={form.subject}
												onChange={(e) => setForm({ ...form, subject: e.target.value })}
												placeholder="Brief summary..."
												className="w-full px-3 py-2 text-xs rounded-xl bg-surface2 border border-border text-ink focus:outline-none focus:border-accent"
											/>
										</div>

										<div>
											<label
												htmlFor="contact-message"
												className="block text-xs font-semibold text-ink mb-1"
											>
												Message <span className="text-bad">*</span>
											</label>
											<textarea
												id="contact-message"
												rows={5}
												required
												value={form.message}
												onChange={(e) => setForm({ ...form, message: e.target.value })}
												placeholder="Write your message or inquiry..."
												className="w-full px-3 py-2 text-xs rounded-xl bg-surface2 border border-border text-ink focus:outline-none focus:border-accent resize-none leading-relaxed"
											/>
										</div>

										<button
											type="submit"
											disabled={sending || !form.message.trim()}
											className="btn btn-primary w-full py-2.5 !text-xs font-semibold flex items-center justify-center gap-2 shadow-xs"
										>
											{sending ? (
												<>
													<span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
													Sending...
												</>
											) : (
												<>
													<Send size={13} /> Send Message
												</>
											)}
										</button>
									</form>
								)}
							</div>
						</FadeIn>
					</div>
				</div>

				<StaticFooter />
			</section>
		</div>
	);
}
