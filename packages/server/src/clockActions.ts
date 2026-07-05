/**
 * Uhrzeit-basierte Aktionen: „um 20:00 → Play" (Show-Start, Curfew etc.).
 * Regeln kommen aus den Settings und sind per WS editierbar.
 */

import type { ClockRule } from '@unableset/shared';

export type ClockActionHandler = (action: ClockRule['action'], rule: ClockRule) => void;

export class ClockScheduler {
  private timer: NodeJS.Timeout | null = null;
  /** ruleId → "YYYY-MM-DD", an dem zuletzt gefeuert wurde */
  private lastFired = new Map<string, string>();

  constructor(
    private readonly getRules: () => ClockRule[],
    private readonly handler: ClockActionHandler,
    private readonly log: (message: string) => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(new Date()), 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exponiert für Tests: prüft alle Regeln gegen eine konkrete Uhrzeit. */
  check(now: Date): void {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    for (const rule of this.getRules()) {
      if (!rule.enabled || rule.at !== hhmm) continue;
      if (this.lastFired.get(rule.id) === today) continue;
      this.lastFired.set(rule.id, today);
      this.log(`Clock-Aktion ${rule.at} → ${rule.action}`);
      this.handler(rule.action, rule);
    }
  }
}
