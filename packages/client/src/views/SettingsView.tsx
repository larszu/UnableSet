/**
 * Settings-View: Jump-Modus, Safe Mode, Pre-Roll, View-Sperre, TTS-Ansage,
 * Clock-Aktionen, QR-Code für den schnellen Client-Zugang, Verbindungs-Infos.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { JUMP_MODES, type ClockRule, type JumpMode } from '@unableset/shared';
import { useAppStore } from '../store.js';
import { send } from '../ws.js';

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-stage-border bg-stage-surface p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string | undefined;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-(--color-stage-accent)"
      />
      {label}
    </label>
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
