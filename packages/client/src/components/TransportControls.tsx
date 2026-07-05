/**
 * Transport- und Queue-Steuerung: Play/Stop/Continue, Prev/Next, Jump-Buttons
 * (quantisiert läuft automatisch; „Jetzt" feuert sofort). Große Touch-Ziele.
 */

import { useAppStore, selectSongById } from '../store.js';
import { send } from '../ws.js';

function Button({
  label,
  onClick,
  accent = false,
  warn = false,
  disabled = false,
  testId,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
  warn?: boolean;
  disabled?: boolean;
  testId?: string | undefined;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-14 min-w-16 rounded-xl border px-4 text-base font-semibold transition-colors active:scale-[0.98] disabled:opacity-40 ${
        accent
          ? 'border-stage-accent bg-stage-accent/15 text-stage-accent hover:bg-stage-accent/25'
          : warn
            ? 'border-stage-warn bg-stage-warn/15 text-stage-warn hover:bg-stage-warn/25'
            : 'border-stage-border bg-stage-surface-2 text-stage-text hover:bg-stage-border/40'
      }`}
    >
      {label}
    </button>
  );
}

export function TransportControls() {
  const transport = useAppStore((s) => s.transport);
  const engine = useAppStore((s) => s.engine);
  const locked = useAppStore((s) => s.locked);
  const queuedSong = useAppStore((s) => selectSongById(s, s.engine.queued?.songId));

  if (locked) {
    return (
      <div className="rounded-xl border border-stage-border bg-stage-surface-2 px-4 py-3 text-center text-sm text-stage-muted">
        Ansicht gesperrt — Steuerung deaktiviert (Schloss oben rechts)
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          testId="btn-play"
          label={transport.isPlaying ? '❚❚ Läuft' : '▶ Play'}
          accent
          onClick={() => send({ type: 'command', command: { action: 'play' } })}
        />
        <Button
          testId="btn-stop"
          label="■ Stop"
          onClick={() => send({ type: 'command', command: { action: 'stop' } })}
        />
        <Button
          label="▶ Continue"
          onClick={() => send({ type: 'command', command: { action: 'continue' } })}
        />
        <div className="mx-1 h-10 w-px bg-stage-border" />
        <Button testId="btn-prev" label="⟨ Prev" onClick={() => send({ type: 'prevSong' })} />
        <Button testId="btn-next" label="Next ⟩" onClick={() => send({ type: 'nextSong' })} />
        {engine.safeMode ? (
          <span className="ml-auto rounded-full bg-stage-warn/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-stage-warn">
            Safe Mode
          </span>
        ) : null}
      </div>

      {engine.queued ? (
        <div
          data-testid="queue-banner"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-stage-warn/50 bg-stage-warn/10 px-4 py-3"
        >
          <span className="text-sm">
            <span className="font-bold text-stage-warn">Gecuet:</span>{' '}
            <span className="font-semibold">{queuedSong?.title ?? engine.queued.songId}</span>
            <span className="ml-2 text-stage-muted">
              Modus: {engine.jumpMode}
              {transport.isPlaying ? ' — springt an der Grenze' : ''}
            </span>
          </span>
          <div className="ml-auto flex gap-2">
            <Button testId="btn-jump-now" label="⤳ Jetzt" warn onClick={() => send({ type: 'jumpNow' })} />
            <Button label="✕" onClick={() => send({ type: 'clearQueue' })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
