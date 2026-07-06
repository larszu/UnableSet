/**
 * Canvas-View (M7): eigene Steuer-Oberfläche pro Gerät — Buttons (Kommando,
 * OSC oder sandboxed Script) und Live-Anzeigen in einem Raster. Layout wird
 * pro Gerät gespeichert (localStorage) und ist als JSON exportierbar.
 */

import { useEffect, useState } from 'react';
import { parseOscLine, type RemoteActionName } from '@unableset/shared';
import { selectSongById, useAppStore } from '../store.js';
import { send } from '../ws.js';
import { Button, IconButton, LabeledTextarea } from '../components/ui.js';
import { runScript } from '../canvas/scriptRunner.js';

type WidgetKind = 'command' | 'osc' | 'script' | 'display';
type DisplayKind = 'song' | 'next' | 'barbeat' | 'status';

interface CanvasWidget {
  id: string;
  kind: WidgetKind;
  label: string;
  /** command: Aktionsname · osc: OSC-Zeile · script: JS · display: DisplayKind */
  value: string;
  size: 1 | 2 | 3;
  color?: string;
}

const STORAGE_KEY = 'unableset-canvas';
const COMMANDS: RemoteActionName[] = ['play', 'stop', 'continue', 'nextSong', 'prevSong', 'jumpNow'];
const WIDGET_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa'];

function loadWidgets(): CanvasWidget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as CanvasWidget[];
  } catch {
    // defekt → Default
  }
  return [
    { id: 'w1', kind: 'display', label: 'Song', value: 'song', size: 3 },
    { id: 'w2', kind: 'command', label: '▶ Play', value: 'play', size: 1, color: '#34d399' },
    { id: 'w3', kind: 'command', label: '■ Stop', value: 'stop', size: 1, color: '#f87171' },
    { id: 'w4', kind: 'command', label: 'Next ⟩', value: 'nextSong', size: 1 },
  ];
}

function saveWidgets(widgets: CanvasWidget[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch {
    // unkritisch
  }
}

let widgetCounter = 0;

export function CanvasView() {
  const locked = useAppStore((s) => s.locked);
  const [widgets, setWidgets] = useState<CanvasWidget[]>(loadWidgets);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);

  useEffect(() => saveWidgets(widgets), [widgets]);

  const update = (id: string, patch: Partial<CanvasWidget>) =>
    setWidgets((current) => current.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const move = (id: string, delta: number) =>
    setWidgets((current) => {
      const index = current.findIndex((w) => w.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });

  const fire = async (widget: CanvasWidget) => {
    setScriptError(null);
    if (widget.kind === 'command') {
      runCommand(widget.value);
    } else if (widget.kind === 'osc') {
      const message = parseOscLine(widget.value);
      if (message) send({ type: 'sendOsc', message });
    } else if (widget.kind === 'script') {
      const { transport, shared } = useAppStore.getState();
      const result = await runScript(widget.value, transport, shared);
      if (!result.ok && result.error) setScriptError(result.error);
      for (const op of result.ops) {
        if (op.op === 'sendOsc') {
          const message = parseOscLine(op.line);
          if (message) send({ type: 'sendOsc', message });
        } else if (op.op === 'command') {
          runCommand(op.name);
        } else if (op.op === 'setShared') {
          send({ type: 'sharedSet', key: op.key, value: op.value });
        } else if (op.op === 'log') {
          console.info('[Canvas-Script]', op.text);
        }
      }
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="canvas-view">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">
          Canvas <span className="font-normal text-stage-muted">· eigene Steuer-Oberfläche</span>
        </h2>
        {!locked ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              label="+ Button"
              onClick={() => {
                widgetCounter += 1;
                const id = `w${Date.now().toString(36)}-${widgetCounter}`;
                setWidgets([
                  ...widgets,
                  { id, kind: 'command', label: 'Neuer Button', value: 'play', size: 1 },
                ]);
                setEditingId(id);
              }}
            />
            <Button
              size="sm"
              label="Export/Import"
              onClick={() => {
                const json = prompt('Canvas-Layout (JSON) — bearbeiten oder einfügen:', JSON.stringify(widgets));
                if (!json) return;
                try {
                  const parsed = JSON.parse(json) as CanvasWidget[];
                  if (Array.isArray(parsed)) setWidgets(parsed);
                } catch {
                  alert('Ungültiges JSON');
                }
              }}
            />
          </div>
        ) : null}
      </div>

      {scriptError ? (
        <p role="alert" className="rounded-lg border border-stage-danger/40 bg-stage-danger/10 px-3 py-2 text-sm text-stage-danger">
          Script-Fehler: {scriptError}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {widgets.map((widget) => (
          <div
            key={widget.id}
            className={widget.size === 3 ? 'col-span-3 sm:col-span-6' : widget.size === 2 ? 'col-span-2' : 'col-span-1'}
          >
            {widget.kind === 'display' ? (
              <DisplayWidget widget={widget} />
            ) : (
              <button
                type="button"
                onClick={() => void fire(widget)}
                disabled={locked && false}
                className="min-h-20 w-full rounded-2xl border-2 px-3 text-lg font-bold transition-colors active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stage-accent"
                style={{
                  borderColor: widget.color ?? 'var(--color-stage-border)',
                  backgroundColor: widget.color ? `${widget.color}22` : 'var(--color-stage-surface-2)',
                  color: widget.color ?? 'var(--color-stage-text)',
                }}
              >
                {widget.label}
              </button>
            )}
            {!locked ? (
              <div className="mt-1 flex items-center justify-center gap-1">
                <IconButton label="←" ariaLabel="Nach links" onClick={() => move(widget.id, -1)} />
                <IconButton
                  label="✎"
                  ariaLabel="Widget bearbeiten"
                  onClick={() => setEditingId(editingId === widget.id ? null : widget.id)}
                />
                <IconButton label="→" ariaLabel="Nach rechts" onClick={() => move(widget.id, 1)} />
              </div>
            ) : null}
            {editingId === widget.id && !locked ? (
              <WidgetEditor
                widget={widget}
                onChange={(patch) => update(widget.id, patch)}
                onDelete={() => {
                  setWidgets(widgets.filter((w) => w.id !== widget.id));
                  setEditingId(null);
                }}
              />
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-xs text-stage-muted">
        Script-API: <code>sendOsc('/adr 1')</code>, <code>command('play')</code>,{' '}
        <code>shared('key')</code> / <code>setShared('key', wert)</code>, <code>transport</code>,{' '}
        <code>log()</code> — läuft sandboxed im Web Worker (kein DOM/Netz, 500-ms-Timeout).
      </p>
    </div>
  );
}

function runCommand(name: string): void {
  switch (name) {
    case 'play':
      send({ type: 'command', command: { action: 'play' } });
      break;
    case 'stop':
      send({ type: 'command', command: { action: 'stop' } });
      break;
    case 'continue':
      send({ type: 'command', command: { action: 'continue' } });
      break;
    case 'nextSong':
      send({ type: 'nextSong' });
      break;
    case 'prevSong':
      send({ type: 'prevSong' });
      break;
    case 'jumpNow':
      send({ type: 'jumpNow' });
      break;
  }
}

function DisplayWidget({ widget }: { widget: CanvasWidget }) {
  const state = useAppStore((s) => s);
  const song = selectSongById(state, state.transport.currentSongId);
  let text = '–';
  switch (widget.value as DisplayKind) {
    case 'song':
      text = song?.title ?? '–';
      break;
    case 'next': {
      const setlist = state.setlists.find((s) => s.id === state.activeSetlistId);
      const index = setlist?.entries.findIndex((e) => e.entryId === state.engine.currentEntryId) ?? -1;
      const next = setlist?.entries[index + 1];
      text = next ? (state.songs.find((s) => s.id === next.songId)?.title ?? '–') : '–';
      break;
    }
    case 'barbeat':
      text = `${state.transport.bar}.${state.transport.beat}`;
      break;
    case 'status':
      text = state.transport.isPlaying ? 'PLAYING' : 'STOPPED';
      break;
  }
  return (
    <div className="flex min-h-20 w-full flex-col items-center justify-center rounded-2xl border-2 border-stage-border bg-stage-surface px-3">
      <span className="text-[10px] uppercase tracking-widest text-stage-muted">{widget.label}</span>
      <span className="truncate text-2xl font-black tabular-nums">{text}</span>
    </div>
  );
}

function WidgetEditor({
  widget,
  onChange,
  onDelete,
}: {
  widget: CanvasWidget;
  onChange: (patch: Partial<CanvasWidget>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-stage-border bg-stage-surface p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <select
          value={widget.kind}
          onChange={(event) => onChange({ kind: event.target.value as WidgetKind })}
          className="rounded-lg border border-stage-border bg-stage-surface-2 p-2"
          aria-label="Widget-Typ"
        >
          <option value="command">Kommando</option>
          <option value="osc">OSC</option>
          <option value="script">Script</option>
          <option value="display">Anzeige</option>
        </select>
        <select
          value={widget.size}
          onChange={(event) => onChange({ size: Number(event.target.value) as 1 | 2 | 3 })}
          className="rounded-lg border border-stage-border bg-stage-surface-2 p-2"
          aria-label="Breite"
        >
          <option value={1}>Schmal</option>
          <option value={2}>Mittel</option>
          <option value={3}>Volle Breite</option>
        </select>
        {WIDGET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Farbe ${color}`}
            onClick={() => onChange({ color: widget.color === color ? undefined : color } as Partial<CanvasWidget>)}
            className={`h-8 w-8 rounded-full border-2 ${widget.color === color ? 'border-stage-text' : 'border-transparent'}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <input
        value={widget.label}
        onChange={(event) => onChange({ label: event.target.value })}
        className="w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2"
        aria-label="Beschriftung"
      />
      {widget.kind === 'command' ? (
        <select
          value={widget.value}
          onChange={(event) => onChange({ value: event.target.value })}
          className="w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2"
          aria-label="Aktion"
        >
          {COMMANDS.map((command) => (
            <option key={command} value={command}>
              {command}
            </option>
          ))}
        </select>
      ) : widget.kind === 'display' ? (
        <select
          value={widget.value}
          onChange={(event) => onChange({ value: event.target.value })}
          className="w-full rounded-lg border border-stage-border bg-stage-surface-2 p-2"
          aria-label="Anzeige-Art"
        >
          <option value="song">Aktueller Song</option>
          <option value="next">Nächster Song</option>
          <option value="barbeat">Bar.Beat</option>
          <option value="status">Play-Status</option>
        </select>
      ) : (
        <LabeledTextarea
          label={widget.kind === 'osc' ? 'OSC-Zeile (z. B. /light/preset 3)' : 'JavaScript'}
          defaultValue={widget.value}
          onCommit={(value) => onChange({ value })}
          rows={widget.kind === 'script' ? 5 : 1}
          mono
          placeholder={
            widget.kind === 'script'
              ? "// z. B. Click-Toggle:\nconst on = !shared('click');\nsetShared('click', on);\nsendOsc('/live/track/set/mute 0 ' + (on ? 0 : 1));"
              : undefined
          }
        />
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="danger" label="Widget löschen" onClick={onDelete} />
      </div>
    </div>
  );
}
