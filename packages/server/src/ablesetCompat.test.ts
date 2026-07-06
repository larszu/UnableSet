/**
 * Integrationstest der AbleSet-Companion-Kompatibilität: ein Fake-„Companion"
 * spielt exakt den Ablauf des echten Moduls nach (subscribe → Werte empfangen
 * → Commands senden) über echtes UDP. Verifiziert, dass UnableSet den
 * AbleSet-OSC-Adressraum korrekt bedient.
 */

import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import osc from 'osc';
import type { OscPacket, UDPPort } from 'osc';
import { createHostApp, type HostApp } from './hostApp.js';
import { FakeBridge } from './testUtil.js';

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

function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
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
    }, 20);
  });
}

/** Fake-Companion: sendet an den Compat-Port, empfängt Werte auf eigenem Port. */
class FakeCompanion {
  port: UDPPort;
  received: OscPacket[] = [];

  constructor(private readonly localPort: number, private readonly targetPort: number) {
    this.port = new osc.UDPPort({
      localAddress: '127.0.0.1',
      localPort: localPort,
      remoteAddress: '127.0.0.1',
      remotePort: targetPort,
      metadata: true,
    });
    this.port.on('message', (packet: OscPacket) => this.received.push(packet));
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.port.once('ready', resolve);
      this.port.open();
    });
  }

  send(address: string, args: { type: string; value: unknown }[] = []): void {
    this.port.send({ address, args });
  }

  close(): void {
    this.port.close();
  }

  /** Letzter Wert einer Adresse (Args als Roh-Werte). */
  value(address: string): unknown[] | undefined {
    const packet = [...this.received].reverse().find((p) => p.address === address);
    return packet?.args.map((a) => a.value);
  }
}

describe('AbleSet-Companion-Kompatibilität (Integration, UDP)', () => {
  let app: HostApp | null = null;
  let companion: FakeCompanion | null = null;

  afterEach(async () => {
    companion?.close();
    companion = null;
    await app?.close();
    app = null;
  });

  async function setup(): Promise<{ bridge: FakeBridge; companion: FakeCompanion }> {
    const ablesetPort = await freeUdpPort();
    const companionPort = await freeUdpPort();

    const bridge = new FakeBridge();
    bridge.cuePoints = [
      { name: 'Alpha', timeBeats: 0 },
      { name: 'Beta {Ballade}', timeBeats: 64 },
      { name: 'Gamma', timeBeats: 128 },
    ];
    app = createHostApp({ bridge, serverVersion: 'test', ablesetPort });
    await app.ready;
    // Songs laden
    bridge.emit('songLength', 192);
    bridge.emit('cuePoints', bridge.cuePoints);

    companion = new FakeCompanion(companionPort, ablesetPort);
    await companion.open();

    // Handshake wie das echte Modul: /subscribe ['auto', <port>, 'Companion', false]
    companion.send('/subscribe', [
      { type: 's', value: 'auto' },
      { type: 'i', value: companionPort },
      { type: 's', value: 'Companion' },
      { type: 'F', value: false },
    ]);
    return { bridge, companion };
  }

  it('liefert nach /subscribe den vollen AbleSet-Wertesatz', async () => {
    const { companion } = await setup();

    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    expect(companion.value('/setlist/name')).toBeDefined();
    expect(companion.value('/setlist/songs')).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(companion.value('/global/tempo')).toEqual([120]);
    expect(companion.value('/global/isPlaying')).toEqual([false]);
    expect(companion.value('/settings/jumpMode')).toEqual(['quantized']);
    expect(companion.value('/settings/safeMode')).toEqual([false]);
    expect(companion.value('/setlist/activeSongName')).toEqual(['Alpha']);
    expect(companion.value('/setlist/remainingTimeInSet')).toBeDefined();
    expect(companion.value('/timecode/tc')).toBeDefined();
  });

  it('/global/play und /global/stop steuern die Bridge', async () => {
    const { bridge, companion } = await setup();
    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    companion.send('/global/play');
    await waitFor(() => bridge.actions.includes('play'));

    companion.send('/global/stop');
    await waitFor(() => bridge.actions.includes('stop'));
  });

  it('/setlist/jumpToSong cuet den Song (1-basierte Position)', async () => {
    const { bridge, companion } = await setup();
    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    // Position 3 → Gamma (startBeat 128)
    companion.send('/setlist/jumpToSong', [{ type: 'i', value: 3 }]);
    await waitFor(() => bridge.actions.some((a) => a === 'pos:128'));
  });

  it('/setlist/jumpToSong per Name cuet den passenden Song', async () => {
    const { bridge, companion } = await setup();
    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    companion.send('/setlist/jumpToSong', [{ type: 's', value: 'Beta' }]);
    await waitFor(() => bridge.actions.some((a) => a === 'pos:64'));
  });

  it('/setlist/jumpBySongs mit force springt sofort', async () => {
    const { bridge, companion } = await setup();
    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    // von Alpha (Index 0) um +2 → Gamma (128), force=true
    companion.send('/setlist/jumpBySongs', [
      { type: 'i', value: 2 },
      { type: 's', value: 'true' },
    ]);
    await waitFor(() => bridge.actions.some((a) => a === 'pos:128'));
  });

  it('/settings/jumpMode und /settings/safeMode werden übernommen und zurückgemeldet', async () => {
    const { companion } = await setup();
    await waitFor(() => companion.value('/settings/jumpMode') !== undefined);

    companion.send('/settings/jumpMode', [{ type: 's', value: 'end-of-song' }]);
    await waitFor(() => {
      const value = companion.value('/settings/jumpMode');
      return value !== undefined && value[0] === 'end-of-song';
    });

    companion.send('/settings/safeMode', [{ type: 'i', value: 1 }]);
    await waitFor(() => {
      const value = companion.value('/settings/safeMode');
      return value !== undefined && value[0] === true;
    });
  });

  it('sendet Positions-Updates bei laufendem Transport', async () => {
    const { bridge, companion } = await setup();
    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    bridge.transport = { isPlaying: true, positionBeats: 66, bpm: 120, timeSig: [4, 4] };
    bridge.emit('transport', bridge.getTransport());

    await waitFor(() => {
      const pos = companion.value('/global/beatsPosition');
      return pos !== undefined && pos[0] === 66;
    });
    // Beta beginnt bei 64 → aktiver Song ist jetzt Beta
    expect(companion.value('/setlist/activeSongName')).toEqual(['Beta']);
    expect(companion.value('/global/isPlaying')).toEqual([true]);
  });

  it('/unsubscribe stoppt weitere Updates', async () => {
    const { companion } = await setup();
    await waitFor(() => companion.value('/setlist/songs') !== undefined);

    companion.send('/unsubscribe');
    // kurz warten, dann Puffer leeren
    await new Promise((resolve) => setTimeout(resolve, 200));
    companion.received.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    // Kein Keepalive/Update mehr nach dem Abmelden
    expect(companion.received.length).toBe(0);
  });
});
