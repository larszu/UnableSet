/**
 * Performance-View (Bühne): großer aktueller Song, Section-Fortschritt,
 * Bar/Beat + Beat-Flash, Restzeiten, nächster Song. Bewusst reduziert.
 */

import { useEffect, useRef, useState } from 'react';
import { sectionAtBeat } from '@unableset/shared';
import {
  resolveEntry,
  selectActiveSetlist,
  selectCurrentEntry,
  selectRemainingBeats,
  selectSongById,
  useAppStore,
} from '../store.js';
import { formatBeatsAsDuration, formatTimecode } from '../format.js';
import { SongProgress } from '../components/SongProgress.js';
import { TransportControls } from '../components/TransportControls.js';
import { announceSong } from '../tts.js';

function BeatFlash() {
  const beat = useAppStore((s) => s.transport.beat);
  const isPlaying = useAppStore((s) => s.transport.isPlaying);
  const [flash, setFlash] = useState(false);
  const prevBeat = useRef(beat);

  useEffect(() => {
    if (beat !== prevBeat.current) {
      prevBeat.current = beat;
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 90);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [beat]);

  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 rounded-full transition-colors ${
        isPlaying ? (flash ? (beat === 1 ? 'bg-stage-accent' : 'bg-stage-ok') : 'bg-stage-surface-2') : 'bg-stage-surface-2'
      }`}
    />
  );
}

export function PerformanceView() {
  // Kompletten Store-Snapshot abonnieren (stabile Referenz) und abgeleitete
  // Objekte im Render berechnen — Selektoren, die pro Aufruf neue Objekte
  // erzeugen, würden mit useSyncExternalStore endlos re-rendern.
  const state = useAppStore((s) => s);
  const transport = state.transport;
  const currentSong = selectSongById(state, transport.currentSongId);
  const currentEntry = selectCurrentEntry(state);
  const resolvedCurrent = currentEntry ? resolveEntry(state, currentEntry) : undefined;
  const nextEntryTitle = (() => {
    const setlist = selectActiveSetlist(state);
    if (!setlist) return undefined;
    const playable = setlist.entries.filter((entry) => resolveEntry(state, entry)?.skip !== true);
    const index = playable.findIndex((entry) => entry.entryId === state.engine.currentEntryId);
    const next = playable[index + 1];
    return next ? resolveEntry(state, next)?.title : undefined;
  })();
  const queuedSong = selectSongById(state, transport.queuedSongId);
  const remainingBeats = selectRemainingBeats(state);
  const ttsEnabled = state.ttsEnabled;

  const display = resolvedCurrent ?? currentSong;
  const currentSection = currentSong
    ? sectionAtBeat(currentSong, transport.positionBeats)
    : undefined;
  const songRemaining = currentSong
    ? Math.max(0, currentSong.startBeat + currentSong.lengthBeats - transport.positionBeats)
    : 0;

  useEffect(() => {
    announceSong(display?.title, ttsEnabled);
  }, [display?.title, ttsEnabled]);

  return (
    <div className="flex flex-col gap-4" data-testid="performance-view">
      <section
        className="rounded-2xl border border-stage-border bg-stage-surface p-6"
        style={display?.color ? { borderColor: display.color } : undefined}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm uppercase tracking-widest text-stage-muted">Aktueller Song</p>
            <h2 className="truncate text-5xl font-black" data-testid="current-song-title">
              {display?.title ?? '–'}
            </h2>
            <p className="mt-2 text-lg text-stage-muted">
              {currentSection ? (
                <>
                  <span className="font-semibold text-stage-accent">{currentSection.name}</span>
                  {' · '}
                </>
              ) : null}
              {display?.description ?? ''}
            </p>
            {display?.notes ? (
              <p className="mt-1 whitespace-pre-line text-stage-warn">{display.notes}</p>
            ) : null}
          </div>
          <div className="text-right font-mono">
            <div className="flex items-center justify-end gap-3">
              <BeatFlash />
              <p className="text-6xl font-bold tabular-nums" data-testid="bar-beat">
                {transport.bar}
                <span className="text-stage-muted">.</span>
                {transport.beat}
              </p>
            </div>
            <p className="mt-1 text-stage-muted tabular-nums">
              {transport.bpm.toFixed(1)} BPM · {transport.timeSig[0]}/{transport.timeSig[1]} ·{' '}
              {formatTimecode(transport.positionBeats, transport.bpm)}
            </p>
          </div>
        </div>

        {currentSong ? (
          <div className="mt-5">
            <SongProgress song={currentSong} big />
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <Stat label="Rest im Song" value={formatBeatsAsDuration(songRemaining, transport.bpm)} />
          <Stat label="Rest im Set" value={formatBeatsAsDuration(remainingBeats, transport.bpm)} />
          <Stat
            label="Nächster Song"
            value={queuedSong ? `⤳ ${queuedSong.title}` : (nextEntryTitle ?? '–')}
            accent={Boolean(queuedSong)}
          />
          <Stat
            label="Status"
            value={transport.isPlaying ? 'PLAYING' : 'STOPPED'}
            accent={transport.isPlaying}
          />
        </div>
      </section>

      <TransportControls />
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-stage-border bg-stage-surface-2 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-stage-muted">{label}</p>
      <p className={`truncate text-xl font-bold tabular-nums ${accent ? 'text-stage-ok' : ''}`}>
        {value}
      </p>
    </div>
  );
}
