/**
 * Tastatur-Shortcuts für die Kern-Aktionen (P0):
 *   Space  Play/Continue ↔ Stop      →/N  nächster Song cuen
 *   Enter  gequeueten Sprung sofort   ←/P  vorheriger Song cuen
 *   Esc    Queue verwerfen            S    Stop
 */

import { useEffect } from 'react';
import { useAppStore } from '../store.js';
import { send } from '../ws.js';

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const { locked, transport } = useAppStore.getState();
      if (locked) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          send(
            transport.isPlaying
              ? { type: 'command', command: { action: 'stop' } }
              : { type: 'command', command: { action: 'continue' } },
          );
          break;
        case 'Enter':
          send({ type: 'jumpNow' });
          break;
        case 'Escape':
          send({ type: 'clearQueue' });
          break;
        case 'ArrowRight':
        case 'n':
          send({ type: 'nextSong' });
          break;
        case 'ArrowLeft':
        case 'p':
          send({ type: 'prevSong' });
          break;
        case 's':
          send({ type: 'command', command: { action: 'stop' } });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
