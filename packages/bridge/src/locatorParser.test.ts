import { describe, expect, it } from 'vitest';
import { parseLocatorName } from './locatorParser.js';

describe('parseLocatorName', () => {
  it('einfacher Songtitel', () => {
    const parsed = parseLocatorName('Intro');
    expect(parsed.kind).toBe('song');
    expect(parsed.title).toBe('Intro');
    expect(parsed.description).toBeUndefined();
  });

  it('Titel mit Beschreibung in geschweiften Klammern', () => {
    const parsed = parseLocatorName('Highway Star {mit Click, Capo 2}');
    expect(parsed.kind).toBe('song');
    expect(parsed.title).toBe('Highway Star');
    expect(parsed.description).toBe('mit Click, Capo 2');
  });

  it('mehrere Beschreibungen werden zusammengeführt', () => {
    const parsed = parseLocatorName('Song {eins} {zwei}');
    expect(parsed.title).toBe('Song');
    expect(parsed.description).toBe('eins zwei');
  });

  it('*Prefix ignoriert den Locator komplett', () => {
    expect(parseLocatorName('*Soundcheck').kind).toBe('ignored');
    expect(parseLocatorName('  *FX Marker {egal}').kind).toBe('ignored');
  });

  it('SONG END als Marker, case-insensitiv', () => {
    expect(parseLocatorName('SONG END').kind).toBe('songEnd');
    expect(parseLocatorName('song end').kind).toBe('songEnd');
    expect(parseLocatorName(' Song End ').kind).toBe('songEnd');
  });

  it('STOP als Marker, case-insensitiv', () => {
    expect(parseLocatorName('STOP').kind).toBe('stop');
    expect(parseLocatorName('stop').kind).toBe('stop');
  });

  it('STOP als Songtitel-Bestandteil bleibt Song', () => {
    expect(parseLocatorName('Stop the Music').kind).toBe('song');
  });

  it('+Flags werden extrahiert und uppercased', () => {
    const parsed = parseLocatorName('Verse +LOOP:4 +stop');
    expect(parsed.kind).toBe('song');
    expect(parsed.title).toBe('Verse');
    expect(parsed.flags.get('LOOP')).toBe('4');
    expect(parsed.flags.get('STOP')).toBe(true);
  });

  it('+SECTIONS-Flag wird erkannt', () => {
    const parsed = parseLocatorName('Medley +SECTIONS');
    expect(parsed.flags.has('SECTIONS')).toBe(true);
  });

  it('Plus mitten im Titel ist kein Flag', () => {
    const parsed = parseLocatorName('Rock+Roll');
    expect(parsed.title).toBe('Rock+Roll');
    expect(parsed.flags.size).toBe(0);
  });

  it('Locator nur aus Beschreibung/Flags wird ignoriert', () => {
    expect(parseLocatorName('{nur Kommentar}').kind).toBe('ignored');
    expect(parseLocatorName('+LOOP:2').kind).toBe('ignored');
  });

  it('Whitespace wird normalisiert', () => {
    const parsed = parseLocatorName('  My   Song   {  viel   Platz  } ');
    expect(parsed.title).toBe('My Song');
    expect(parsed.description).toBe('viel Platz');
  });
});
