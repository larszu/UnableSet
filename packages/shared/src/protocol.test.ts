import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage, serializeMessage } from './protocol.js';

describe('parseClientMessage', () => {
  it('parst gültige Nachrichten', () => {
    expect(parseClientMessage('{"type":"ping","id":1,"sentAt":123}')).toEqual({
      type: 'ping',
      id: 1,
      sentAt: 123,
    });
    expect(parseClientMessage(serializeMessage({ type: 'refreshLocators' }))).toEqual({
      type: 'refreshLocators',
    });
  });

  it('lehnt kaputtes JSON ab statt zu werfen', () => {
    expect(parseClientMessage('{nope')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
    expect(parseClientMessage(42)).toBeNull();
    expect(parseClientMessage(null)).toBeNull();
  });

  it('lehnt unbekannte Typen ab', () => {
    expect(parseClientMessage('{"type":"selfDestruct"}')).toBeNull();
    expect(parseClientMessage('{"type":"snapshot"}')).toBeNull();
  });

  it('akzeptiert Binary-Frames (Uint8Array)', () => {
    const bytes = new TextEncoder().encode('{"type":"hello"}');
    expect(parseClientMessage(bytes)).toEqual({ type: 'hello' });
  });
});

describe('parseServerMessage', () => {
  it('parst pong', () => {
    expect(parseServerMessage('{"type":"pong","id":1,"sentAt":1,"serverTime":2}')).toEqual({
      type: 'pong',
      id: 1,
      sentAt: 1,
      serverTime: 2,
    });
  });

  it('lehnt Client-Typen ab', () => {
    expect(parseServerMessage('{"type":"ping","id":1,"sentAt":1}')).toBeNull();
  });
});
