import { describe, expect, it } from 'vitest';
import { matchMidiMapping, type MidiMappingEntry } from './midiMapping.js';
import { ClockScheduler } from './clockActions.js';
import type { ClockRule } from '@unableset/shared';

const mappings: MidiMappingEntry[] = [
  { event: 'noteOn', channel: 0, data1: 60, action: 'play' },
  { event: 'noteOn', channel: 0, data1: 62, action: 'nextSong' },
  { event: 'cc', channel: 1, data1: 64, action: 'stop' },
  { event: 'cc', channel: 1, data1: 65, threshold: 100, action: 'jumpNow' },
  { event: 'programChange', channel: 2, data1: 5, action: 'prevSong' },
];

describe('matchMidiMapping', () => {
  it('noteOn mit Velocity > 0 matcht', () => {
    expect(matchMidiMapping(mappings, { status: 0x90, data1: 60, data2: 100 })).toBe('play');
  });

  it('noteOn mit Velocity 0 (= note off) matcht nicht', () => {
    expect(matchMidiMapping(mappings, { status: 0x90, data1: 60, data2: 0 })).toBeNull();
  });

  it('falscher Kanal matcht nicht', () => {
    expect(matchMidiMapping(mappings, { status: 0x91, data1: 60, data2: 100 })).toBeNull();
  });

  it('cc ab Default-Schwelle 64', () => {
    expect(matchMidiMapping(mappings, { status: 0xb1, data1: 64, data2: 64 })).toBe('stop');
    expect(matchMidiMapping(mappings, { status: 0xb1, data1: 64, data2: 10 })).toBeNull();
  });

  it('cc mit eigener Schwelle', () => {
    expect(matchMidiMapping(mappings, { status: 0xb1, data1: 65, data2: 99 })).toBeNull();
    expect(matchMidiMapping(mappings, { status: 0xb1, data1: 65, data2: 127 })).toBe('jumpNow');
  });

  it('programChange matcht auf data1', () => {
    expect(matchMidiMapping(mappings, { status: 0xc2, data1: 5, data2: 0 })).toBe('prevSong');
  });

  it('unbekanntes Event ergibt null', () => {
    expect(matchMidiMapping(mappings, { status: 0x80, data1: 60, data2: 0 })).toBeNull();
  });
});

describe('ClockScheduler', () => {
  function makeRule(at: string, enabled = true): ClockRule {
    return { id: `r-${at}`, at, action: 'play', enabled };
  }

  it('feuert bei passender Uhrzeit genau einmal pro Tag', () => {
    const fired: string[] = [];
    const scheduler = new ClockScheduler(
      () => [makeRule('20:00')],
      (action) => fired.push(action),
    );

    const at = new Date('2026-07-05T20:00:10');
    scheduler.check(at);
    scheduler.check(at); // gleiche Minute — darf nicht doppelt feuern
    expect(fired).toEqual(['play']);

    scheduler.check(new Date('2026-07-06T20:00:10')); // nächster Tag
    expect(fired).toEqual(['play', 'play']);
  });

  it('deaktivierte Regeln und andere Uhrzeiten feuern nicht', () => {
    const fired: string[] = [];
    const scheduler = new ClockScheduler(
      () => [makeRule('20:00', false), makeRule('21:00')],
      (action) => fired.push(action),
    );
    scheduler.check(new Date('2026-07-05T20:00:10'));
    expect(fired).toEqual([]);
    scheduler.check(new Date('2026-07-05T21:00:59'));
    expect(fired).toEqual(['play']);
  });
});
