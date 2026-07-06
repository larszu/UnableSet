/**
 * Transport- und Queue-Steuerung: Play/Stop/Continue, Prev/Next, Jump-Buttons
 * (quantisiert läuft automatisch; „Jetzt" feuert sofort). Große Touch-Ziele.
 */

import { useAppStore, selectSongById } from '../store.js';
import { send } from '../ws.js';
import { Button } from './ui.js';

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
          ariaLabel="Play"
          variant="accent"
          onClick={() => send({ type: 'command', command: { action: 'play' } })}
        />
        <Button
          testId="btn-stop"
          label="■ Stop"
          ariaLabel="Stop"
          onClick={() => send({ type: 'command', command: { action: 'stop' } })}
        />
        <Button
          label="▶ Continue"
          ariaLabel="Continue"
          onClick={() => send({ type: 'command', command: { action: 'continue' } })}
        />
        <div className="mx-1 h-10 w-px bg-stage-border" aria-hidden />
        <Button
          testId="btn-prev"
          label="⟨ Prev"
          ariaLabel="Vorheriger Song"
          onClick={() => send({ type: 'prevSong' })}
        />
        <Button
          testId="btn-next"
          label="Next ⟩"
          ariaLabel="Nächster Song"
          onClick={() => send({ type: 'nextSong' })}
        />
        {engine.safeMode ? (
          <span className="ml-auto rounded-full bg-stage-warn/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-stage-warn">
            Safe Mode
          </span>
        ) : null}
      </div>

      {engine.queued ? (
        <div
          data-testid="queue-banner"
          role="status"
          aria-live="polite"
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
            <Button
              testId="btn-jump-now"
              label="⤳ Jetzt"
              ariaLabel="Jetzt springen"
              variant="warn"
              onClick={() => send({ type: 'jumpNow' })}
            />
            <Button label="✕" ariaLabel="Queue verwerfen" onClick={() => send({ type: 'clearQueue' })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
