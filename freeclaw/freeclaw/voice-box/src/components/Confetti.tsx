import { useEffect, useRef } from 'react';

/** Lightweight canvas confetti burst — no dependencies, ~60fps, auto-cleans */
export function fireConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const colors = ['#5652d6', '#7a6ff0', '#ffd166', '#16a06a', '#f06d6d'];
  const parts = Array.from({ length: 90 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 120,
    y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    size: Math.random() * 7 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    shape: Math.random() > 0.5 ? 'rect' : 'circle',
  }));
  let frame = 0;
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.42; p.rot += p.vr; p.vx *= 0.99;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color ?? '#000';
        ctx.globalAlpha = Math.max(0, 1 - frame / 110);
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    });
    frame++;
    if (frame < 115) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

/** Optional component wrapper — fires once on mount */
export default function Confetti() {
  const fired = useRef(false);
  useEffect(() => { if (!fired.current) { fired.current = true; fireConfetti(); } }, []);
  return null;
}
