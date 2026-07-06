/**
 * Mixer-View: Lautstärke/Mute/Solo der Ableton-Tracks direkt aus der App.
 * Sperrbar gegen versehentliches Verstellen (globales Schloss).
 */

import { useAppStore } from '../store.js';
import { send } from '../ws.js';

export function MixerView() {
  const tracks = useAppStore((s) => s.tracks);
  const locked = useAppStore((s) => s.locked);

  return (
    <div className="flex flex-col gap-4" data-testid="mixer-view">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          Mixer <span className="font-normal text-stage-muted">· {tracks.length} Tracks</span>
        </h2>
        {!locked ? (
          <button
            type="button"
            data-testid="mixer-refresh"
            onClick={() => send({ type: 'mixerRefresh' })}
            className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-4 text-sm hover:bg-stage-border/40"
          >
            ⟳ Aktualisieren
          </button>
        ) : null}
      </div>

      {tracks.length === 0 ? (
        <p className="py-12 text-center text-stage-muted">
          Keine Tracks geladen — Verbindung zu Ableton prüfen und aktualisieren.
        </p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((track) => (
            <li
              key={track.index}
              data-testid={`track-${track.index}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-stage-border bg-stage-surface px-4 py-3"
            >
              <span className="w-40 truncate font-semibold">{track.name}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                defaultValue={track.volume}
                disabled={locked}
                onChange={(event) =>
                  send({
                    type: 'mixerSet',
                    trackIndex: track.index,
                    field: 'volume',
                    value: Number(event.target.value),
                  })
                }
                className="h-3 min-w-40 flex-1 accent-(--color-stage-accent)"
                aria-label={`Lautstärke ${track.name}`}
              />
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  send({
                    type: 'mixerSet',
                    trackIndex: track.index,
                    field: 'mute',
                    value: !track.mute,
                  })
                }
                className={`min-h-11 w-14 rounded-lg border font-bold ${
                  track.mute
                    ? 'border-stage-danger bg-stage-danger/20 text-stage-danger'
                    : 'border-stage-border bg-stage-surface-2 text-stage-muted'
                }`}
              >
                M
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  send({
                    type: 'mixerSet',
                    trackIndex: track.index,
                    field: 'solo',
                    value: !track.solo,
                  })
                }
                className={`min-h-11 w-14 rounded-lg border font-bold ${
                  track.solo
                    ? 'border-stage-warn bg-stage-warn/20 text-stage-warn'
                    : 'border-stage-border bg-stage-surface-2 text-stage-muted'
                }`}
              >
                S
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
