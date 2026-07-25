import { Tag, Sparkles, Bug, Zap, Shield } from 'lucide-react';
import FadeIn from '../components/FadeIn';

const VERSIONS = [
  {
    version: '4.0.0',
    date: 'January 2026',
    tag: 'latest',
    title: 'Enterprise Intelligence Layer',
    description: 'The most advanced version of Voice Box — AI-first architecture with 110+ agents, tool calling, multi-agent orchestration, RAG, and enterprise security.',
    changes: [
      { type: 'feature', text: '110+ specialized AI agents with tool calling' },
      { type: 'feature', text: 'Multi-agent orchestration with capability-based routing' },
      { type: 'feature', text: 'RAG (Retrieval-Augmented Generation) with knowledge base' },
      { type: 'feature', text: 'Long-term memory for AI agents' },
      { type: 'feature', text: 'Verification engine for AI confidence scoring' },
      { type: 'feature', text: 'Enterprise audit logging and approval workflows' },
      { type: 'feature', text: 'SSE streaming for real-time AI conversations' },
      { type: 'feature', text: 'Admin AI central intelligence workspace' },
      { type: 'feature', text: 'Proactive suggestion detection' },
      { type: 'security', text: 'Circuit breakers for all external services' },
      { type: 'security', text: 'Prompt injection detection' },
      { type: 'security', text: 'Rate limiting and abuse prevention' },
      { type: 'improvement', text: 'Standardized tool result contracts' },
      { type: 'improvement', text: 'Tool evidence audit trail' },
    ],
  },
  {
    version: '3.0.0',
    date: 'December 2025',
    title: 'V3 Enterprise Foundation',
    description: 'Database migration, API gateway, streaming infrastructure, and the agent execution framework.',
    changes: [
      { type: 'feature', text: 'V3 API gateway with structured routing' },
      { type: 'feature', text: 'SSE streaming infrastructure' },
      { type: 'feature', text: 'Agent execution framework' },
      { type: 'feature', text: 'Tool registry with 29 tools' },
      { type: 'database', text: 'V3 database tables (tool_calls, approvals, audit_logs, knowledge_base, agent_memory)' },
      { type: 'improvement', text: 'Request monitoring and metrics' },
    ],
  },
  {
    version: '2.0.0',
    date: 'November 2025',
    title: 'Admin Command Center',
    description: 'Complete admin panel with 17 tabs, agent team management, real-time operations, and AI-powered insights.',
    changes: [
      { type: 'feature', text: '17-tab admin dashboard' },
      { type: 'feature', text: 'Agent team visualization with 110+ agents' },
      { type: 'feature', text: 'Real-time command center' },
      { type: 'feature', text: 'AI-powered duplicate detection' },
      { type: 'feature', text: 'Sentiment analysis and urgency ranking' },
      { type: 'feature', text: 'Unified inbox with emotional support routing' },
      { type: 'improvement', text: 'Infinite scroll for all tables' },
      { type: 'improvement', text: 'CSV export for reports' },
    ],
  },
  {
    version: '1.0.0',
    date: 'October 2025',
    title: 'Public Launch',
    description: 'The first public release of Voice Box — anonymous student feedback with real-time updates.',
    changes: [
      { type: 'feature', text: 'Anonymous feedback submission' },
      { type: 'feature', text: 'Real-time post feed with sorting' },
      { type: 'feature', text: 'Polls and suggestions' },
      { type: 'feature', text: 'Kanban solving board' },
      { type: 'feature', text: 'User chat with AI emotional support' },
      { type: 'feature', text: 'Privacy-first architecture' },
      { type: 'feature', text: 'Mobile-responsive design' },
    ],
  },
];

const ICONS: Record<string, typeof Sparkles> = {
  feature: Sparkles,
  fix: Bug,
  improvement: Zap,
  security: Shield,
  database: Tag,
};

const COLORS: Record<string, string> = {
  feature: 'text-emerald-500 bg-emerald-500/10',
  fix: 'text-red-500 bg-red-500/10',
  improvement: 'text-blue-500 bg-blue-500/10',
  security: 'text-amber-500 bg-amber-500/10',
  database: 'text-purple-500 bg-purple-500/10',
};

export default function Changelog() {
  return (
    <div className="min-h-screen bg-bg">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        <div className="relative max-w-3xl mx-auto px-6 pt-24 pb-16 md:pt-32 md:pb-20 text-center">
          <FadeIn>
            <h1 className="text-4xl md:text-5xl font-bold text-ink mb-4">Changelog</h1>
            <p className="text-lg text-ink2">What&apos;s new in Voice Box</p>
          </FadeIn>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          {VERSIONS.map((v, i) => (
            <FadeIn key={v.version} delay={i * 0.1}>
              <div className="relative pl-12 pb-12 last:pb-0">
                {/* Dot */}
                <div className={`absolute left-2.5 top-1 w-3 h-3 rounded-full border-2 border-bg ${i === 0 ? 'bg-accent' : 'bg-border'}`} />

                {/* Header */}
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-mono text-sm text-accent">v{v.version}</span>
                  {v.tag && (
                    <span className="text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                      {v.tag}
                    </span>
                  )}
                  <span className="text-sm text-ink3">{v.date}</span>
                </div>
                <h2 className="text-xl font-bold text-ink mb-1">{v.title}</h2>
                <p className="text-ink2 mb-4">{v.description}</p>

                {/* Changes */}
                <div className="space-y-2">
                  {v.changes.map((c, j) => {
                    const Icon = ICONS[c.type] || Sparkles;
                    const color = COLORS[c.type] || COLORS.feature;
                    return (
                      <div key={j} className="flex items-start gap-2">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded shrink-0 mt-0.5 ${color}`}>
                          <Icon className="w-3 h-3" />
                        </span>
                        <span className="text-sm text-ink2">{c.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </div>
  );
}
