import { Link } from 'react-router-dom';
import { Heart, Shield, Users, Target, ArrowRight } from 'lucide-react';
import FadeIn from '../components/FadeIn';

const VALUES = [
  {
    icon: Shield,
    title: 'Privacy First',
    description: 'Every design decision starts with one question: does this protect student anonymity? If the answer is anything other than a definitive yes, we don\'t ship it.',
  },
  {
    icon: Heart,
    title: 'Empathy Driven',
    description: 'Behind every submission is a real person with a real concern. Our AI agents are trained to respond with understanding, not bureaucracy.',
  },
  {
    icon: Users,
    title: 'Built For Educators',
    description: 'We\'re not building for administrators — we\'re building for the students and staff who make schools work. Every feature serves their needs.',
  },
  {
    icon: Target,
    title: 'Action Over Noise',
    description: 'Feedback without action is just noise. We surface what matters, prioritize what\'s urgent, and track what\'s been resolved.',
  },
];

const MILESTONES = [
  { year: '2024', title: 'Founded', description: 'Started with a simple question: why don\'t students speak up?' },
  { year: '2024', title: 'First School', description: 'Pilot program with Lincoln High School — 340% increase in feedback submissions.' },
  { year: '2025', title: 'AI Integration', description: 'Launched 110+ specialized AI agents for intelligent triage and emotional support.' },
  { year: '2025', title: 'Enterprise Launch', description: 'District-wide deployments, FERPA compliance, and custom AI training.' },
  { year: '2026', title: 'Today', description: 'Serving hundreds of schools nationwide with sub-2-second AI response times.' },
];

export default function About() {
  return (
    <div className="min-h-screen bg-bg">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-16 md:pt-32 md:pb-20 text-center">
          <FadeIn>
            <h1 className="text-4xl md:text-5xl font-bold text-ink mb-6">
              Every student deserves a voice.
            </h1>
            <p className="text-lg text-ink2 max-w-2xl mx-auto leading-relaxed">
              Voice Box exists because too many student concerns go unheard. We believe anonymous feedback,
              combined with intelligent AI, can transform how schools listen and respond.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Mission */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <FadeIn>
          <div className="card p-8 md:p-12">
            <h2 className="text-2xl font-bold text-ink mb-4">Our Mission</h2>
            <p className="text-ink2 leading-relaxed text-lg">
              To create a world where every student feels safe sharing their honest feedback —
              and where every school has the tools to listen, understand, and act on that feedback
              with the urgency it deserves.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* Values */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <FadeIn className="mb-12">
          <h2 className="text-2xl font-bold text-ink text-center">What We Believe</h2>
        </FadeIn>
        <div className="grid md:grid-cols-2 gap-6">
          {VALUES.map((v, i) => (
            <FadeIn key={v.title} delay={i * 0.1}>
              <div className="card p-6 h-full">
                <v.icon className="w-8 h-8 text-accent mb-3" />
                <h3 className="font-semibold text-ink mb-2">{v.title}</h3>
                <p className="text-ink2 text-sm leading-relaxed">{v.description}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="bg-surface/50 border-y border-border/50">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <FadeIn className="mb-12">
            <h2 className="text-2xl font-bold text-ink text-center">Our Journey</h2>
          </FadeIn>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
            {MILESTONES.map((m, i) => (
              <FadeIn key={m.title} delay={i * 0.1}>
                <div className="relative pl-12 pb-8 last:pb-0">
                  <div className="absolute left-2.5 top-1 w-3 h-3 rounded-full bg-accent border-2 border-bg" />
                  <div className="text-sm font-mono text-accent mb-1">{m.year}</div>
                  <h3 className="font-semibold text-ink mb-1">{m.title}</h3>
                  <p className="text-sm text-ink2">{m.description}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-16 text-center">
        <FadeIn>
          <h2 className="text-2xl font-bold text-ink mb-4">Join us in making schools better</h2>
          <p className="text-ink2 mb-6">Ready to hear every voice in your school community?</p>
          <Link to="/submit" className="btn btn-primary px-8 py-3 inline-flex items-center gap-2 group">
            Get Started
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </FadeIn>
      </section>
    </div>
  );
}
