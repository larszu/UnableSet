/**
 * Setlist-View (MD): Zwei-Listen-Prinzip — links die Setlist (frei sortiert,
 * Drag & Drop), rechts die Song-Bibliothek (alle Songs, durchsuchbar).
 * Overrides (Farbe/Notizen/Tags/Skip/Set) gelten nur für die Setlist,
 * nie für die Live-Session.
 */

import { useMemo, useRef, useState } from 'react';
import { oscMessagesToText, parseOscLines } from '@unableset/shared';
import type { Setlist, SetlistEntry, Song } from '@unableset/shared';
import {
  resolveEntry,
  selectActiveSetlist,
  useAppStore,
} from '../store.js';
import { send } from '../ws.js';
import { formatBeatsAsDuration } from '../format.js';
import { TransportControls } from '../components/TransportControls.js';
import { IconButton, LabeledTextarea, ToggleChip } from '../components/ui.js';

const COLOR_PALETTE = ['#f87171', '#fbbf24', '#34d399', '#38bdf8', '#a78bfa', '#f472b6'];

let entryCounter = 0;
function newEntryId(songId: string): string {
  entryCounter += 1;
  return `e${Date.now().toString(36)}-${entryCounter}-${songId}`;
}

export function SetlistView() {
  const setlist = useAppStore(selectActiveSetlist);
  const locked = useAppStore((s) => s.locked);

  return (
    <div className="flex flex-col gap-4" data-testid="setlist-view">
      <TransportControls />
      <SetlistPicker />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {setlist ? <EntryList setlist={setlist} /> : <p className="text-stage-muted">Keine Setlist.</p>}
        {!locked && setlist ? <SongLibrary setlist={setlist} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setlist-Auswahl + Import/Export
// ---------------------------------------------------------------------------

function SetlistPicker() {
  const setlists = useAppStore((s) => s.setlists);
  const activeSetlistId = useAppStore((s) => s.activeSetlistId);
  const locked = useAppStore((s) => s.locked);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  if (locked) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stage-border bg-stage-surface p-3">
      <label className="text-sm text-stage-muted" htmlFor="setlist-select">
        Setlist
      </label>
      <select
        id="setlist-select"
        data-testid="setlist-select"
        value={activeSetlistId}
        onChange={(event) => send({ type: 'setlistActivate', setlistId: event.target.value })}
        className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-3 font-semibold"
      >
        {setlists.map((setlist) => (
          <option key={setlist.id} value={setlist.id}>
            {setlist.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-3 text-sm hover:bg-stage-border/40"
        onClick={() => {
          const name = prompt('Name der neuen Setlist:', 'Neue Show');
          if (name) send({ type: 'setlistCreate', name, copyFromId: activeSetlistId });
        }}
      >
        + Neu (Kopie)
      </button>
      {activeSetlistId !== 'default' ? (
        <button
          type="button"
          className="min-h-11 rounded-lg border border-stage-danger/40 px-3 text-sm text-stage-danger hover:bg-stage-danger/10"
          onClick={() => {
            if (confirm('Setlist wirklich löschen?')) {
              send({ type: 'setlistDelete', setlistId: activeSetlistId });
            }
          }}
        >
          Löschen
        </button>
      ) : null}
      <div className="ml-auto flex gap-2">
        <a
          href="/api/setlist/export.txt"
          download="setlist.txt"
          className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-3 py-2.5 text-sm hover:bg-stage-border/40"
        >
          ⇩ Export
        </a>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-3 text-sm hover:bg-stage-border/40"
          onClick={() => setImportOpen(!importOpen)}
        >
          ⇧ Import
        </button>
      </div>
      {importOpen ? (
        <div className="w-full">
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={'# Set 1\nSongtitel 1\nSongtitel 2\n# Set 2\n…'}
            className="h-32 w-full rounded-lg border border-stage-border bg-stage-surface-2 p-3 font-mono text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-stage-accent bg-stage-accent/15 px-4 text-sm font-semibold text-stage-accent"
              onClick={() => {
                const name = prompt('Name der importierten Setlist:', 'Import');
                if (name) {
                  // CSV (BandHelper-Export) wird an Kommas/Headern erkannt
                  const isCsv = /,|;/.test(importText.split('\n')[0] ?? '');
                  send(
                    isCsv
                      ? { type: 'setlistImportCsv', name, csv: importText }
                      : { type: 'setlistImportText', name, text: importText },
                  );
                  setImportOpen(false);
                  setImportText('');
                }
              }}
            >
              Import als neue Setlist
            </button>
            <span className="self-center text-xs text-stage-muted">
              Plaintext (eine Zeile = ein Song) oder CSV (BandHelper-Export, Titel-Spalte)
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eintragsliste (Drag & Drop, Gruppen mit Zwischensummen)
// ---------------------------------------------------------------------------

function EntryList({ setlist }: { setlist: Setlist }) {
  const bpm = useAppStore((s) => s.transport.bpm);
  const engine = useAppStore((s) => s.engine);
  const locked = useAppStore((s) => s.locked);
  const state = useAppStore((s) => s);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const updateSetlist = (mutate: (entries: SetlistEntry[]) => SetlistEntry[]) => {
    send({ type: 'setlistUpdate', setlist: { ...setlist, entries: mutate([...setlist.entries]) } });
  };

  const moveEntry = (from: number, to: number) => {
    if (to < 0 || to >= setlist.entries.length || from === to) return;
    updateSetlist((entries) => {
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
      return entries;
    });
  };

  const totalBeats = setlist.entries.reduce((sum, entry) => {
    const song = resolveEntry(state, entry);
    return song && song.skip !== true ? sum + song.lengthBeats : sum;
  }, 0);

  // Gruppen-Zwischensummen (Sets)
  const groupTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of setlist.entries) {
      const song = resolveEntry(state, entry);
      if (!song || song.skip === true) continue;
      const key = entry.setGroup ?? '';
      totals.set(key, (totals.get(key) ?? 0) + song.lengthBeats);
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setlist, state.songs]);

  // Erster Eintrag jeder Set-Gruppe trägt die Überschrift (keine Render-Mutation)
  const groupHeaderFor = new Map<string, string>();
  {
    let previousGroup: string | undefined;
    for (const entry of setlist.entries) {
      if (entry.setGroup && entry.setGroup !== previousGroup) {
        groupHeaderFor.set(entry.entryId, entry.setGroup);
      }
      previousGroup = entry.setGroup;
    }
  }

  return (
    <section className="rounded-2xl border border-stage-border bg-stage-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          {setlist.name}{' '}
          <span className="font-normal text-stage-muted">
            · {setlist.entries.length} Einträge · {formatBeatsAsDuration(totalBeats, bpm)}
          </span>
        </h2>
        {!locked ? (
          <button
            type="button"
            onClick={() => send({ type: 'refreshLocators' })}
            className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-3 text-sm hover:bg-stage-border/40"
          >
            ⟳ Locators neu laden
          </button>
        ) : null}
      </div>

      {setlist.entries.length === 0 ? (
        <p className="py-8 text-center text-stage-muted">
          Leer — Songs aus der Bibliothek rechts hinzufügen.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="entry-list">
          {setlist.entries.map((entry, index) => {
            const song = resolveEntry(state, entry);
            const played = engine.playedEntryIds.includes(entry.entryId);
            if (engine.hidePlayed && played) return null;
            const groupHeader = groupHeaderFor.get(entry.entryId) ?? null;
            return (
              <li key={entry.entryId}>
                {groupHeader ? (
                  <p className="mb-1 mt-3 flex items-baseline gap-2 border-b border-stage-border pb-1 text-sm font-bold uppercase tracking-wider text-stage-muted">
                    {groupHeader}
                    <span className="font-normal normal-case">
                      {formatBeatsAsDuration(groupTotals.get(entry.setGroup ?? '') ?? 0, bpm)}
                    </span>
                  </p>
                ) : null}
                <EntryRow
                  entry={entry}
                  song={song}
                  index={index}
                  played={played}
                  expanded={expandedId === entry.entryId}
                  onToggleExpand={() =>
                    setExpandedId(expandedId === entry.entryId ? null : entry.entryId)
                  }
                  onMove={moveEntry}
                  onUpdate={updateSetlist}
                  dragIndexRef={dragIndexRef}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EntryRow({
  entry,
  song,
  index,
  played,
  expanded,
  onToggleExpand,
  onMove,
  onUpdate,
  dragIndexRef,
}: {
  entry: SetlistEntry;
  song: Song | undefined;
  index: number;
  played: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onMove: (from: number, to: number) => void;
  onUpdate: (mutate: (entries: SetlistEntry[]) => SetlistEntry[]) => void;
  dragIndexRef: React.MutableRefObject<number | null>;
}) {
  const transport = useAppStore((s) => s.transport);
  const engine = useAppStore((s) => s.engine);
  const locked = useAppStore((s) => s.locked);
  const bpm = useAppStore((s) => s.transport.bpm);

  const isCurrent = engine.currentEntryId === entry.entryId;
  const isQueued = engine.queued?.entryId === entry.entryId ||
    (engine.queued && !engine.queued.entryId && engine.queued.songId === entry.songId);

  const patchEntry = (patch: Partial<SetlistEntry>) => {
    onUpdate((entries) =>
      entries.map((candidate) =>
        candidate.entryId === entry.entryId ? { ...candidate, ...patch } : candidate,
      ),
    );
  };

  const patchOverrides = (patch: Partial<Song>) => {
    patchEntry({ overrides: { ...entry.overrides, ...patch } });
  };

  if (!song) {
    return (
      <div className="flex min-h-12 items-center gap-3 rounded-lg border border-stage-danger/40 bg-stage-surface px-3 text-sm text-stage-danger">
        Song fehlt: {entry.songId}
        {!locked ? (
          <button
            type="button"
            className="ml-auto underline"
            onClick={() => onUpdate((entries) => entries.filter((e) => e.entryId !== entry.entryId))}
          >
            entfernen
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      draggable={!locked}
      data-testid={`entry-${index}`}
      onDragStart={() => {
        dragIndexRef.current = index;
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => {
        if (dragIndexRef.current !== null) onMove(dragIndexRef.current, index);
        dragIndexRef.current = null;
      }}
      className={`rounded-xl border transition-colors [contain-intrinsic-block-size:64px] [content-visibility:auto] ${
        isQueued
          ? 'border-stage-warn bg-stage-warn/10'
          : isCurrent && transport.currentSongId === song.id
            ? 'border-stage-accent bg-stage-accent/10'
            : 'border-stage-border bg-stage-surface'
      } ${song.skip ? 'opacity-40' : ''} ${played ? 'opacity-60' : ''}`}
      style={song.color ? { borderLeftColor: song.color, borderLeftWidth: 4 } : undefined}
    >
      <div className="flex min-h-14 items-center gap-2 px-3 py-2">
        {!locked ? (
          <span className="cursor-grab select-none text-stage-muted" title="Ziehen zum Sortieren">
            ⠿
          </span>
        ) : null}
        <button
          type="button"
          data-testid={`entry-queue-${index}`}
          disabled={locked}
          onClick={() => send({ type: 'queue', songId: entry.songId, entryId: entry.entryId })}
          className="min-w-0 flex-1 text-left"
          title="Klicken zum Cuen"
        >
          <p className="truncate text-base font-semibold">
            <span className="mr-2 font-mono text-stage-muted">{index + 1}</span>
            {played ? <span className="mr-1 text-stage-ok">✓</span> : null}
            {song.title}
            {song.stopAfter ? (
              <span className="ml-2 rounded bg-stage-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-stage-warn">
                STOP
              </span>
            ) : null}
            {song.tags.map((tag) => (
              <span
                key={tag}
                className="ml-1.5 rounded bg-stage-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-stage-accent"
              >
                {tag}
              </span>
            ))}
          </p>
          {song.description ? (
            <p className="truncate text-xs text-stage-muted">{song.description}</p>
          ) : null}
        </button>
        <span className="font-mono text-sm text-stage-muted tabular-nums">
          {song.lengthBeats > 0 ? formatBeatsAsDuration(song.lengthBeats, song.bpm ?? bpm) : '–'}
        </span>
        {!locked ? (
          <div className="flex items-center gap-1">
            <IconButton
              label="↑"
              ariaLabel="Nach oben verschieben"
              onClick={() => onMove(index, index - 1)}
              testId={`entry-up-${index}`}
            />
            <IconButton
              label="↓"
              ariaLabel="Nach unten verschieben"
              onClick={() => onMove(index, index + 1)}
              testId={`entry-down-${index}`}
            />
            <IconButton
              label={expanded ? '▾' : '✎'}
              ariaLabel={expanded ? 'Editor schließen' : 'Eintrag bearbeiten'}
              onClick={onToggleExpand}
              testId={`entry-edit-${index}`}
            />
          </div>
        ) : null}
      </div>

      {expanded && !locked ? (
        <div className="space-y-3 border-t border-stage-border px-4 py-3" data-testid={`entry-editor-${index}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-stage-muted">Farbe</span>
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Farbe ${color}`}
                onClick={() => patchOverrides({ color })}
                className={`h-8 w-8 rounded-full border-2 ${song.color === color ? 'border-stage-text' : 'border-transparent'}`}
                style={{ backgroundColor: color }}
              />
            ))}
            <button
              type="button"
              onClick={() => patchOverrides({ color: undefined as unknown as string })}
              className="h-8 rounded-lg border border-stage-border px-2 text-xs text-stage-muted"
            >
              keine
            </button>
          </div>
          <LabeledTextarea
            label="Notizen"
            defaultValue={song.notes ?? ''}
            onCommit={(value) => patchOverrides({ notes: value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-wider text-stage-muted">
                Tags (Komma-getrennt)
              </span>
              <input
                defaultValue={song.tags.join(', ')}
                onBlur={(event) =>
                  patchOverrides({
                    tags: event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
                className="mt-1 w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-wider text-stage-muted">
                Set (z. B. „Set 2")
              </span>
              <input
                defaultValue={entry.setGroup ?? ''}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  onUpdate((entries) =>
                    entries.map((candidate) => {
                      if (candidate.entryId !== entry.entryId) return candidate;
                      const next = { ...candidate };
                      if (value) next.setGroup = value;
                      else delete next.setGroup;
                      return next;
                    }),
                  );
                }}
                className="mt-1 w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2 text-sm"
              />
            </label>
          </div>
          <LabeledTextarea
            label={'OSC bei Songstart (eine Zeile = eine Nachricht, z. B. "/light/preset 3 warm")'}
            defaultValue={oscMessagesToText(song.oscOnEnter ?? [])}
            onCommit={(value) => patchOverrides({ oscOnEnter: parseOscLines(value) })}
            mono
          />
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              label="Überspringen"
              active={song.skip === true}
              onClick={() => patchOverrides({ skip: song.skip !== true })}
            />
            <ToggleChip
              label="Gespielt ✓"
              active={played}
              onClick={() => send({ type: 'markPlayed', entryId: entry.entryId, played: !played })}
            />
            <button
              type="button"
              onClick={() =>
                onUpdate((entries) => entries.filter((e) => e.entryId !== entry.entryId))
              }
              className="ml-auto min-h-10 rounded-lg border border-stage-danger/40 px-3 text-sm text-stage-danger hover:bg-stage-danger/10"
            >
              Aus Setlist entfernen
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Song-Bibliothek (FULL LIST) mit Suche
// ---------------------------------------------------------------------------

function SongLibrary({ setlist }: { setlist: Setlist }) {
  const songs = useAppStore((s) => s.songs);
  const bpm = useAppStore((s) => s.transport.bpm);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return songs;
    return songs.filter((song) => {
      const haystack = [
        song.title,
        song.description ?? '',
        song.tags.join(' '),
        // Initialen-Suche: "hs" findet "Highway Star"
        song.title
          .split(/\s+/)
          .map((word) => word[0] ?? '')
          .join(''),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [songs, query]);

  const addSong = (song: Song) => {
    send({
      type: 'setlistUpdate',
      setlist: {
        ...setlist,
        entries: [...setlist.entries, { entryId: newEntryId(song.id), songId: song.id }],
      },
    });
  };

  return (
    <section className="h-fit rounded-2xl border border-stage-border bg-stage-surface p-4" data-testid="song-library">
      <h2 className="mb-2 text-lg font-bold">
        Bibliothek <span className="font-normal text-stage-muted">· {songs.length} Songs</span>
      </h2>
      <input
        value={query}
        data-testid="library-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Suche: Titel, Tags, Initialen …"
        className="mb-3 w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2.5 text-sm"
      />
      <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
        {filtered.map((song) => (
          <li key={song.id} className="[contain-intrinsic-block-size:44px] [content-visibility:auto]">
            <button
              type="button"
              onClick={() => addSong(song)}
              className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left hover:border-stage-border hover:bg-stage-surface-2"
              title="Zur Setlist hinzufügen"
            >
              <span className="text-stage-accent">＋</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{song.title}</span>
              <span className="font-mono text-xs text-stage-muted">
                {formatBeatsAsDuration(song.lengthBeats, song.bpm ?? bpm)}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="py-4 text-center text-sm text-stage-muted">Kein Treffer.</li>
        ) : null}
      </ul>
    </section>
  );
}
