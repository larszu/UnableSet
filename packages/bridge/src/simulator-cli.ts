#!/usr/bin/env node
/**
 * Startet den AbletonOSC-Simulator standalone (Entwicklung ohne Live):
 *
 *   node packages/bridge/dist/simulator-cli.js [--port 11000]
 */

import { parseArgs } from 'node:util';
import { ABLETON_OSC_DEFAULT_SEND_PORT } from '@unableset/shared';
import { AbletonOscSimulator, demoSimulatorOptions } from './AbletonOscSimulator.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { port: { type: 'string' } },
  strict: false,
});

const port = Number(values.port) || ABLETON_OSC_DEFAULT_SEND_PORT;
const simulator = new AbletonOscSimulator(demoSimulatorOptions(port));

simulator
  .open()
  .then(() => {
    console.log(`AbletonOSC-Simulator läuft auf UDP :${port} (Demo-Session, 4 Songs)`);
  })
  .catch((error: Error) => {
    console.error(`Simulator-Start fehlgeschlagen: ${error.message}`);
    process.exit(1);
  });

process.on('SIGINT', () => {
  simulator.close();
  process.exit(0);
});
