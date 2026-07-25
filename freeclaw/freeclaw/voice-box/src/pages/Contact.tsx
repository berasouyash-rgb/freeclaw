import { useState } from 'react';
import { Send, Mail, Clock, MessageSquare, Check, ExternalLink } from 'lucide-react';
import FadeIn from '../components/FadeIn';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Simulate send
    await new Promise(r => setTimeout(r, 1000));
    setSending(false);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-bg vb-page-enter">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-16 md:pt-32 md:pb-20 text-center">
          <FadeIn>
            <h1 className="text-4xl md:text-5xl font-bold text-ink mb-6">Get in touch</h1>
            <p className="text-lg text-ink2 max-w-xl mx-auto">
              Have questions, feedback, or need help? We&apos;d love to hear from you.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8">
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
              <p className="text-sm text-ink2">Within 24 hours on business days</p>
            </div>
            <div className="card p-6">
              <MessageSquare className="w-6 h-6 text-accent mb-3" />
              <h3 className="font-semibold text-ink mb-1">Live Support</h3>
              <p className="text-sm text-ink2">Available Mon-Fri, 9am-5pm EST</p>
            </div>
          </FadeIn>

          {/* Contact Form */}
          <FadeIn delay={0.1} className="md:col-span-2">
            {submitted ? (
              <div className="card p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-emerald-500" />
                </div>
                <h2 className="text-xl font-bold text-ink mb-2">Message sent!</h2>
                <p className="text-ink2">We&apos;ll get back to you within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="card p-6 space-y-4">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-accent-soft text-accent border border-accent/20 mb-2">
                  <ExternalLink size={12} />
                  <span>For fastest response, email <a href="mailto:support@voicebox.app" className="font-semibold underline">support@voicebox.app</a> directly.</span>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Name</label>
                    <input
                      type="text"
                      required
                      className="input w-full"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Email</label>
                    <input
                      type="email"
                      required
                      className="input w-full"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Subject</label>
                  <input
                    type="text"
                    required
                    className="input w-full"
                    value={form.subject}
                    onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="How can we help?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Message</label>
                  <textarea
                    required
                    rows={5}
                    className="input w-full resize-none"
                    value={form.message}
                    onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
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
              </form>
            )}
          </FadeIn>
        </div>
      </section>
    </div>
  );
}
