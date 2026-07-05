/**
 * Lyrics-/Teleprompter-View: große Schrift, Auto-Scroll proportional zum
 * Song-Fortschritt, aktuelle Zeile hervorgehoben. Zeilen mit führendem "."
 * werden als Akkordzeile gerendert. Lyrics liegen als Setlist-Override am
 * Eintrag (Projekt/Live-Session bleibt unangetastet).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveEntry,
  selectActiveSetlist,
  selectCurrentEntry,
  selectSongById,
  useAppStore,
} from '../store.js';
import { send } from '../ws.js';

export function LyricsView() {
  // Snapshot statt Objekt-erzeugender Selektoren (siehe PerformanceView)
  const state = useAppStore((s) => s);
  const currentEntry = selectCurrentEntry(state);
  const resolved = currentEntry ? resolveEntry(state, currentEntry) : undefined;
  const currentSong = selectSongById(state, state.transport.currentSongId);
  const transport = state.transport;
  const locked = state.locked;
  const setlist = selectActiveSetlist(state);
  const [editing, setEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const song = resolved ?? currentSong;
  const lyrics = resolved?.lyrics ?? '';
  const lines = useMemo(() => lyrics.split('\n'), [lyrics]);

  // Fortschritt im Song (0..1) → aktive Zeile + Auto-Scroll
  const progress =
    currentSong && currentSong.lengthBeats > 0
      ? Math.min(
          1,
          Math.max(0, (transport.positionBeats - currentSong.startBeat) / currentSong.lengthBeats),
        )
      : 0;
  const textLines = lines.filter((line) => !line.startsWith('.'));
  const activeTextIndex = Math.min(
    textLines.length - 1,
    Math.floor(progress * Math.max(1, textLines.length)),
  );

  useEffect(() => {
    if (editing || !scrollRef.current) return;
    const active = scrollRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeTextIndex, editing]);

  const saveLyrics = (text: string) => {
    if (!setlist || !currentEntry) return;
    send({
      type: 'setlistUpdate',
      setlist: {
        ...setlist,
        entries: setlist.entries.map((entry) =>
          entry.entryId === currentEntry.entryId
            ? { ...entry, overrides: { ...entry.overrides, lyrics: text } }
            : entry,
        ),
      },
    });
  };

  if (!song) {
    return (
      <p className="py-16 text-center text-stage-muted" data-testid="lyrics-view">
        Kein aktueller Song.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="lyrics-view">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-2xl font-black">{song.title}</h2>
        {!locked && currentEntry ? (
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-4 text-sm hover:bg-stage-border/40"
          >
            {editing ? 'Fertig' : lyrics ? 'Bearbeiten' : 'Lyrics hinzufügen'}
          </button>
        ) : null}
      </div>

      {editing ? (
        <textarea
          defaultValue={lyrics}
          onBlur={(event) => saveLyrics(event.target.value)}
          placeholder={'Verszeile 1\nVerszeile 2\n.C  G  Am  F   ← Zeilen mit "." sind Akkorde'}
          className="h-[60vh] w-full rounded-xl border border-stage-border bg-stage-surface p-4 font-mono text-lg"
        />
      ) : lyrics ? (
        <div
          ref={scrollRef}
          className="h-[65vh] overflow-y-auto rounded-2xl border border-stage-border bg-stage-surface px-6 py-[30vh]"
        >
          {(() => {
            let textIndex = -1;
            return lines.map((line, index) => {
              const isChord = line.startsWith('.');
              if (!isChord) textIndex += 1;
              const isActive = !isChord && textIndex === activeTextIndex;
              return isChord ? (
                <p
                  key={index}
                  className="whitespace-pre font-mono text-2xl font-bold leading-snug text-stage-accent"
                >
                  {line.slice(1)}
                </p>
              ) : (
                <p
                  key={index}
                  data-active={isActive}
                  className={`text-4xl font-semibold leading-relaxed transition-colors ${
                    isActive ? 'text-stage-text' : 'text-stage-muted/60'
                  }`}
                >
                  {line || ' '}
                </p>
              );
            });
          })()}
        </div>
      ) : (
        <p className="py-16 text-center text-stage-muted">
          Keine Lyrics für diesen Song hinterlegt.
        </p>
      )}
    </div>
  );
}
