/**
 * Sandboxed Scripting für Canvas-Buttons: User-Skripte laufen in einem
 * Web Worker ohne DOM-/Netzwerk-Zugriff. Die API sammelt Operationen ein,
 * die der Main-Thread anschließend über den Host ausführt.
 *
 * Script-API:
 *   sendOsc('/adresse arg1 arg2')      OSC an die konfigurierten Out-Ziele
 *   command('play'|'stop'|'continue'|'nextSong'|'prevSong'|'jumpNow')
 *   shared('key')                      geteilten Wert lesen
 *   setShared('key', wert)             geteilten Wert setzen (broadcastet)
 *   transport                          {isPlaying, positionBeats, bar, beat, bpm}
 *   log('text')                        Debug-Ausgabe in die Browser-Konsole
 */

import type { TransportState } from '@unableset/shared';

export type ScriptOp =
  | { op: 'sendOsc'; line: string }
  | { op: 'command'; name: string }
  | { op: 'setShared'; key: string; value: string | number | boolean }
  | { op: 'log'; text: string };

const WORKER_SOURCE = `
self.onmessage = (event) => {
  const { script, transport, shared } = event.data;
  const ops = [];
  const api = {
    sendOsc: (line) => { if (typeof line === 'string') ops.push({ op: 'sendOsc', line }); },
    command: (name) => { if (typeof name === 'string') ops.push({ op: 'command', name }); },
    shared: (key) => shared[key],
    setShared: (key, value) => {
      if (typeof key === 'string' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        shared[key] = value;
        ops.push({ op: 'setShared', key, value });
      }
    },
    log: (text) => ops.push({ op: 'log', text: String(text) }),
    transport,
  };
  try {
    const fn = new Function('sendOsc', 'command', 'shared', 'setShared', 'log', 'transport', script);
    fn(api.sendOsc, api.command, api.shared, api.setShared, api.log, api.transport);
    self.postMessage({ ok: true, ops });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error), ops });
  }
};
`;

export interface ScriptResult {
  ok: boolean;
  error?: string;
  ops: ScriptOp[];
}

/** Führt ein Skript sandboxed aus; Timeout 500 ms (Endlosschleifen-Schutz). */
export function runScript(
  script: string,
  transport: TransportState,
  shared: Record<string, string | number | boolean>,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      const blob = new Blob([WORKER_SOURCE], { type: 'text/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (error) {
      resolve({ ok: false, error: String(error), ops: [] });
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: 'Script-Timeout (500 ms)', ops: [] });
    }, 500);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data as ScriptResult);
    };
    worker.postMessage({
      script,
      transport: {
        isPlaying: transport.isPlaying,
        positionBeats: transport.positionBeats,
        bar: transport.bar,
        beat: transport.beat,
        bpm: transport.bpm,
      },
      shared: { ...shared },
    });
  });
}
