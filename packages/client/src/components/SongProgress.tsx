/**
 * Fortschrittsbalken des aktuellen Songs mit Section-Segmenten + Labels.
 * Gequeuete Sections werden hervorgehoben; Klick cuet eine Section (wenn
 * nicht gesperrt).
 */

import type { Song } from '@unableset/shared';
import { useAppStore } from '../store.js';
import { send } from '../ws.js';

export function SongProgress({ song, big = false }: { song: Song; big?: boolean }) {
  const transport = useAppStore((s) => s.transport);
  const locked = useAppStore((s) => s.locked);
  const engine = useAppStore((s) => s.engine);

  const progress = song.lengthBeats > 0
    ? Math.min(1, Math.max(0, (transport.positionBeats - song.startBeat) / song.lengthBeats))
    : 0;

  const segments = song.sections.length > 0
    ? song.sections
    : [{ id: `${song.id}#full`, name: song.title, startBeat: song.startBeat, lengthBeats: song.lengthBeats }];

  return (
    <div data-testid="song-progress">
      <div className={`relative flex w-full overflow-hidden rounded-lg ${big ? 'h-16' : 'h-10'}`}>
        {segments.map((section) => {
          const width = song.lengthBeats > 0 ? (section.lengthBeats / song.lengthBeats) * 100 : 100;
          const isCurrent = transport.currentSectionId === section.id;
          const isQueued = transport.queuedSectionId === section.id;
          const isLooped = engine.loopSectionId === section.id;
          return (
            <button
              key={section.id}
              type="button"
              disabled={locked}
              title={section.name}
              onClick={() =>
                send({ type: 'queue', songId: song.id, sectionId: section.id })
              }
              style={{ width: `${width}%` }}
              className={`relative h-full border-r border-stage-bg text-left transition-colors last:border-r-0 ${
                isQueued
                  ? 'bg-stage-warn/40'
                  : isCurrent
                    ? 'bg-stage-accent/40'
                    : 'bg-stage-surface-2 hover:bg-stage-border/60'
              }`}
            >
              <span
                className={`absolute inset-x-1 top-0.5 truncate text-[10px] font-semibold uppercase tracking-wide ${
                  isCurrent ? 'text-stage-accent' : 'text-stage-muted'
                }`}
              >
                {isLooped ? '↻ ' : ''}
                {section.name}
              </span>
            </button>
          );
        })}
        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 h-full w-0.5 bg-stage-text"
          style={{ left: `${progress * 100}%` }}
        />
        <div
          className="pointer-events-none absolute top-0 h-full bg-stage-accent/15"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
