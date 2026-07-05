import { useAppStore, type ViewTab } from './store.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useWakeLock } from './hooks/useWakeLock.js';
import { StatusBadge } from './components/ui.js';
import { PerformanceView } from './views/PerformanceView.js';
import { SetlistView } from './views/SetlistView.js';
import { LyricsView } from './views/LyricsView.js';
import { MixerView } from './views/MixerView.js';
import { SettingsView } from './views/SettingsView.js';

const TABS: { id: ViewTab; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'setlist', label: 'Setlist' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const connection = useAppStore((s) => s.connection);
  const bridge = useAppStore((s) => s.bridge);
  const latencyMs = useAppStore((s) => s.latencyMs);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const locked = useAppStore((s) => s.locked);
  const setLocked = useAppStore((s) => s.setLocked);

  useShortcuts();
  useWakeLock();

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black tracking-tight sm:text-2xl">UnableSet</h1>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            label="Host"
            ok={connection === 'open'}
            detail={connection === 'open' && latencyMs !== null ? `${latencyMs} ms` : connection}
          />
          <StatusBadge
            label="Ableton"
            ok={bridge?.connected ?? false}
            detail={bridge?.liveVersion ? `Live ${bridge.liveVersion}` : undefined}
          />
        </div>
        <button
          type="button"
          data-testid="lock-toggle"
          onClick={() => setLocked(!locked)}
          title={locked ? 'Ansicht entsperren' : 'Ansicht sperren (gegen versehentliche Bedienung)'}
          className={`ml-auto flex h-11 w-11 items-center justify-center rounded-full border text-lg ${
            locked
              ? 'border-stage-warn bg-stage-warn/15 text-stage-warn'
              : 'border-stage-border bg-stage-surface-2 text-stage-muted'
          }`}
        >
          {locked ? '🔒' : '🔓'}
        </button>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-stage-border bg-stage-surface p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`tab-${tab.id}`}
            onClick={() => setView(tab.id)}
            className={`min-h-12 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors ${
              view === tab.id
                ? 'bg-stage-accent/15 text-stage-accent'
                : 'text-stage-muted hover:bg-stage-surface-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="flex-1">
        {view === 'performance' ? <PerformanceView /> : null}
        {view === 'setlist' ? <SetlistView /> : null}
        {view === 'lyrics' ? <LyricsView /> : null}
        {view === 'mixer' ? <MixerView /> : null}
        {view === 'settings' ? <SettingsView /> : null}
      </main>

      {connection !== 'open' ? (
        <div className="fixed inset-x-0 bottom-0 bg-stage-danger px-4 py-2 text-center font-bold text-white">
          Verbindung zum Host getrennt — Reconnect läuft …
        </div>
      ) : null}
    </div>
  );
}
