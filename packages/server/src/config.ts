import { parseArgs } from 'node:util';
import {
  ABLETON_OSC_DEFAULT_RECEIVE_PORT,
  ABLETON_OSC_DEFAULT_SEND_PORT,
  OSC_REMOTE_DEFAULT_PORT,
} from '@unableset/shared';

export interface HostConfig {
  httpPort: number;
  oscHost: string;
  oscPort: number;
  oscListenPort: number;
  /** 0 = OSC-Fernsteuerung deaktiviert. */
  oscRemotePort: number;
  dataDir: string;
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
  };
}
