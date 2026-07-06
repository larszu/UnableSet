#!/usr/bin/env node
/**
 * UnableSet Host — CLI-Entry.
 * Läuft headless (Node LTS) auf macOS, Windows und Raspberry Pi (arm64).
 *
 *   unableset-server [--http-port 4400] [--osc-host 127.0.0.1]
 *                    [--osc-port 11000] [--osc-listen-port 11001]
 *                    [--osc-remote-port 9000] [--data-dir ./unableset-data]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MirrorBridge, OscAbletonBridge, type AbletonBridge } from '@unableset/bridge';
import { parseConfig } from './config.js';
import { createHostApp } from './hostApp.js';
import { OscRemote } from './oscRemote.js';
import { startMdns } from './mdns.js';

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
  // Explizite Override für gepacktes Packaging (Electron setzt das)
  const override = process.env.UNABLESET_CLIENT_DIST;
  if (override && existsSync(override)) return override;
  for (const candidate of [
    join(here, '..', '..', 'client', 'dist'), // dev: packages/server/dist
    join(here, '..', 'client', 'dist'), // bundle: packages/server/dist-bundle
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const config = parseConfig(process.argv.slice(2));
const log = (message: string) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const primaryBridge = new OscAbletonBridge({
  remoteAddress: config.oscHost,
  remotePort: config.oscPort,
  localPort: config.oscListenPort,
  log,
});

// M6-Redundanz: Kommandos zusätzlich an Backup-Rigs spiegeln (--mirror)
const bridge: AbletonBridge =
  config.mirrorTargets.length > 0
    ? new MirrorBridge(primaryBridge, config.mirrorTargets, { log })
    : primaryBridge;

const clientDistPath = findClientDist();
const dataDir = resolve(config.dataDir);
const appOptions: Parameters<typeof createHostApp>[0] = {
  bridge,
  serverVersion: readServerVersion(),
  dataDir,
  oscOutTargets: config.oscOutTargets,
  ablesetPort: config.ablesetPort,
  log,
};
if (clientDistPath) appOptions.clientDistPath = clientDistPath;
const app = createHostApp(appOptions);

// OSC-Fernsteuerung (TouchOSC / Companion / Fußcontroller-Gateways)
const timeSig = () => app.store.getTransport().timeSig;
const oscRemote =
  config.oscRemotePort > 0
    ? new OscRemote(
        config.oscRemotePort,
        {
          play: () => bridge.play(),
          stop: () => bridge.stop(),
          continue: () => bridge.continuePlayback(),
          nextSong: () => app.engine.nextSong(timeSig()),
          prevSong: () => app.engine.prevSong(timeSig()),
          jumpNow: () => app.engine.jumpNow(timeSig()),
          queueEntry: (index) => {
            const setlist = app.store.getActiveSetlist();
            const entry = setlist.entries[index];
            if (entry) app.engine.queue(entry.songId, entry.entryId, undefined, timeSig());
          },
          setSafeMode: (enabled) => app.engine.setSafeMode(enabled),
        },
        log,
      )
    : null;

let stopMdns: () => void = () => {};

void app.ready.then(async () => {
  app.httpServer.listen(config.httpPort, () => {
    log(`UnableSet-Host läuft auf http://localhost:${config.httpPort}`);
    log(`Datenordner: ${dataDir}`);
    if (!clientDistPath) {
      log('Hinweis: Client nicht gebaut — nur API/WS aktiv (pnpm --filter @unableset/client build)');
    }
  });

  await oscRemote?.open().catch((error: Error) => {
    log(`OSC-Fernsteuerung nicht verfügbar: ${error.message}`);
  });

  if (config.mdns) stopMdns = await startMdns(config.httpPort, log);
  if (config.ablesetPort > 0) {
    log(
      `AbleSet-Companion-Kompatibilität: bestehendes Modul 'companion-module-leolabs-ableset' auf UDP :${config.ablesetPort} richten`,
    );
  }
  if (config.mirrorTargets.length > 0) {
    log(
      `Redundanz aktiv: spiegele Kommandos an ${config.mirrorTargets
        .map((t) => `${t.address}:${t.port}`)
        .join(', ')}`,
    );
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
  stopMdns();
  oscRemote?.close();
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
