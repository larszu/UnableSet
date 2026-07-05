/**
 * Startet den kompletten Stack für Headless-E2E/Screenshots:
 * AbletonOSC-Simulator (in-process) + UnableSet-Host (Kindprozess) mit
 * frischem Datenordner. Ports über Env überschreibbar.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = process.env.E2E_HTTP_PORT ?? '4499';
const OSC_PORT = process.env.E2E_OSC_PORT ?? '18100';
const OSC_LISTEN_PORT = process.env.E2E_OSC_LISTEN_PORT ?? '18101';

const bridgeModule = await import(
  pathToFileURL(join(root, 'packages/bridge/dist/index.js')).href
);
const { AbletonOscSimulator, demoSimulatorOptions } = bridgeModule;

const simulator = new AbletonOscSimulator(demoSimulatorOptions(Number(OSC_PORT)));
await simulator.open();
console.log(`[e2e-stack] Simulator auf UDP :${OSC_PORT}`);

const dataDir = mkdtempSync(join(tmpdir(), 'unableset-e2e-'));
const server = spawn(
  process.execPath,
  [
    join(root, 'packages/server/dist/index.js'),
    '--http-port', HTTP_PORT,
    '--osc-port', OSC_PORT,
    '--osc-listen-port', OSC_LISTEN_PORT,
    '--osc-remote-port', '0',
    '--data-dir', dataDir,
  ],
  { stdio: 'inherit' },
);

server.on('exit', (code) => {
  simulator.close();
  process.exit(code ?? 0);
});

const shutdown = () => {
  simulator.close();
  server.kill('SIGTERM');
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
