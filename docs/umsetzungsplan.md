# Umsetzungsplan

Stand: **M0–M6 und M9 geliefert** plus Teile von M7/M8 (QR, mDNS, OSC-Out-
Feed, TTS, Clock-Aktionen, Show-Presets, Zwei-Listen-Prinzip, PWA,
2000+-Marker-Skalierung). Offen: Canvas/Scripting + Electron-Hülle (M7),
Multi-File-Projekte/BandHelper-Import (M8), Lyrics aus MIDI-Clips,
MIDI-Learn-UI, Weg B (Max for Live).
Dieses Dokument hält die Architektur-Entscheidungen und offenen Fragen fest.

**M6-Design:** Die Redundanz spiegelt Kommandos (Play/Stop/Jumps/Position/
Mixer) per OSC an weitere AbletonOSC-Rigs und hält sie über Drift-Messung +
Korrektur (Schwelle 0,25 Beats) in Sync — die Korrektur greift nur über der
Schwelle und „schaltet sich ab", sobald die Rigs synchron laufen. Bewusst
kein eigenes Host-zu-Host-Protokoll: die Backup-Maschine braucht nur Live +
AbletonOSC, keinen zweiten UnableSet-Host.

## Getroffene Entscheidungen (M0)

| Thema | Entscheidung | Begründung |
|---|---|---|
| Ableton-Bridge | **Weg A**: OSC gegen das AbletonOSC-Remote-Script (MIT) | Kein Max for Live/Suite nötig, läuft mit Live 11/12. Hinter dem `AbletonBridge`-Interface gekapselt, Weg B (M4L, beat-genau) später austauschbar. |
| State-Lib Client | **Zustand** | Konsistent mit bestehenden Repos (cable-planner), minimaler Boilerplate, selektive Subscriptions für 10-Hz-Transport-Updates ohne Re-Render-Kaskaden. Redux Toolkit brächte hier nur Zeremonie — der Client hält ohnehin keinen eigenen Wahrheits-State. |
| Server-Framework | Express 4 + `ws` | Battle-tested, riesiges Ökosystem, läuft problemlos auf Pi 5/arm64. |
| Host-Ports | HTTP 4400, OSC 11000/11001 (AbletonOSC-Defaults) | Alles per CLI-Flag änderbar. |
| Positions-Sync | Listener für Tempo/Playing/Taktart, Polling (~10 Hz) für `current_song_time` nur bei laufendem Playback | AbletonOSC liefert keine zuverlässigen Beat-Callbacks; Polling ist im LAN < 1 ms RTT. Beat-genaue Callbacks kommen mit Weg B. |
| Fehlerphilosophie | Bridge/Host loggen und degradieren graceful, crashen nie hart; Heartbeat (2 s) erkennt Live-Verlust, Reconnect ist Normalzustand | Bühnen-Grundsatz aus dem Brief: ein Absturz darf die Show nie stoppen. |
| Song-IDs | `slug@startBeat` | Stabil über Reloads, gleichnamige Songs bleiben unterscheidbar. |

## Paketstruktur

```
packages/
  shared/   Datenmodell, WS-Protokoll, OSC-Adressen, Beat-Mathe (PROTOCOL.md)
  bridge/   AbletonBridge-Interface + OscAbletonBridge (Weg A) + Locator-Parser
  server/   Host: HostStore (Wahrheitsquelle), WS-Broadcast, REST, Static-Serve
  client/   React-PWA: Zustand-Store, WS-Reconnect, Setlist-/Transport-View
```

Später: `apps/desktop` (Electron-Hülle, M7), `packages/bridge-m4l` (Weg B).

## Plan M1–M9 (Kurzfassung)

1. **M1 – Read-Only bühnenstabil:** Restdauer-/Gesamtdauer-Berechnung,
   Performance-View (reduziert), Section-Erkennung, Reconnect-Härtung,
   Langzeit-Test gegen echtes Live. *Erst danach Steuerung.*
2. **M2 – Steuerung & Jumps:** Jump-Modi (quantized/endOfSection/endOfSong/
   dynamic/manual) als reine, unit-getestete Funktionen über
   (Position, Tempo, Taktart, Ziel); Queue + Highlight; Safe Mode; Autoplay/
   STOP/SONG-END-Verhalten; Tastatur-Shortcuts.
3. **M3 – Setlist-Editor:** Drag & Drop, Overrides, Tags/Suche,
   Speichern/Laden als JSON im Live-Projektordner, Plaintext-Import/-Export,
   Song mehrfach, Sets/Gig-Struktur.
4. **M4 – Lyrics/Chords + Views**, **M5 – MIDI/OSC/Mixer**,
   **M6 – Redundanz**, **M7 – Canvas/Scripting/Electron**,
   **M8 – Differenzierer**, **M9 – Politur** — wie im Brief priorisiert.

## Offene Entscheidungen (bitte klären)

Die sechs Punkte aus dem Brief, mit Empfehlung:

1. **Ableton-Bridge:** Empfehlung: bei Weg A bleiben, Weg B (Max for Live) als
   M2/M4-Zusatz für beat-genaue Quantisierung. → *Umgesetzt: Weg A, Interface
   ist austauschbar.*
2. **Live-Version(en):** Empfehlung: Live 11 + 12, nur Arrangement-View bis
   einschließlich M5; Session-View-Support als separates Post-M5-Thema.
3. **Electron für v1:** Empfehlung: nein — reiner Server-Prozess (Pi-freundlich),
   Electron-Hülle in M7.
4. **State-Lib:** Zustand (siehe oben) — Veto möglich, Wechsel wäre jetzt noch billig.
5. **Scope:** Empfehlung: M0–M5 strikt zuerst; aus M8 einzig die
   Clock-Aktionen vorziehen (klein, hoher Nutzen), Rest nach Parität.
6. **Produktname:** `UnableSet` bleibt Platzhalter; Repo-/Package-Namen sind
   darauf ausgelegt, einmalig global umbenannt zu werden (vor M3 entscheiden,
   danach wird es teurer).

## Risiken

- **AbletonOSC-Antwortformate** (z. B. `cue_points`) sind nicht formal
  spezifiziert — der Parser ist tolerant gebaut; gegen echtes Live 11 und 12
  verifizieren (M1).
- **Quantisierung ohne Beat-Callbacks** (Weg A) hängt an der Genauigkeit von
  Tempo + Polling-Position; Latenz wird ab M2 gemessen und geloggt.
- **iPadOS-PWA-Eigenheiten** (Wake-Lock, WS im Hintergrund) werden ab M4 auf
  echter Hardware getestet.
