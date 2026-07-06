import { parseArgs } from 'node:util';
import {
  ABLETON_OSC_DEFAULT_RECEIVE_PORT,
  ABLETON_OSC_DEFAULT_SEND_PORT,
  OSC_REMOTE_DEFAULT_PORT,
  parseHostPortList,
} from '@unableset/shared';

export interface HostConfig {
  httpPort: number;
  oscHost: string;
  oscPort: number;
  oscListenPort: number;
  /** 0 = OSC-Fernsteuerung deaktiviert. */
  oscRemotePort: number;
  dataDir: string;
  /** Backup-Rigs für die M6-Redundanz ("host:port,host2:port2"). */
  mirrorTargets: { address: string; port: number }[];
  /** Ziele für den OSC-Out-Feed ("host:port,…"). */
  oscOutTargets: { address: string; port: number }[];
  /** mDNS-Advertising des Hosts. */
  mdns: boolean;
  /** UDP-Port der AbleSet-Companion-Kompatibilität (0 = aus). */
  ablesetPort: number;
}

export const DEFAULT_HTTP_PORT = 4400;

export function parseConfig(argv: string[]): HostConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      'http-port': { type: 'string' },
      'osc-host': { type: 'string' },
      'osc-port': { type: 'string' },
      'osc-listen-port': { type: 'string' },
      'osc-remote-port': { type: 'string' },
      'data-dir': { type: 'string' },
      mirror: { type: 'string' },
      'osc-out': { type: 'string' },
      'no-mdns': { type: 'boolean' },
      'ableset-port': { type: 'string' },
    },
    strict: false,
  });

  const toPort = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed < 65536 ? parsed : fallback;
  };

  return {
    httpPort: toPort(values['http-port'], DEFAULT_HTTP_PORT),
    oscHost: typeof values['osc-host'] === 'string' ? values['osc-host'] : '127.0.0.1',
    oscPort: toPort(values['osc-port'], ABLETON_OSC_DEFAULT_SEND_PORT),
    oscListenPort: toPort(values['osc-listen-port'], ABLETON_OSC_DEFAULT_RECEIVE_PORT),
    oscRemotePort: toPort(values['osc-remote-port'], OSC_REMOTE_DEFAULT_PORT),
    dataDir: typeof values['data-dir'] === 'string' ? values['data-dir'] : './unableset-data',
    mirrorTargets: parseHostPortList(typeof values.mirror === 'string' ? values.mirror : ''),
    oscOutTargets: parseHostPortList(typeof values['osc-out'] === 'string' ? values['osc-out'] : ''),
    mdns: values['no-mdns'] !== true,
    ablesetPort: toPort(values['ableset-port'], 39051),
  };
}
