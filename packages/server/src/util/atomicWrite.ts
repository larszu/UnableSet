/**
 * Atomare Datei-Schreibvorgänge für Userdaten: tmp-Datei → .bak-Rotation →
 * rename. Ein Absturz mitten im Schreiben darf nie eine kaputte Datei
 * hinterlassen (Bühnen-Grundsatz).
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  const json = JSON.stringify(data, null, 2);

  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, json, 'utf8');

  // Bestehende Datei als Backup rotieren (best effort)
  try {
    await fs.copyFile(filePath, bakPath);
  } catch {
    // keine bestehende Datei — erster Write
  }

  await fs.rename(tmpPath, filePath);
}

/** Liest JSON; bei kaputter Hauptdatei wird automatisch das .bak probiert. */
export async function readJsonWithBackup<T>(filePath: string): Promise<T | null> {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      // weiter mit Backup bzw. null
    }
  }
  return null;
}
