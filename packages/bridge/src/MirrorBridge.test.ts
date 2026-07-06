/**
 * M6-Redundanz-Test: MirrorBridge gegen ZWEI AbletonOSC-Simulatoren
 * (Haupt- und Backup-Rig) über echtes UDP.
 */

import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { OscAbletonBridge } from './OscAbletonBridge.js';
import { MirrorBridge } from './MirrorBridge.js';
import { AbletonOscSimulator } from './AbletonOscSimulator.js';
import type { MirrorTargetStatus } from '@unableset/shared';

async function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor-Timeout'));
      }
    }, 25);
  });
}

describe('MirrorBridge (M6, zwei Simulatoren via UDP)', () => {
  let main: AbletonOscSimulator | null = null;
  let backup: AbletonOscSimulator | null = null;
  let bridge: MirrorBridge | null = null;

  afterEach(async () => {
    await bridge?.disconnect();
    bridge = null;
    main?.close();
    backup?.close();
    main = null;
    backup = null;
  });

  async function setup(options: { correctDrift?: boolean } = {}) {
    const mainPort = await freeUdpPort();
    const backupPort = await freeUdpPort();
    const localPort = await freeUdpPort();
    const cuePoints: [string, number][] = [
      ['Song A', 0],
      ['Song B', 64],
    ];
    main = new AbletonOscSimulator({ port: mainPort, tempo: 120, cuePoints, songLengthBeats: 512 });
    backup = new AbletonOscSimulator({ port: backupPort, tempo: 120, cuePoints, songLengthBeats: 512 });
    await main.open();
    await backup.open();

    const primary = new OscAbletonBridge({
      remoteAddress: '127.0.0.1',
      remotePort: mainPort,
      localPort,
      heartbeatMs: 150,
      heartbeatTimeoutMs: 400,
      requestTimeoutMs: 400,
      positionPollMs: 40,
    });
    bridge = new MirrorBridge(primary, [{ address: '127.0.0.1', port: backupPort }], {
      heartbeatMs: 100,
      heartbeatTimeoutMs: 350,
      driftCheckMs: 120,
      driftThresholdBeats: 0.5,
      correctDrift: options.correctDrift ?? true,
    });
    await bridge.connect();
    await waitFor(() => bridge!.getStatus().connected);
    await waitFor(() => bridge!.getMirrorStatus()[0]?.connected === true);
    return { main: main!, backup: backup!, bridge: bridge! };
  }

  it('spiegelt Play/Stop und Position an das Backup-Rig', async () => {
    const { main, backup, bridge } = await setup();

    bridge.setSongPosition(64);
    bridge.play();
    await waitFor(() => main.isPlaying && backup.isPlaying);
    expect(backup.positionBeats).toBeGreaterThanOrEqual(64);

    bridge.stop();
    await waitFor(() => !main.isPlaying && !backup.isPlaying);
  });

  it('misst Drift und korrigiert automatisch über der Schwelle', async () => {
    const { backup, bridge } = await setup();

    bridge.setSongPosition(10);
    bridge.play();
    await waitFor(() => backup.isPlaying);

    // Backup künstlich 8 Beats davonlaufen lassen
    backup.positionBeats += 8;

    await waitFor(() => {
      const [status] = bridge.getMirrorStatus();
      return status.corrections > 0;
    });

    // Nach der Korrektur liegt das Backup wieder nahe am Haupt-Rig
    await waitFor(() => {
      const [status] = bridge.getMirrorStatus();
      return status.driftBeats !== undefined && Math.abs(status.driftBeats) < 1;
    });
  });

  it('greift unterhalb der Schwelle nicht ein (schaltet sich in Sync ab)', async () => {
    const { bridge } = await setup();

    bridge.setSongPosition(10);
    bridge.play();

    // Drift bleibt naturgemäß minimal — es darf keine Korrektur geben
    await new Promise((resolve) => setTimeout(resolve, 600));
    const [status] = bridge.getMirrorStatus();
    expect(status.corrections).toBe(0);
  });

  it('meldet Verbindungsverlust des Backups', async () => {
    const { backup, bridge } = await setup();

    let latest: MirrorTargetStatus[] = bridge.getMirrorStatus();
    bridge.on('mirrors', (mirrors) => {
      latest = mirrors;
    });

    backup.close();
    await waitFor(() => latest[0]?.connected === false);
  });
});
