/**
 * Persistenz der Setlists + Engine-Settings als JSON im Datenordner.
 * Empfehlung: --data-dir in den Live-Projektordner legen — dann zieht beim
 * Umzug der Session alles mit (offline-first, kein Cloud-Zwang).
 */

import { join } from 'node:path';
import type { ClockRule, JumpMode, Setlist } from '@unableset/shared';
import { atomicWriteJson, readJsonWithBackup } from './util/atomicWrite.js';

export interface PersistedSetlists {
  activeSetlistId: string;
  setlists: Setlist[];
}

export interface PersistedSettings {
  jumpMode: JumpMode;
  safeMode: boolean;
  preRollBars: number;
  hidePlayed: boolean;
  clockRules: ClockRule[];
}

const SETLISTS_FILE = 'setlists.json';
const SETTINGS_FILE = 'settings.json';

export class Persistence {
  private readonly dataDir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSetlists: PersistedSetlists | null = null;
  private pendingSettings: PersistedSettings | null = null;
  private readonly log: (message: string) => void;

  constructor(dataDir: string, log: (message: string) => void = () => {}) {
    this.dataDir = dataDir;
    this.log = log;
  }

  async loadSetlists(): Promise<PersistedSetlists | null> {
    const data = await readJsonWithBackup<PersistedSetlists>(join(this.dataDir, SETLISTS_FILE));
    if (!data || !Array.isArray(data.setlists)) return null;
    return data;
  }

  async loadSettings(): Promise<Partial<PersistedSettings> | null> {
    return readJsonWithBackup<Partial<PersistedSettings>>(join(this.dataDir, SETTINGS_FILE));
  }

  /** Debounced (500 ms), damit Drag-&-Drop-Serien nicht pro Event schreiben. */
  saveSetlists(data: PersistedSetlists): void {
    this.pendingSetlists = data;
    this.scheduleFlush();
  }

  saveSettings(data: PersistedSettings): void {
    this.pendingSettings = data;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 500);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const writes: Promise<void>[] = [];
    if (this.pendingSetlists) {
      writes.push(
        atomicWriteJson(join(this.dataDir, SETLISTS_FILE), this.pendingSetlists).catch(
          (error: Error) => this.log(`Setlists speichern fehlgeschlagen: ${error.message}`),
        ),
      );
      this.pendingSetlists = null;
    }
    if (this.pendingSettings) {
      writes.push(
        atomicWriteJson(join(this.dataDir, SETTINGS_FILE), this.pendingSettings).catch(
          (error: Error) => this.log(`Settings speichern fehlgeschlagen: ${error.message}`),
        ),
      );
      this.pendingSettings = null;
    }
    await Promise.all(writes);
  }
}
