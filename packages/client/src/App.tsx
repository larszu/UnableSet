import { useAppStore } from './store.js';
import { send } from './ws.js';
import { formatBeatsAsDuration } from './format.js';
import type { Song } from '@unableset/shared';

function StatusBadge({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string | undefined;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
        ok ? 'border-stage-ok/40 text-stage-ok' : 'border-stage-danger/40 text-stage-danger'
      }`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-stage-ok' : 'bg-stage-danger'}`}
        aria-hidden
      />
      <span className="font-medium">{label}</span>
      {detail ? <span className="text-stage-muted">{detail}</span> : null}
    </div>
  );
}

function TransportButton({
  label,
  onClick,
  accent = false,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-16 min-w-24 rounded-xl border px-6 text-lg font-semibold transition-colors active:scale-[0.98] ${
        accent
          ? 'border-stage-accent bg-stage-accent/15 text-stage-accent hover:bg-stage-accent/25'
          : 'border-stage-border bg-stage-surface-2 text-stage-text hover:bg-stage-border/40'
      }`}
    >
      {label}
    </button>
  );
}

function TransportPanel() {
  const transport = useAppStore((s) => s.transport);
  const songs = useAppStore((s) => s.songs);
  const currentSong = songs.find((song) => song.id === transport.currentSongId);

  return (
    <section className="rounded-2xl border border-stage-border bg-stage-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-widest text-stage-muted">Aktueller Song</p>
          <h2 className="text-4xl font-bold">{currentSong?.title ?? '–'}</h2>
          {currentSong?.description ? (
            <p className="mt-1 text-stage-muted">{currentSong.description}</p>
          ) : null}
        </div>
        <div className="text-right font-mono">
          <p className="text-5xl font-bold tabular-nums">
            {transport.bar}
            <span className="text-stage-muted">.</span>
            {transport.beat}
          </p>
          <p className="mt-1 text-stage-muted tabular-nums">
            {transport.bpm.toFixed(1)} BPM · {transport.timeSig[0]}/{transport.timeSig[1]}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <TransportButton
          label={transport.isPlaying ? '❚❚ Läuft' : '▶ Play'}
          accent
          onClick={() => send({ type: 'command', command: { action: 'play' } })}
        />
        <TransportButton
          label="■ Stop"
          onClick={() => send({ type: 'command', command: { action: 'stop' } })}
        />
        <TransportButton
          label="▶ Continue"
          onClick={() => send({ type: 'command', command: { action: 'continue' } })}
        />
        <span
          className={`ml-auto rounded-full px-4 py-2 text-sm font-semibold ${
            transport.isPlaying
              ? 'bg-stage-ok/15 text-stage-ok'
              : 'bg-stage-surface-2 text-stage-muted'
          }`}
        >
          {transport.isPlaying ? 'PLAYING' : 'STOPPED'}
        </span>
      </div>
    </section>
  );
}

function SongRow({ song, index, isCurrent }: { song: Song; index: number; isCurrent: boolean }) {
  const bpm = useAppStore((s) => s.transport.bpm);
  return (
    <li
      className={`flex min-h-16 items-center gap-4 rounded-xl border px-4 py-3 ${
        isCurrent
          ? 'border-stage-accent bg-stage-accent/10'
          : 'border-stage-border bg-stage-surface'
      }`}
    >
      <span className="w-8 text-right font-mono text-stage-muted">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-lg font-semibold ${isCurrent ? 'text-stage-accent' : ''}`}>
          {song.title}
          {song.stopAfter ? (
            <span className="ml-2 rounded bg-stage-warn/15 px-1.5 py-0.5 text-xs font-bold text-stage-warn">
              STOP
            </span>
          ) : null}
        </p>
        {song.description ? (
          <p className="truncate text-sm text-stage-muted">{song.description}</p>
        ) : null}
      </div>
      <span className="font-mono text-stage-muted tabular-nums">
        {song.lengthBeats > 0 ? formatBeatsAsDuration(song.lengthBeats, song.bpm ?? bpm) : '–'}
      </span>
    </li>
  );
}

function SetlistPanel() {
  const songs = useAppStore((s) => s.songs);
  const transport = useAppStore((s) => s.transport);
  const bpm = transport.bpm;
  const totalBeats = songs.reduce((sum, song) => sum + song.lengthBeats, 0);

  return (
    <section className="rounded-2xl border border-stage-border bg-stage-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">
          Setlist{' '}
          <span className="font-normal text-stage-muted">
            · {songs.length} Songs · {formatBeatsAsDuration(totalBeats, bpm)}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => send({ type: 'refreshLocators' })}
          className="min-h-12 rounded-lg border border-stage-border bg-stage-surface-2 px-4 text-sm font-medium hover:bg-stage-border/40"
        >
          ⟳ Locators neu laden
        </button>
      </div>
      {songs.length === 0 ? (
        <p className="py-8 text-center text-stage-muted">
          Keine Songs — Locators in Ableton anlegen und neu laden.
        </p>
      ) : (
        <ul className="space-y-2">
          {songs.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              index={index}
              isCurrent={song.id === transport.currentSongId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function App() {
  const connection = useAppStore((s) => s.connection);
  const bridge = useAppStore((s) => s.bridge);
  const latencyMs = useAppStore((s) => s.latencyMs);
  const serverVersion = useAppStore((s) => s.serverVersion);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight">
          UnableSet
          {serverVersion ? (
            <span className="ml-2 text-sm font-normal text-stage-muted">v{serverVersion}</span>
          ) : null}
        </h1>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            label="Host"
            ok={connection === 'open'}
            detail={
              connection === 'open' && latencyMs !== null ? `${latencyMs} ms` : connection
            }
          />
          <StatusBadge
            label="Ableton"
            ok={bridge?.connected ?? false}
            detail={bridge?.liveVersion ? `Live ${bridge.liveVersion}` : undefined}
          />
        </div>
      </header>

      <TransportPanel />
      <SetlistPanel />

      <footer className="mt-auto pt-4 text-center text-xs text-stage-muted">
        M0-Prototyp · Host ist die einzige Wahrheitsquelle · Reconnect automatisch
      </footer>
    </div>
  );
}
