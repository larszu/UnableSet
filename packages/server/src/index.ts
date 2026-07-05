#!/usr/bin/env node
/**
 * UnableSet Host — CLI-Entry.
 * Läuft headless (Node LTS) auf macOS, Windows und Raspberry Pi (arm64).
 *
 *   unableset-server [--http-port 4400] [--osc-host 127.0.0.1]
 *                    [--osc-port 11000] [--osc-listen-port 11001]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OscAbletonBridge } from '@unableset/bridge';
import { parseConfig } from './config.js';
import { createHostApp } from './hostApp.js';

const here = dirname(fileURLToPath(import.meta.url));

function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function findClientDist(): string | undefined {
  const candidate = join(here, '..', '..', 'client', 'dist');
  return existsSync(candidate) ? candidate : undefined;
}

const config = parseConfig(process.argv.slice(2));
const log = (message: string) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const bridge = new OscAbletonBridge({
  remoteAddress: config.oscHost,
  remotePort: config.oscPort,
  localPort: config.oscListenPort,
  log,
});

const clientDistPath = findClientDist();
const appOptions: Parameters<typeof createHostApp>[0] = {
  bridge,
  serverVersion: readServerVersion(),
  log,
};
if (clientDistPath) appOptions.clientDistPath = clientDistPath;
const app = createHostApp(appOptions);

app.httpServer.listen(config.httpPort, () => {
  log(`UnableSet-Host läuft auf http://localhost:${config.httpPort}`);
  if (!clientDistPath) {
    log('Hinweis: Client nicht gebaut — nur API/WS aktiv (pnpm --filter @unableset/client build)');
  }
});

bridge.connect().catch((error: Error) => {
  // Bridge-Fehler sind nie fatal — der Host läuft weiter und versucht es erneut
  log(`Bridge-Start fehlgeschlagen: ${error.message}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} empfangen — fahre herunter …`);
  await app.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Bühnen-Grundsatz: unbehandelte Fehler loggen, aber niemals hart crashen,
// solange der Prozess weiter sinnvoll arbeiten kann.
process.on('uncaughtException', (error) => {
  log(`Unbehandelter Fehler: ${error.stack ?? error.message}`);
});
process.on('unhandledRejection', (reason) => {
  log(`Unbehandelte Rejection: ${String(reason)}`);
});
