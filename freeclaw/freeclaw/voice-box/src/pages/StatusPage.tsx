import { useState } from 'react';
import { Activity, Check, AlertTriangle, XCircle, Clock, RefreshCw } from 'lucide-react';
import FadeIn from '../components/FadeIn';

const SERVICES = [
  { name: 'Web Application', status: 'operational', uptime: 99.98 },
  { name: 'API Gateway', status: 'operational', uptime: 99.97 },
  { name: 'AI Processing', status: 'operational', uptime: 99.95 },
  { name: 'Real-time Updates', status: 'operational', uptime: 99.99 },
  { name: 'File Uploads', status: 'operational', uptime: 99.96 },
  { name: 'Email Notifications', status: 'operational', uptime: 99.94 },
];

const INCIDENTS = [
  {
    date: '2026-01-15',
    title: 'Scheduled Maintenance',
    status: 'resolved',
    duration: '30 minutes',
    description: 'Database optimization and cache warming. No user impact during maintenance window.',
  },
  {
    date: '2025-12-20',
    title: 'Elevated API Latency',
    status: 'resolved',
    duration: '15 minutes',
    description: 'Increased response times on AI endpoints due to provider rate limiting. Resolved by switching to backup provider.',
  },
  {
    date: '2025-11-05',
    title: 'Brief Service Interruption',
    status: 'resolved',
    duration: '5 minutes',
    description: 'Temporary loss of real-time updates. Caused by WebSocket connection pool exhaustion. Fixed with connection pool扩容.',
  },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    operational: 'bg-emerald-500/10 text-emerald-500',
    degraded: 'bg-amber-500/10 text-amber-500',
    outage: 'bg-red-500/10 text-red-500',
    maintenance: 'bg-blue-500/10 text-blue-500',
  };
  const icons: Record<string, typeof Check> = {
    operational: Check,
    degraded: AlertTriangle,
    outage: XCircle,
    maintenance: Clock,
  };
  const Icon = icons[status] || Check;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.operational}`}>
      <Icon className="w-3 h-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function StatusPage() {
  const [lastChecked, setLastChecked] = useState(new Date());
  const [checking, setChecking] = useState(false);

  const refresh = () => {
    setChecking(true);
    setTimeout(() => {
      setLastChecked(new Date());
      setChecking(false);
    }, 1000);
  };

  const allOperational = SERVICES.every(s => s.status === 'operational');

  return (
    <div className="min-h-screen bg-bg">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-6 pt-24 pb-12 md:pt-32 md:pb-16 text-center">
          <FadeIn>
            <h1 className="text-4xl md:text-5xl font-bold text-ink mb-4">System Status</h1>
            <div className="flex items-center justify-center gap-2 text-ink2 text-sm">
              <span>Last checked: {lastChecked.toLocaleTimeString()}</span>
              <button
                onClick={refresh}
                disabled={checking}
                className="p-1 hover:bg-surface rounded transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Overall Status */}
      <section className="max-w-4xl mx-auto px-6 pb-12">
        <FadeIn>
          <div className={`card p-6 text-center ${allOperational ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
            <div className="flex items-center justify-center gap-2 mb-2">
              {allOperational ? (
                <Check className="w-6 h-6 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              )}
              <h2 className="text-xl font-bold text-ink">
                {allOperational ? 'All Systems Operational' : 'Some Systems Experiencing Issues'}
              </h2>
            </div>
            <p className="text-sm text-ink2">
              {allOperational
                ? 'All services are running normally.'
                : 'We are investigating affected services.'}
            </p>
          </div>
        </FadeIn>
      </section>

      {/* Services */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <FadeIn className="mb-6">
          <h2 className="text-lg font-bold text-ink">Services</h2>
        </FadeIn>
        <FadeIn>
          <div className="card divide-y divide-border/50">
            {SERVICES.map(s => (
              <div key={s.name} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-ink3" />
                  <span className="text-ink">{s.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-ink3 hidden sm:block">{s.uptime}% uptime</span>
                  <StatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </section>

      {/* Uptime Bars */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <FadeIn className="mb-6">
          <h2 className="text-lg font-bold text-ink">Uptime History (90 days)</h2>
        </FadeIn>
        <FadeIn>
          <div className="card p-6">
            <div className="flex gap-0.5 h-8">
              {Array.from({ length: 90 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-emerald-500/60 hover:bg-emerald-500 transition-colors"
                  title={`Day ${90 - i}: 99.9% uptime`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-ink3">
              <span>90 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* Incidents */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <FadeIn className="mb-6">
          <h2 className="text-lg font-bold text-ink">Past Incidents</h2>
        </FadeIn>
        <FadeIn>
          <div className="space-y-4">
            {INCIDENTS.map(inc => (
              <div key={inc.title} className="card p-6">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-medium text-ink">{inc.title}</h3>
                    <p className="text-xs text-ink3">{inc.date} · {inc.duration}</p>
                  </div>
                  <StatusBadge status="operational" />
                </div>
                <p className="text-sm text-ink2">{inc.description}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </section>
    </div>
  );
}
