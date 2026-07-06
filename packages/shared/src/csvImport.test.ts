import { describe, expect, it } from 'vitest';
import { parseCsvLine, parseSongTitlesFromCsv } from './csvImport.js';

describe('parseCsvLine', () => {
  it('einfache Felder', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('Anführungszeichen mit Komma darin', () => {
    expect(parseCsvLine('"Highway Star, live","Deep Purple"')).toEqual([
      'Highway Star, live',
      'Deep Purple',
    ]);
  });

  it('doppelte Anführungszeichen als Escape', () => {
    expect(parseCsvLine('"Say ""Hello""",x')).toEqual(['Say "Hello"', 'x']);
  });

  it('Semikolon als Trenner (deutsches Excel)', () => {
    expect(parseCsvLine('a;b;c')).toEqual(['a', 'b', 'c']);
  });
});

describe('parseSongTitlesFromCsv', () => {
  it('erkennt die Titel-Spalte per Header (BandHelper: "Song Title")', () => {
    const csv = 'Artist,Song Title,Key\nDeep Purple,Highway Star,G\nQueen,Bohemian Rhapsody,Bb';
    expect(parseSongTitlesFromCsv(csv)).toEqual(['Highway Star', 'Bohemian Rhapsody']);
  });

  it('erkennt deutschen Header "Titel"', () => {
    const csv = 'Nr;Titel;Tonart\n1;Neonlicht;Am\n2;Sturmfahrt;E';
    expect(parseSongTitlesFromCsv(csv)).toEqual(['Neonlicht', 'Sturmfahrt']);
  });

  it('ohne erkennbaren Header: erste Spalte sind Titel', () => {
    const csv = 'Neonlicht\nSturmfahrt\nHerzschlag';
    expect(parseSongTitlesFromCsv(csv)).toEqual(['Neonlicht', 'Sturmfahrt', 'Herzschlag']);
  });

  it('leere Zeilen werden übersprungen', () => {
    const csv = 'Title\nA\n\n\nB\n';
    expect(parseSongTitlesFromCsv(csv)).toEqual(['A', 'B']);
  });

  it('leerer Input ergibt leere Liste', () => {
    expect(parseSongTitlesFromCsv('')).toEqual([]);
  });
});
