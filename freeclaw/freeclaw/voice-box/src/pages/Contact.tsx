import {
	Check,
	Clock,
	ExternalLink,
	Mail,
	MessageSquare,
	Send,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { lsGet } from "../lib/identity";
import FadeIn from "../components/FadeIn";

export default function Contact() {
	const [form, setForm] = useState({
		name: "",
		email: "",
		subject: "",
		message: "",
	});
	const [submitted, setSubmitted] = useState(false);
	const [sending, setSending] = useState(false);

	const [error, setError] = useState("");

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
			<section className="relative overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
				<div className="relative max-w-4xl mx-auto px-6 pt-24 pb-16 md:pt-32 md:pb-20 text-center">
					<FadeIn>
						<h1 className="text-4xl md:text-5xl font-bold text-ink mb-6">
							Get in touch
						</h1>
						<p className="text-lg text-ink2 max-w-xl mx-auto">
							Have questions, feedback, or need help? We&apos;d love to hear
							from you.
						</p>
					</FadeIn>
				</div>
			</section>

			<section className="max-w-4xl mx-auto px-6 py-16">
				<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
					{/* Contact Info */}
					<FadeIn className="md:col-span-1 space-y-6">
						<div className="card p-6">
							<Mail className="w-6 h-6 text-accent mb-3" />
							<h3 className="font-semibold text-ink mb-1">Email</h3>
							<p className="text-sm text-ink2">support@voicebox.app</p>
						</div>
						<div className="card p-6">
							<Clock className="w-6 h-6 text-accent mb-3" />
							<h3 className="font-semibold text-ink mb-1">Response Time</h3>
							<p className="text-sm text-ink2">
								Within 24 hours on business days
							</p>
						</div>
						<div className="card p-6">
							<MessageSquare className="w-6 h-6 text-accent mb-3" />
							<h3 className="font-semibold text-ink mb-1">Live Support</h3>
							<p className="text-sm text-ink2">
								Available Mon-Fri, 9am-5pm EST
							</p>
						</div>
					</FadeIn>

					{/* Contact Form */}
					<FadeIn delay={0.1} className="md:col-span-2">
						{submitted ? (
							<div className="card p-8 text-center">
								<div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
									<Check className="w-8 h-8 text-emerald-500" />
								</div>
								<h2 className="text-xl font-bold text-ink mb-2">
									Message sent!
								</h2>
								<p className="text-ink2">
									We&apos;ll get back to you within 24 hours.
								</p>
							</div>
						) : (
							<form onSubmit={handleSubmit} className="card p-6 space-y-4">
								<div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-accent-soft text-accent border border-accent/20 mb-2">
									<ExternalLink size={12} />
									<span>
										For fastest response, email{" "}
										<a
											href="mailto:support@voicebox.app"
											className="font-semibold underline"
										>
											support@voicebox.app
										</a>{" "}
										directly.
									</span>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<label
											className="block text-sm font-medium text-ink mb-1"
											htmlFor="contact-name"
										>
											Name
										</label>
										<input
											id="contact-name"
											name="name"
											type="text"
											required
											className="input w-full"
											value={form.name}
											onChange={(e) =>
												setForm((f) => ({ ...f, name: e.target.value }))
											}
											placeholder="Your name"
										/>
									</div>
									<div>
										<label
											className="block text-sm font-medium text-ink mb-1"
											htmlFor="contact-email"
										>
											Email
										</label>
										<input
											id="contact-email"
											name="email"
											type="email"
											required
											className="input w-full"
											value={form.email}
											onChange={(e) =>
												setForm((f) => ({ ...f, email: e.target.value }))
											}
											placeholder="you@example.com"
										/>
									</div>
								</div>
								<div>
									<label
										className="block text-sm font-medium text-ink mb-1"
										htmlFor="contact-subject"
									>
										Subject
									</label>
									<input
										id="contact-subject"
										name="subject"
										type="text"
										required
										className="input w-full"
										value={form.subject}
										onChange={(e) =>
											setForm((f) => ({ ...f, subject: e.target.value }))
										}
										placeholder="How can we help?"
									/>
								</div>
								<div>
									<label
										className="block text-sm font-medium text-ink mb-1"
										htmlFor="contact-message"
									>
										Message
									</label>
									<textarea
										id="contact-message"
										name="message"
										required
										rows={5}
										className="input w-full resize-none"
										value={form.message}
										onChange={(e) =>
											setForm((f) => ({ ...f, message: e.target.value }))
										}
										placeholder="Tell us more..."
									/>
								</div>
								<button
									type="submit"
									disabled={sending}
									className="btn btn-primary w-full py-3 flex items-center justify-center gap-2"
								>
									{sending ? (
										<span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
									) : (
										<>
											<Send className="w-4 h-4" />
											Send Message
										</>
									)}
								</button>
								{error && (
									<p className="text-sm text-bad mt-2 text-center">{error}</p>
								)}
							</form>
						)}
					</FadeIn>
				</div>
			</section>
		</div>
	);
}
