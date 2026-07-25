import type { RoomDef, AgentActivity } from './types';

/* ── Division color map ──────────────────────────────────── */
export const DIV_COLORS: Record<string, { bg: string; border: string; text: string; glow: string; ring: string }> = {
  executive:   { bg: 'bg-amber-500/10',  border: 'border-amber-500/25',  text: 'text-amber-400',  glow: 'shadow-amber-500/10', ring: 'ring-amber-500/30' },
  content:     { bg: 'bg-blue-500/10',   border: 'border-blue-500/25',   text: 'text-blue-400',   glow: 'shadow-blue-500/10',  ring: 'ring-blue-500/30' },
  users:       { bg: 'bg-emerald-500/10',border: 'border-emerald-500/25',text: 'text-emerald-400',glow: 'shadow-emerald-500/10', ring: 'ring-emerald-500/30' },
  analytics:   { bg: 'bg-violet-500/10', border: 'border-violet-500/25', text: 'text-violet-400', glow: 'shadow-violet-500/10', ring: 'ring-violet-500/30' },
  system:      { bg: 'bg-red-500/10',    border: 'border-red-500/25',    text: 'text-red-400',    glow: 'shadow-red-500/10',    ring: 'ring-red-500/30' },
  meta:        { bg: 'bg-cyan-500/10',   border: 'border-cyan-500/25',   text: 'text-cyan-400',   glow: 'shadow-cyan-500/10',   ring: 'ring-cyan-500/30' },
  specialist:  { bg: 'bg-pink-500/10',   border: 'border-pink-500/25',   text: 'text-pink-400',   glow: 'shadow-pink-500/10',   ring: 'ring-pink-500/30' },
  platform:    { bg: 'bg-teal-500/10',   border: 'border-teal-500/25',   text: 'text-teal-400',   glow: 'shadow-teal-500/10',   ring: 'ring-teal-500/30' },
  'eng-backend':  { bg: 'bg-orange-500/10',  border: 'border-orange-500/25',  text: 'text-orange-400',  glow: 'shadow-orange-500/10', ring: 'ring-orange-500/30' },
  'eng-frontend': { bg: 'bg-sky-500/10',    border: 'border-sky-500/25',    text: 'text-sky-400',    glow: 'shadow-sky-500/10',    ring: 'ring-sky-500/30' },
  'eng-database': { bg: 'bg-amber-600/10',  border: 'border-amber-600/25',  text: 'text-amber-500',  glow: 'shadow-amber-600/10',  ring: 'ring-amber-600/30' },
  'eng-infra':    { bg: 'bg-slate-500/10',  border: 'border-slate-500/25',  text: 'text-slate-400',  glow: 'shadow-slate-500/10',  ring: 'ring-slate-500/30' },
  'eng-qa':       { bg: 'bg-lime-500/10',   border: 'border-lime-500/25',   text: 'text-lime-400',   glow: 'shadow-lime-500/10',   ring: 'ring-lime-500/30' },
  'eng-dev':      { bg: 'bg-fuchsia-500/10',border: 'border-fuchsia-500/25',text: 'text-fuchsia-400',glow: 'shadow-fuchsia-500/10',ring: 'ring-fuchsia-500/30' },
};

export const TIER_COLORS: Record<string, string> = {
  executive:  'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  leadership: 'bg-violet-500/15 text-violet-400 border border-violet-500/20',
  specialist: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  meta:       'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20',
  custom:     'bg-pink-500/15 text-pink-400 border border-pink-500/20',
};

/* ── Office room layout ──────────────────────────────────── */
export const ROOMS: RoomDef[] = [
  { id: 'ceo',           name: 'CEO Office',        icon: '👑', divisions: ['executive'],            accent: 'amber',  span: 'sm' },
  { id: 'command',       name: 'Command Center',     icon: '🎯', divisions: ['system'],              accent: 'red',    span: 'md' },
  { id: 'meeting',       name: 'Meeting Room',       icon: '🤝', divisions: ['meta'],                accent: 'cyan',   span: 'sm' },
  { id: 'backend',       name: 'Backend Room',       icon: '⚙️',  divisions: ['eng-backend'],         accent: 'orange', span: 'md' },
  { id: 'frontend',      name: 'Frontend Room',      icon: '🎨', divisions: ['eng-frontend'],        accent: 'sky',    span: 'md' },
  { id: 'database',      name: 'Database Room',      icon: '💾', divisions: ['eng-database'],        accent: 'amber',  span: 'sm' },
  { id: 'security',      name: 'Security Room',      icon: '🛡️',  divisions: ['specialist'],          accent: 'pink',   span: 'sm' },
  { id: 'analytics',     name: 'Analytics Room',     icon: '📊', divisions: ['analytics'],           accent: 'violet', span: 'sm' },
  { id: 'moderation',    name: 'Moderation Room',    icon: '📝', divisions: ['content'],             accent: 'blue',   span: 'sm' },
  { id: 'support',       name: 'Support Center',     icon: '💬', divisions: ['users'],               accent: 'emerald',span: 'sm' },
  { id: 'server',        name: 'Server Room',        icon: '🖥️',  divisions: ['eng-infra'],           accent: 'slate',  span: 'sm' },
  { id: 'qa',            name: 'QA Lab',             icon: '🧪', divisions: ['eng-qa'],              accent: 'lime',   span: 'sm' },
  { id: 'research',      name: 'AI Research Lab',    icon: '🧬', divisions: ['eng-dev'],             accent: 'fuchsia',span: 'md' },
  { id: 'platform',      name: 'Platform Room',      icon: '☁️',  divisions: ['platform'],            accent: 'teal',   span: 'sm' },
  { id: 'coffee',        name: 'Coffee Area',        icon: '☕',  divisions: [],                      accent: 'stone',  span: 'sm' },
];

/* ── Agent activity patterns ─────────────────────────────── */
export const ACTIVITIES: AgentActivity[] = [
  'typing', 'thinking', 'reviewing', 'monitoring',
  'debugging', 'testing', 'deploying', 'reporting',
  'idle', 'meeting', 'celebrating', 'reading',
];

export const ACTIVITY_LABELS: Record<AgentActivity, string> = {
  typing: 'Typing', thinking: 'Thinking', reviewing: 'Reviewing',
  monitoring: 'Monitoring', debugging: 'Debugging', testing: 'Testing',
  deploying: 'Deploying', reporting: 'Reporting', idle: 'Idle',
  meeting: 'In Meeting', celebrating: 'Celebrating', reading: 'Reading',
};

export const ACTIVITY_ICONS: Record<AgentActivity, string> = {
  typing: '⌨️', thinking: '💭', reviewing: '👁️', monitoring: '📡',
  debugging: '🐛', testing: '🧪', deploying: '🚀', reporting: '📋',
  idle: '💤', meeting: '🤝', celebrating: '🎉', reading: '📖',
};

/* ── Simulated task names per division ───────────────────── */
export const DIVISION_TASKS: Record<string, string[]> = {
  executive:      ['Reviewing Q4 strategy', 'Analyzing market trends', 'Planning next sprint', 'Evaluating partnerships'],
  content:        ['Moderating posts', 'Reviewing flagged content', 'Updating community guidelines', 'Analyzing sentiment'],
  users:          ['Processing support ticket', 'Helping new user', 'Resolving account issue', 'Updating FAQ'],
  analytics:      ['Building dashboard', 'Analyzing user metrics', 'Running A/B test report', 'Forecasting trends'],
  system:         ['Monitoring uptime', 'Checking security alerts', 'Optimizing API routes', 'Reviewing logs'],
  meta:           ['Building new tool', 'Designing agent workflow', 'Optimizing orchestrator', 'Creating skill template'],
  specialist:     ['Scanning vulnerabilities', 'Reviewing permissions', 'Auditing access logs', 'Updating security rules'],
  platform:       ['Checking SLO metrics', 'Scaling infrastructure', 'Reviewing deploy pipeline', 'Optimizing CDN'],
  'eng-backend':  ['Optimizing API endpoint', 'Refactoring middleware', 'Writing unit tests', 'Reviewing PR #421'],
  'eng-frontend': ['Building new component', 'Fixing hydration bug', 'Optimizing bundle size', 'Reviewing design tokens'],
  'eng-database': ['Optimizing slow query', 'Running migration', 'Indexing new columns', 'Backing up data'],
  'eng-infra':    ['Updating Terraform config', 'Scaling cluster', 'Monitoring CPU usage', 'Rotating secrets'],
  'eng-qa':       ['Running E2E tests', 'Writing integration test', 'Flaky test investigation', 'Coverage report'],
  'eng-dev':      ['Prototyping new agent', 'Testing tool creation', 'Benchmarking performance', 'Designing API schema'],
};

/* ── Activity event templates ────────────────────────────── */
export const EVENT_TEMPLATES = [
  { type: 'task_complete' as const, msgs: ['Completed sentiment analysis', 'Finished security scan', 'Deployed hotfix #284', 'Generated weekly report', 'Optimized query by 40%', 'Resolved support ticket'] },
  { type: 'task_start' as const,    msgs: ['Started code review', 'Beginning E2E test suite', 'Analyzing new posts', 'Scanning dependencies', 'Building new component'] },
  { type: 'alert' as const,         msgs: ['High memory usage detected', 'API latency spike', 'New vulnerability found', 'Rate limit approaching'] },
  { type: 'deploy' as const,        msgs: ['Deployed v2.14.0 to production', 'Rolled back hotfix', 'Updated CDN cache', 'Migrated database schema'] },
  { type: 'report' as const,        msgs: ['Weekly analytics ready', 'Security audit complete', 'Performance benchmark done', 'User satisfaction report'] },
  { type: 'message' as const,      msgs: ['Message from System Monitor', 'Handoff from Night Shift', 'Escalation from Support', 'Update from QA Lab'] },
];
