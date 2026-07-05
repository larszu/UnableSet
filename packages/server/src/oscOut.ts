/**
 * OSC-Out: Status-Feed an externe Geräte (Fußcontroller-Displays, Licht,
 * Video — herstellerneutral) + `oscOnEnter`-Nachrichten pro Song.
 * Adressen: OSC_OUT in @unableset/shared (PROTOCOL.md).
 */

import osc from 'osc';
import type { OscTypedArg, UDPPort } from 'osc';
import type { OscMessage } from '@unableset/shared';

export interface OscOutTarget {
  address: string;
  port: number;
}

function toTypedArgs(args: OscMessage['args']): OscTypedArg[] {
  return (args ?? []).map((value) => {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { type: 'i', value } : { type: 'f', value };
    }
    if (typeof value === 'boolean') return { type: 'i', value: value ? 1 : 0 };
    return { type: 's', value };
  });
}

export class OscOut {
  private port: UDPPort | null = null;
  private ready = false;

  constructor(
    private readonly targets: OscOutTarget[],
    private readonly log: (message: string) => void = () => {},
  ) {}

  async open(): Promise<void> {
    if (this.targets.length === 0) return;
    const port = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, metadata: true });
    this.port = port;
    port.on('error', (error) => this.log(`OSC-Out-Fehler: ${error.message}`));
    await new Promise<void>((resolve, reject) => {
      port.once('ready', () => {
        this.ready = true;
        resolve();
      });
      port.once('error', reject);
      port.open();
    });
    this.log(
      `OSC-Out aktiv → ${this.targets.map((t) => `${t.address}:${t.port}`).join(', ')}`,
    );
  }

  close(): void {
    if (this.port && this.ready) this.port.close();
    this.port = null;
    this.ready = false;
  }

  send(message: OscMessage): void {
    if (!this.port || !this.ready) return;
    const args = toTypedArgs(message.args);
    for (const target of this.targets) {
      try {
        this.port.send({ address: message.address, args }, target.address, target.port);
      } catch {
        // best effort — ein totes Ziel darf nichts blockieren
      }
    }
  }

  sendAll(messages: OscMessage[]): void {
    for (const message of messages) this.send(message);
  }
}
