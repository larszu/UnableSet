import { beatsToSeconds } from '@unableset/shared';

/** Sekunden → "m:ss" bzw. "h:mm:ss". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBeatsAsDuration(beats: number, bpm: number): string {
  if (bpm <= 0) return '–';
  return formatDuration(beatsToSeconds(beats, bpm));
}

/** Timecode-Anzeige "m:ss.d" für die laufende Position. */
export function formatTimecode(beats: number, bpm: number): string {
  if (bpm <= 0) return '0:00.0';
  const totalSeconds = beatsToSeconds(beats, bpm);
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const d = Math.floor((totalSeconds % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}
