import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

/** Remove the HTML splash. Safe to call multiple times. */
function killSplash() {
  const splash = document.getElementById('vb-splash');
  if (splash) {
    splash.classList.add('vb-hide');
    setTimeout(() => splash.remove(), 400);
  }
}

/** Show a fatal-error screen instead of hanging on the splash forever.
 *  Uses safe DOM construction (no innerHTML) to prevent XSS. */
function showFatal(message: string) {
  const splash = document.getElementById('vb-splash');
  if (!splash) return;
  // Clear any existing children safely
  splash.replaceChildren();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'text-align:center;max-width:320px;padding:24px';

  const icon = document.createElement('p');
  icon.style.cssText = 'font-size:40px;margin:0';
  icon.textContent = '\uD83D\uDEE0\uFE0F'; // 🛠️

  const title = document.createElement('p');
  title.style.cssText = 'font-weight:700;font-size:16px;margin:12px 0 6px;color:#171724';
  title.textContent = "Couldn't start Voice Box";

  const detail = document.createElement('p');
  detail.style.cssText = 'font-size:12px;color:#8e8ea5;margin:0 0 16px;word-break:break-word';
  detail.textContent = String(message).slice(0, 160);

  const btn = document.createElement('button');
  btn.style.cssText = 'padding:10px 22px;border-radius:10px;border:0;background:#5652d6;color:#fff;font-size:13px;font-weight:600;cursor:pointer';
  btn.textContent = 'Reload';
  btn.addEventListener('click', () => location.reload());

  wrapper.append(icon, title, detail, btn);
  splash.appendChild(wrapper);
}

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Primary: remove splash after first painted frame
  requestAnimationFrame(() => requestAnimationFrame(killSplash));
  // Backups: window load + hard 3s ceiling (React is mounted synchronously above,
  // so if we reach here the app IS running — never leave the splash up)
  window.addEventListener('load', killSplash);
  setTimeout(killSplash, 3000);
} catch (err: any) {
  console.error('[VoiceBox] fatal boot error:', err);
  showFatal(err?.message || 'Unknown startup error');
}

// Any uncaught error before splash removal → visible error, not a dead spinner
window.addEventListener('error', (e) => {
  if (document.getElementById('vb-splash') && !document.getElementById('vb-splash')!.classList.contains('vb-hide')) {
    showFatal(e.message || 'Script error');
  }
});
