/**
 * Gemeinsamer Helfer: JS-Werte → getypte OSC-Argumente (osc.js metadata-Form).
 * Ganzzahlen als 'i', Brüche als 'f', Booleans als 0/1, Rest als String.
 */

import type { OscTypedArg } from 'osc';
import type { OscArgValue } from '@unableset/shared';

export function toTypedOscArgs(args: readonly OscArgValue[] = []): OscTypedArg[] {
  return args.map((value) => {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { type: 'i', value } : { type: 'f', value };
    }
    if (typeof value === 'boolean') return { type: 'i', value: value ? 1 : 0 };
    return { type: 's', value };
  });
}
