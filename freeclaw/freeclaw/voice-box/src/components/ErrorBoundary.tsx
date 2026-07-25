import { Component, type ReactNode } from 'react';

/** Catches runtime crashes so users never see a blank white page */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  override componentDidCatch(error: Error) { console.error('[VoiceBox] crash:', error); }

  override render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen grid place-items-center px-4 bg-bg">
          <div className="card max-w-sm w-full p-7 text-center vb-rise">
            <p className="text-4xl mb-3">🛠️</p>
            <h1 className="font-display font-bold text-lg">Something went wrong</h1>
            <p className="text-sm text-ink3 mt-2">A small hiccup occurred. Reloading usually fixes it — your data is safe.</p>
            <div className="flex gap-2 justify-center mt-5">
              <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload app</button>
              <button className="btn btn-ghost" onClick={() => { window.location.href = '/'; }}>Go home</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
