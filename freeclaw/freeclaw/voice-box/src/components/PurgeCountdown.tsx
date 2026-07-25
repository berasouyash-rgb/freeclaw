import { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

/** Live countdown until a solved post is permanently auto-deleted (resets on activity) */
export default function PurgeCountdown({ purgeAt }: { purgeAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(iv);
  }, []);

  const ms = +new Date(purgeAt) - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const label = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  const urgentSoon = ms < 86400000;

  return (
    <span className="chip !text-[10px] vb-rise" style={urgentSoon ? { color: '#dc4b4b', borderColor: 'rgba(220,75,75,0.3)' } : undefined}
      title="Solved posts are permanently deleted after 5 days of no activity. Any comment or reaction resets this countdown.">
      <Timer size={10} className={urgentSoon ? 'vb-trend-bounce' : ''} /> auto-deletes in {label}
    </span>
  );
}
