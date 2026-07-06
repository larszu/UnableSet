/**
 * Assistenz-MD per Text-to-Speech (Web Speech API): sagt beim Songwechsel den
 * Titel an — gedacht für einen In-Ear-Bus am Gerät des MD. Rein lokal, offline.
 */

let lastAnnounced: string | undefined;

export function announceSong(title: string | undefined, enabled: boolean): void {
  if (!enabled || !title || title === lastAnnounced) return;
  lastAnnounced = title;
  if (typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(title);
    utterance.lang = 'de-DE';
    utterance.rate = 1.1;
    speechSynthesis.speak(utterance);
  } catch {
    // TTS ist optional — Fehler ignorieren
  }
}
