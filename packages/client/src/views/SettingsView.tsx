/**
 * Settings-View: Jump-Modus, Safe Mode, Pre-Roll, View-Sperre, TTS-Ansage,
 * Clock-Aktionen, QR-Code für den schnellen Client-Zugang, Verbindungs-Infos.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  JUMP_MODES,
  type ClockRule,
  type JumpMode,
  type RemoteActionName,
} from '@unableset/shared';
import { useAppStore } from '../store.js';
import { send } from '../ws.js';
import { Button, Card, Toggle } from '../components/ui.js';

const JUMP_MODE_LABELS: Record<JumpMode, string> = {
  quantized: 'Quantisiert (nächste Taktgrenze)',
  endOfSection: 'Ende der Section',
  endOfSong: 'Ende des Songs',
  dynamic: 'Dynamisch (Section, sonst Takt)',
  manual: 'Manuell (nur „Jetzt"-Button)',
};

export function SettingsView() {
  const engine = useAppStore((s) => s.engine);
  const locked = useAppStore((s) => s.locked);
  const ttsEnabled = useAppStore((s) => s.ttsEnabled);
  const setTtsEnabled = useAppStore((s) => s.setTtsEnabled);
  const clockRules = useAppStore((s) => s.clockRules);
  const bridge = useAppStore((s) => s.bridge);
  const serverVersion = useAppStore((s) => s.serverVersion);
  const latencyMs = useAppStore((s) => s.latencyMs);

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="settings-view">
      <Card title="Playback & Jumps">
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-wider text-stage-muted">Jump-Modus</span>
          <select
            data-testid="jump-mode-select"
            value={engine.jumpMode}
            disabled={locked}
            onChange={(event) =>
              send({ type: 'setJumpMode', mode: event.target.value as JumpMode })
            }
            className="mt-1 w-full rounded-lg border border-stage-border bg-stage-surface-2 p-3 font-semibold"
          >
            {JUMP_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {JUMP_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        <Toggle
          label="Safe Mode (blockiert Sofort-Sprünge bei laufendem Playback)"
          testId="safe-mode-toggle"
          checked={engine.safeMode}
          disabled={locked}
          onChange={(checked) => send({ type: 'setSafeMode', enabled: checked })}
        />
        <Toggle
          label="Gespielte Songs ausblenden"
          checked={engine.hidePlayed}
          disabled={locked}
          onChange={(checked) => send({ type: 'setHidePlayed', enabled: checked })}
        />
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-wider text-stage-muted">
            Pre-Roll bei Section-Sprüngen (Takte): {engine.preRollBars}
          </span>
          <input
            type="range"
            min={0}
            max={8}
            value={engine.preRollBars}
            disabled={locked}
            onChange={(event) => send({ type: 'setPreRoll', bars: Number(event.target.value) })}
            className="mt-2 w-full accent-(--color-stage-accent)"
          />
        </label>
      </Card>

      <Card title="Dieses Gerät">
        <Toggle
          label="TTS-Ansage bei Songwechsel (In-Ear-Assistenz, lokal)"
          checked={ttsEnabled}
          onChange={setTtsEnabled}
        />
        <QrPanel />
      </Card>

      <Card title="Clock-Aktionen (z. B. Show-Start um 20:00)">
        <ClockRulesEditor rules={clockRules} locked={locked} />
      </Card>

      <MidiCard />
      <ProjectsCard />
      <MirrorsCard />

      <Card title="Verbindung">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-stage-muted">Host-Version</dt>
          <dd className="font-mono">{serverVersion ?? '–'}</dd>
          <dt className="text-stage-muted">Latenz</dt>
          <dd className="font-mono">{latencyMs !== null ? `${latencyMs} ms` : '–'}</dd>
          <dt className="text-stage-muted">Ableton</dt>
          <dd className="font-mono">
            {bridge?.connected ? `verbunden (Live ${bridge.liveVersion ?? '?'})` : 'getrennt'}
          </dd>
          <dt className="text-stage-muted">OSC-Ziel</dt>
          <dd className="font-mono">
            {bridge ? `${bridge.remoteAddress}:${bridge.remotePort}` : '–'}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-stage-muted">
          OSC-Fernsteuerung (TouchOSC/Companion): <code>/unableset/play</code>,{' '}
          <code>/unableset/stop</code>, <code>/unableset/next</code>, <code>/unableset/prev</code>,{' '}
          <code>/unableset/jump</code>, <code>/unableset/queue &lt;index&gt;</code> — Details in
          PROTOCOL.md.
        </p>
      </Card>
    </div>
  );
}

const LEARNABLE_ACTIONS: RemoteActionName[] = [
  'play',
  'stop',
  'continue',
  'nextSong',
  'prevSong',
  'jumpNow',
];

function MidiCard() {
  const midi = useAppStore((s) => s.midi);
  const locked = useAppStore((s) => s.locked);

  return (
    <Card title="MIDI-Controller">
      <p className="text-sm text-stage-muted">
        {midi.available
          ? `Input aktiv: ${midi.inputName ?? '?'}`
          : 'Kein MIDI-Modul geladen — Mappings bleiben editierbar (Aktivierung siehe README).'}
      </p>

      {midi.mappings.length > 0 ? (
        <ul className="space-y-1 text-sm" data-testid="midi-mappings">
          {midi.mappings.map((mapping, index) => (
            <li
              key={`${mapping.action}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-stage-border bg-stage-surface-2 px-3 py-2"
            >
              <span className="font-mono">
                {mapping.event} ch{mapping.channel} {mapping.data1}
              </span>
              <span className="text-stage-muted">→</span>
              <span className="font-semibold">{mapping.action}</span>
              {!locked ? (
                <button
                  type="button"
                  aria-label={`Mapping für ${mapping.action} löschen`}
                  onClick={() => send({ type: 'midiMappingDelete', index })}
                  className="ml-auto text-stage-danger hover:underline"
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stage-muted">Noch keine Mappings.</p>
      )}

      {!locked ? (
        <div className="flex flex-wrap gap-2">
          {LEARNABLE_ACTIONS.map((action) => (
            <Button
              key={action}
              size="sm"
              label={midi.learning === action ? `… ${action} (warte auf MIDI)` : `Learn: ${action}`}
              variant={midi.learning === action ? 'warn' : 'default'}
              disabled={!midi.available && midi.learning !== action}
              onClick={() =>
                midi.learning === action
                  ? send({ type: 'midiLearnCancel' })
                  : send({ type: 'midiLearnStart', action })
              }
            />
          ))}
        </div>
      ) : null}
      {midi.lastEvent ? (
        <p className="font-mono text-xs text-stage-muted">
          Letztes Event: status {midi.lastEvent.status} · data {midi.lastEvent.data1}/
          {midi.lastEvent.data2}
        </p>
      ) : null}
    </Card>
  );
}

function ProjectsCard() {
  const projects = useAppStore((s) => s.projects);
  const locked = useAppStore((s) => s.locked);
  const bridge = useAppStore((s) => s.bridge);
  if (projects.length === 0) return null;

  return (
    <Card title="Live-Projekte (Multi-File)">
      <ul className="space-y-2 text-sm" data-testid="projects-list">
        {projects.map((project) => (
          <li
            key={project.path}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-stage-border bg-stage-surface-2 px-3 py-2"
          >
            <span className="font-semibold">{project.name}</span>
            <span className="truncate font-mono text-xs text-stage-muted">{project.path}</span>
            {!locked ? (
              <span className="ml-auto">
                <Button
                  size="sm"
                  label="In Live öffnen"
                  onClick={() => send({ type: 'projectOpen', path: project.path })}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-stage-muted">
        Öffnet die Projektdatei auf dem Host-Rechner (Live fragt ggf. nach Speichern);
        die Bridge verbindet sich automatisch neu{bridge?.connected ? '' : ' — aktuell getrennt'}.
        Registrierung: <code>&lt;data-dir&gt;/projects.json</code>.
      </p>
    </Card>
  );
}

function MirrorsCard() {
  const mirrors = useAppStore((s) => s.mirrors);
  if (mirrors.length === 0) return null;
  return (
    <Card title="Redundanz (Backup-Rigs)">
      <ul className="space-y-2 text-sm" data-testid="mirrors-list">
        {mirrors.map((mirror) => (
          <li
            key={`${mirror.address}:${mirror.port}`}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-stage-border bg-stage-surface-2 px-3 py-2"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${mirror.connected ? 'bg-stage-ok' : 'bg-stage-danger'}`}
              aria-hidden
            />
            <span className="font-mono">
              {mirror.address}:{mirror.port}
            </span>
            <span className="ml-auto font-mono text-stage-muted">
              Drift: {mirror.driftBeats !== undefined ? `${mirror.driftBeats.toFixed(3)} Beats` : '–'}
              {' · '}Korrekturen: {mirror.corrections}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stage-muted">
        Alle Transport-/Mixer-Kommandos werden gespiegelt; Drift über der Schwelle wird
        automatisch korrigiert und stoppt, sobald die Rigs in Sync sind.
      </p>
    </Card>
  );
}

function QrPanel() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = (await (await fetch('/api/info')).json()) as { urls: string[] };
        const target = info.urls[0] ?? location.origin;
        const dataUrl = await QRCode.toDataURL(target, { margin: 1, width: 180 });
        if (!cancelled) {
          setUrl(target);
          setQrDataUrl(dataUrl);
        }
      } catch {
        // offline/kein LAN — QR ist optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!qrDataUrl) return null;
  return (
    <div className="flex items-center gap-4">
      <img src={qrDataUrl} alt="QR-Code zur Host-URL" className="rounded-lg bg-white p-1" />
      <div className="text-sm">
        <p className="font-semibold">Weitere Geräte verbinden</p>
        <p className="font-mono text-stage-muted">{url}</p>
      </div>
    </div>
  );
}

function ClockRulesEditor({ rules, locked }: { rules: ClockRule[]; locked: boolean }) {
  const update = (next: ClockRule[]) => send({ type: 'clockRulesUpdate', rules: next });

  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="text-sm text-stage-muted">Keine Regeln definiert.</p>
      ) : (
        rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="time"
              value={rule.at}
              disabled={locked}
              onChange={(event) =>
                update(rules.map((r) => (r.id === rule.id ? { ...r, at: event.target.value } : r)))
              }
              className="rounded-lg border border-stage-border bg-stage-surface-2 p-2 font-mono"
            />
            <select
              value={rule.action}
              disabled={locked}
              onChange={(event) =>
                update(
                  rules.map((r) =>
                    r.id === rule.id ? { ...r, action: event.target.value as ClockRule['action'] } : r,
                  ),
                )
              }
              className="rounded-lg border border-stage-border bg-stage-surface-2 p-2"
            >
              <option value="play">Play</option>
              <option value="stop">Stop</option>
              <option value="continue">Continue</option>
              <option value="nextSong">Nächster Song</option>
            </select>
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                update(rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))
              }
              className={`min-h-10 rounded-lg border px-3 ${
                rule.enabled
                  ? 'border-stage-ok text-stage-ok'
                  : 'border-stage-border text-stage-muted'
              }`}
            >
              {rule.enabled ? 'aktiv' : 'aus'}
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => update(rules.filter((r) => r.id !== rule.id))}
              className="min-h-10 rounded-lg border border-stage-danger/40 px-3 text-stage-danger"
            >
              ✕
            </button>
          </div>
        ))
      )}
      {!locked ? (
        <button
          type="button"
          onClick={() =>
            update([
              ...rules,
              {
                id: `rule-${Date.now().toString(36)}`,
                at: '20:00',
                action: 'play',
                enabled: true,
              },
            ])
          }
          className="min-h-11 rounded-lg border border-stage-border bg-stage-surface-2 px-4 text-sm hover:bg-stage-border/40"
        >
          + Regel hinzufügen
        </button>
      ) : null}
    </div>
  );
}
