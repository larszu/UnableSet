/**
 * Screen-Wake-Lock: Das Display darf auf der Bühne nie ausgehen.
 * Reaktiviert sich nach Tab-Wechsel/Sperren automatisch; auf Browsern ohne
 * Wake-Lock-API passiert schlicht nichts.
 */

import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export function useWakeLock(): void {
  useEffect(() => {
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      try {
        const wakeLock = (navigator as Navigator & {
          wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
        }).wakeLock;
        if (!wakeLock || disposed) return;
        sentinel = await wakeLock.request('screen');
      } catch {
        // z. B. Energiesparmodus — kein Grund zu crashen
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
