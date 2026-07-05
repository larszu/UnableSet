/**
 * Minimale Typen für osc.js (Package `osc`) — es gibt keine offiziellen Typen.
 * Nur die hier genutzte UDP-API ist deklariert.
 */
declare module 'osc' {
  import { EventEmitter } from 'node:events';

  export interface OscTypedArg {
    type: string;
    value: unknown;
  }

  export interface OscPacket {
    address: string;
    args: OscTypedArg[];
  }

  export interface RemoteInfo {
    address: string;
    port: number;
  }

  export interface UDPPortOptions {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
    broadcast?: boolean;
  }

  export class UDPPort extends EventEmitter {
    constructor(options: UDPPortOptions);
    options: UDPPortOptions;
    open(): void;
    close(): void;
    send(packet: { address: string; args?: OscTypedArg[] }, address?: string, port?: number): void;
    on(event: 'ready', listener: () => void): this;
    on(event: 'message', listener: (msg: OscPacket, timeTag: unknown, info: RemoteInfo) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    once(event: 'ready', listener: () => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
  }

  const osc: { UDPPort: typeof UDPPort };
  export default osc;
}
