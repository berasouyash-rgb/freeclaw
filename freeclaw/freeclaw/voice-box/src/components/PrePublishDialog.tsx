import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, CheckCircle, XCircle, Eye, Loader2, FileText, Clock, TrendingUp, Building2 } from 'lucide-react';

interface CheckItem {
  label: string;
  icon: React.ReactNode;
  status: 'pending' | 'checking' | 'pass' | 'warn' | 'fail';
  detail?: string;
}

interface PrePublishResult {
  decision: 'safe' | 'revision' | 'high_risk';
  risk_score: number;
  reason: string;
  checks: {
    privacy: { pass: boolean; issues: string[] };
    safety: { pass: boolean; issues: string[] };
    spam: { pass: boolean; issues: string[] };
    quality: { pass: boolean; issues: string[] };
    duplicates: { count: number; items: any[] };
  };
  analysis: {
    priority: string;
    department: string;
    category: string;
    summary: string;
    estimated_resolution_time: string;
    llm_analyzed: boolean;
  };
  review_id?: string | null;
  elapsed_ms: number;
}

interface PrePublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApproved: (result: PrePublishResult) => void;
  content: {
    content_type: 'post' | 'comment' | 'poll';
    title?: string;
    description?: string;
    body?: string;
    category?: string;
    options?: string[];
    author_id: string;
  };
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function PrePublishDialog({ isOpen, onClose, onApproved, content }: PrePublishDialogProps) {
  const [phase, setPhase] = useState<'running' | 'result'>('running');
  const [result, setResult] = useState<PrePublishResult | null>(null);
  const [checks, setChecks] = useState<CheckItem[]>([
    { label: 'Privacy Shield', icon: <Eye size={16} />, status: 'pending' },
    { label: 'Safety Check', icon: <ShieldCheck size={16} />, status: 'pending' },
    { label: 'Spam Detection', icon: <AlertTriangle size={16} />, status: 'pending' },
    { label: 'Quality Review', icon: <FileText size={16} />, status: 'pending' },
    { label: 'Duplicate Detection', icon: <TrendingUp size={16} />, status: 'pending' },
    { label: 'Priority Classification', icon: <AlertTriangle size={16} />, status: 'pending' },
    { label: 'Department Routing', icon: <Building2 size={16} />, status: 'pending' },
    { label: 'AI Summary', icon: <FileText size={16} />, status: 'pending' },
    { label: 'Resolution Estimate', icon: <Clock size={16} />, status: 'pending' },
    { label: 'Risk Assessment', icon: <Shield size={16} />, status: 'pending' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Keyboard: Escape to close + focus trap
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    setTimeout(() => dialogRef.current?.focus(), 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  // Animate through checks one by one
  const animateChecks = useCallback(async (finalResult: PrePublishResult) => {
    const checkLabels = [
      'Privacy Shield',
      'Safety Check',
      'Spam Detection',
      'Quality Review',
      'Duplicate Detection',
      'Priority Classification',
      'Department Routing',
      'AI Summary',
      'Resolution Estimate',
      'Risk Assessment',
    ];

    for (let i = 0; i < checkLabels.length; i++) {
      setChecks(prev => prev.map((c, idx) =>
        idx === i ? { ...c, status: 'checking' as const } : c
      ));
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));

      let status: CheckItem['status'] = 'pass';
      let detail = '';

      switch (i) {
        case 0:
          status = finalResult.checks.privacy.pass ? 'pass' : 'fail';
          detail = finalResult.checks.privacy.issues.join('; ');
          break;
        case 1:
          status = finalResult.checks.safety.pass ? 'pass' : 'fail';
          detail = finalResult.checks.safety.issues.join('; ');
          break;
        case 2:
          status = finalResult.checks.spam.pass ? 'pass' : 'warn';
          detail = finalResult.checks.spam.issues.join('; ');
          break;
        case 3:
          status = finalResult.checks.quality.pass ? 'pass' : 'warn';
          detail = finalResult.checks.quality.issues.join('; ');
          break;
        case 4:
          status = finalResult.checks.duplicates.count === 0 ? 'pass' : 'warn';
          detail = finalResult.checks.duplicates.count > 0
            ? `${finalResult.checks.duplicates.count} similar post(s) found`
            : 'No duplicates found';
          break;
        case 5:
          status = 'pass';
          detail = `Priority: ${finalResult.analysis.priority}`;
          break;
        case 6:
          status = 'pass';
          detail = `Routed to: ${finalResult.analysis.department}`;
          break;
        case 7:
          status = 'pass';
          detail = finalResult.analysis.summary;
          break;
        case 8:
          status = 'pass';
          detail = `Est. resolution: ${finalResult.analysis.estimated_resolution_time}`;
          break;
        case 9:
          status = finalResult.risk_score >= 70 ? 'fail' : finalResult.risk_score >= 30 ? 'warn' : 'pass';
          detail = `Risk score: ${finalResult.risk_score}/100`;
          break;
      }

      setChecks(prev => prev.map((c, idx) =>
        idx === i ? { ...c, status, detail: detail || undefined } : c
      ));
      await new Promise(r => setTimeout(r, 100));
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !content) return;

    setPhase('running');
    setResult(null);
    setError(null);
    setChecks(prev => prev.map(c => ({ ...c, status: 'pending' as const, detail: undefined })));

    const runCheck = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/pre-publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(content),
        });
        const data: PrePublishResult = await res.json();
        setResult(data);
        await animateChecks(data);
        setPhase('result');
      } catch (err) {
        console.error('Pre-publish check failed:', err);
        setError('AI safety check could not complete. Content is held for admin review to ensure safety.');
        const fallback: PrePublishResult = {
          decision: 'high_risk',
          risk_score: 70,
          reason: 'Pre-publish check unreachable — content held for admin review',
          checks: { privacy: { pass: false, issues: ['Check unavailable'] }, safety: { pass: false, issues: ['Check unavailable'] }, spam: { pass: false, issues: ['Check unavailable'] }, quality: { pass: false, issues: ['Check unavailable'] }, duplicates: { count: 0, items: [] } },
          analysis: { priority: 'high', department: 'Other', category: 'Other', summary: 'Moderation system unreachable', estimated_resolution_time: '4-8 hours', llm_analyzed: false },
          review_id: null,
          elapsed_ms: 0,
        };
        setResult(fallback);
        setPhase('result');
      }
    };

    runCheck();
  }, [isOpen, content, animateChecks]);

  const handleProceed = () => {
    if (result) onApproved(result);
    onClose();
  };

  const statusIcon = (s: CheckItem['status']) => {
    switch (s) {
      case 'pending': return <div className="w-4 h-4 rounded-full border border-border" />;
      case 'checking': return <Loader2 size={16} className="animate-spin text-accent" />;
      case 'pass': return <CheckCircle size={16} className="text-good" />;
      case 'warn': return <AlertTriangle size={16} className="text-warn" />;
      case 'fail': return <XCircle size={16} className="text-bad" />;
    }
  };

  const decisionConfig = {
    safe: { icon: <ShieldCheck size={28} className="text-good" />, title: 'Content Approved', border: 'border-good/30', bg: 'bg-good/5', textColor: 'text-good' },
    revision: { icon: <ShieldAlert size={28} className="text-warn" />, title: 'Changes Needed', border: 'border-warn/30', bg: 'bg-warn/5', textColor: 'text-warn' },
    high_risk: { icon: <ShieldX size={28} className="text-bad" />, title: 'Sent for Review', border: 'border-bad/30', bg: 'bg-bad/5', textColor: 'text-bad' },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          aria-modal="true"
          role="dialog"
          aria-labelledby="prepulish-dialog-title"
          aria-describedby="prepulish-dialog-desc"
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full max-w-lg bg-surface rounded-xl border border-border shadow-2xl overflow-hidden outline-none"
          >
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-soft border border-accent/20 flex items-center justify-center">
              <Shield size={20} className="text-accent" />
            </div>
            <div>
              <h3 id="prepulish-dialog-title" className="text-sm font-semibold text-ink">AI Pre-Publish Safety Agent</h3>
              <p id="prepulish-dialog-desc" className="text-xs text-ink3 mt-0.5">Analyzing your content before publication</p>
            </div>
            <div className="ml-auto">
              {phase === 'running' && (
                <div className="flex items-center gap-2 text-xs text-ink3">
                  <Loader2 size={14} className="animate-spin" />
                  Analyzing...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Checks */}
        <div className="p-5 space-y-2">
          {checks.map((check, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                check.status === 'checking' ? 'bg-accent-soft border border-accent/10' :
                check.status === 'fail' ? 'bg-bad/5 border border-bad/10' :
                check.status === 'warn' ? 'bg-warn/5 border border-warn/10' :
                'border border-transparent'
              }`}
            >
              <span className="text-ink3">{check.icon}</span>
              <span className="text-xs font-medium text-ink flex-1">{check.label}</span>
              {statusIcon(check.status)}
              {check.detail && (
                <span className="text-[11px] text-ink3 max-w-[200px] truncate">{check.detail}</span>
              )}
            </motion.div>
          ))}
        </div>

        {/* Result */}
        {phase === 'result' && result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={`p-5 border-t border-border ${decisionConfig[result.decision].bg}`}
          >
            <div className="flex items-center gap-3 mb-3">
              {decisionConfig[result.decision].icon}
              <div>
                <h4 className={`text-sm font-semibold ${decisionConfig[result.decision].textColor}`}>
                  {decisionConfig[result.decision].title}
                </h4>
                <p className="text-xs text-ink3 mt-0.5">{result.reason}</p>
              </div>
            </div>

            {/* Analysis Details */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-surface rounded-lg p-2 border border-border">
                <span className="text-[10px] text-ink3 uppercase tracking-wide">Priority</span>
                <p className="text-xs font-medium text-ink capitalize">{result.analysis.priority}</p>
              </div>
              <div className="bg-surface rounded-lg p-2 border border-border">
                <span className="text-[10px] text-ink3 uppercase tracking-wide">Department</span>
                <p className="text-xs font-medium text-ink">{result.analysis.department}</p>
              </div>
              <div className="bg-surface rounded-lg p-2 border border-border">
                <span className="text-[10px] text-ink3 uppercase tracking-wide">Category</span>
                <p className="text-xs font-medium text-ink">{result.analysis.category}</p>
              </div>
              <div className="bg-surface rounded-lg p-2 border border-border">
                <span className="text-[10px] text-ink3 uppercase tracking-wide">Resolution</span>
                <p className="text-xs font-medium text-ink">{result.analysis.estimated_resolution_time}</p>
              </div>
            </div>

            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-warn/5 border border-warn/20">
                <p className="text-xs text-warn">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              {result.decision === 'safe' && (
                <button
                  onClick={handleProceed}
                  className="flex-1 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-all"
                >
                  Publish Now
                </button>
              )}
              {result.decision === 'revision' && (
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-ink hover:bg-surface2 transition-colors"
                >
                  Go Back & Edit
                </button>
              )}
              {result.decision === 'high_risk' && (
                <div className="flex-1 text-center">
                  <p className="text-xs text-ink3 mb-2">This content has been sent to the administrator for review. It will appear once approved.</p>
                  <button
                    onClick={onClose}
                    className="py-2.5 px-6 rounded-lg border border-border text-sm font-medium text-ink hover:bg-surface2 transition-colors"
                  >
                    Understood
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Running indicator */}
        {phase === 'running' && (
          <div className="p-4 border-t border-border">
            <div className="w-full bg-surface2 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-full bg-accent rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 3, ease: 'easeInOut' }}
              />
            </div>
          </div>
        )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
