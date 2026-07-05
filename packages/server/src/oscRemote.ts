/**
 * OSC-In-Fernsteuerung des Hosts (UDP): TouchOSC, Open Stage Control und
 * Bitfocus Companion (generisches OSC-Modul) können damit alle Kern-Aktionen
 * auslösen. Adressen siehe OSC_REMOTE in @unableset/shared (PROTOCOL.md).
 */

import osc from 'osc';
import type { OscPacket, UDPPort } from 'osc';
import { OSC_REMOTE } from '@unableset/shared';

export interface OscRemoteActions {
  play(): void;
  stop(): void;
  continue(): void;
  nextSong(): void;
  prevSong(): void;
  jumpNow(): void;
  queueEntry(index: number): void;
  setSafeMode(enabled: boolean): void;
}

export class OscRemote {
  private port: UDPPort | null = null;

  constructor(
    private readonly listenPort: number,
    private readonly actions: OscRemoteActions,
    private readonly log: (message: string) => void = () => {},
  ) {}

  async open(): Promise<void> {
    const port = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: this.listenPort,
      metadata: true,
    });
    this.port = port;
    port.on('message', (msg) => this.onMessage(msg));
    port.on('error', (error) => this.log(`OSC-Remote-Fehler: ${error.message}`));
    await new Promise<void>((resolve, reject) => {
      port.once('ready', resolve);
      port.once('error', reject);
      port.open();
    });
    this.log(`OSC-Fernsteuerung lauscht auf UDP :${this.listenPort}`);
  }

  close(): void {
    this.port?.close();
    this.port = null;
  }

  private onMessage(msg: OscPacket): void {
    const firstArg = msg.args[0]?.value;
    switch (msg.address) {
      case OSC_REMOTE.play:
        this.actions.play();
        break;
      case OSC_REMOTE.stop:
        this.actions.stop();
        break;
      case OSC_REMOTE.continue:
        this.actions.continue();
        break;
      case OSC_REMOTE.nextSong:
        this.actions.nextSong();
        break;
      case OSC_REMOTE.prevSong:
        this.actions.prevSong();
        break;
      case OSC_REMOTE.jumpNow:
        this.actions.jumpNow();
        break;
      case OSC_REMOTE.queueEntry:
        if (typeof firstArg === 'number') this.actions.queueEntry(Math.round(firstArg));
        break;
      case OSC_REMOTE.setSafeMode:
        this.actions.setSafeMode(firstArg === 1 || firstArg === true);
        break;
      default:
        break;
    }
  }
}
