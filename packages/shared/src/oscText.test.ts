import { describe, expect, it } from 'vitest';
import {
  oscMessagesToText,
  parseHostPortList,
  parseOscLine,
  parseOscLines,
} from './oscText.js';

describe('parseOscLine', () => {
  it('Adresse ohne Argumente', () => {
    expect(parseOscLine('/light/blackout')).toEqual({ address: '/light/blackout' });
  });

  it('Zahlen und Strings gemischt', () => {
    expect(parseOscLine('/light/preset 3 1.5 warm')).toEqual({
      address: '/light/preset',
      args: [3, 1.5, 'warm'],
    });
  });

  it('ungültige Zeilen ergeben null', () => {
    expect(parseOscLine('kein osc')).toBeNull();
    expect(parseOscLine('')).toBeNull();
    expect(parseOscLine('/')).toBeNull();
  });

  it('Whitespace wird toleriert', () => {
    expect(parseOscLine('   /a   1   2  ')).toEqual({ address: '/a', args: [1, 2] });
  });
});

describe('parseOscLines / oscMessagesToText (Roundtrip)', () => {
  it('überspringt ungültige Zeilen', () => {
    const messages = parseOscLines('/a 1\nkaputt\n\n/b zwei');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ address: '/b', args: ['zwei'] });
  });

  it('Roundtrip erhält Inhalt', () => {
    const text = '/light/preset 3 warm\n/video/cue 7';
    expect(oscMessagesToText(parseOscLines(text))).toBe(text);
  });
});

describe('parseHostPortList', () => {
  it('parst mehrere Ziele', () => {
    expect(parseHostPortList('192.168.1.10:9001, backup.local:9002')).toEqual([
      { address: '192.168.1.10', port: 9001 },
      { address: 'backup.local', port: 9002 },
    ]);
  });

  it('verwirft ungültige Einträge', () => {
    expect(parseHostPortList('nurhost, host:0, host:99999, :123, ok:1234')).toEqual([
      { address: 'ok', port: 1234 },
    ]);
  });

  it('leerer String ergibt leere Liste', () => {
    expect(parseHostPortList('')).toEqual([]);
  });
});
