# UnableSet

Browser-basierter Setlist- und Playback-Controller für Ableton Live —
quelloffene, eigenständige Neuimplementierung. Ein MD/Playback-Engineer,
Musiker, Sänger oder Solo-Act steuert von jedem Gerät im LAN (Handy, iPad,
Laptop, Fußcontroller) eine aus Ableton-Locators erzeugte, live umsortierbare
Setlist — **ohne die Live-Session anzufassen** und **ohne Internetverbindung**.

![Performance-View](docs/screenshots/performance.png)

## Features

- **Setlist aus Ableton-Locators**: Songs, Beschreibungen (`{…}`), Sections
  (`>Chorus`), Marker (`SONG END`, `STOP`), ignorierte Locators (`*`), Flags
  (`+LOOP:4`, `+STOP`) — die Live-Session wird nie verändert
- **Live umsortierbar**: Drag & Drop, Songs mehrfach, Sets mit Zwischensummen,
  Farben/Notizen/Tags, Skip, „gespielt"-Häkchen, Plaintext-Import/-Export,
  mehrere Setlists (Show-Presets)
- **Jump-Modi**: Quantisiert (Taktgrenze), Ende der Section, Ende des Songs,
  Dynamisch, Manuell — mit Queue + Hervorhebung und „Jetzt"-Button
- **Safe Mode** gegen versehentliche Sprünge, **Pre-Roll/Count-in** für Proben
- **Autoplay über die Setlist-Reihenfolge**: Songende springt zum nächsten
  Setlist-Eintrag (nicht zum Arrangement-Nachbarn); `STOP` hält an und
  bereitet den nächsten Song vor
- **Section-Loops** über das native Ableton-Loop-Bracket
- **Views pro Gerät**: Performance (Bühne), Setlist (MD), Lyrics-Teleprompter
  mit Akkordzeilen + Auto-Scroll, Mixer (Volume/Mute/Solo), Settings — alle
  sperrbar gegen versehentliche Bedienung
- **Anzeige**: Bar/Beat, BPM, Taktart, Timecode, Beat-Flash, Rest im Song,
  Rest im Set, nächster Song
- **Fernsteuerung**: Tastatur-Shortcuts, OSC-In (TouchOSC / Open Stage
  Control / **Bitfocus Companion**), MIDI-Mapping (Fußcontroller, optional)
- **Clock-Aktionen**: „um 20:00 → Play" (Show-Start, Curfew)
- **QR-Code** zum schnellen Verbinden weiterer Geräte, **TTS-Ansage** des
  Songtitels (In-Ear-Assistenz, lokal via Web Speech API)
- **Bühnentauglich**: Host crasht nie hart, Clients reconnecten automatisch
  mit vollem State-Snapshot, alles offline-first

| Setlist (MD) | Lyrics-Teleprompter |
|---|---|
| ![Setlist](docs/screenshots/setlist.png) | ![Lyrics](docs/screenshots/lyrics.png) |

| Mixer | Settings |
|---|---|
| ![Mixer](docs/screenshots/mixer.png) | ![Settings](docs/screenshots/settings.png) |

<img src="docs/screenshots/performance-mobile.png" alt="Performance auf dem Smartphone" width="300" />

## Architektur

```
Ableton Live  ←OSC/UDP→  Host (Node/TS)  ←WebSocket→  Clients (Browser/PWA)
  AbletonOSC              Single Source                Performance · Setlist
  Remote-Script           of Truth                     · Lyrics · Mixer · Settings
```

- `packages/shared` — Datenmodell, WS-Protokoll, OSC-Adressen, Jump-/Beat-Mathematik ([PROTOCOL.md](packages/shared/PROTOCOL.md))
- `packages/bridge` — Ableton-Anbindung hinter dem `AbletonBridge`-Interface;
  Weg A: OSC via [AbletonOSC](https://github.com/ideoforms/AbletonOSC);
  Weg B (später): Max for Live, beat-genau. Enthält zusätzlich einen
  **AbletonOSC-Simulator** für Entwicklung/Tests ohne Live.
- `packages/server` — Host: Setlist-Engine, State-Store, WebSocket-Broadcast,
  REST, OSC-Remote, Clock-Scheduler, atomare JSON-Persistenz
- `packages/client` — React-PWA (React 19, Vite, Tailwind 4, Zustand)

Der Host ist die einzige Wahrheitsquelle; Clients sind synchronisierte
Ansichten mit automatischem Reconnect + vollem State-Snapshot.

## Installation & Start

Voraussetzungen: **Node ≥ 20**, **pnpm ≥ 9**, Ableton **Live 11/12** mit
installiertem [AbletonOSC](https://github.com/ideoforms/AbletonOSC)-Remote-Script.

**1. AbletonOSC installieren** (einmalig):
[Release herunterladen](https://github.com/ideoforms/AbletonOSC), Ordner
`AbletonOSC` in die Remote-Scripts-Ablage kopieren (macOS:
`~/Music/Ableton/User Library/Remote Scripts/`, Windows:
`%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\`), dann in Live
unter *Settings → Link/Tempo/MIDI → Control Surface* „AbletonOSC" wählen.

**2. UnableSet bauen & starten:**

```bash
pnpm install
pnpm build

# Host starten (liefert den Client gleich mit aus):
node packages/server/dist/index.js
# → http://localhost:4400 im Browser öffnen (weitere Geräte: QR-Code in Settings)
```

**3. Locators benennen** (siehe Notation unten), in der App „Locators neu
laden" — fertig.

### Ohne Ableton ausprobieren (Demo-Modus)

```bash
pnpm build
pnpm simulator          # simuliertes Live mit Demo-Session (4 Songs, Sections)
node packages/server/dist/index.js   # in zweitem Terminal
```

### Entwicklung

```bash
pnpm dev                # tsc-watch (shared+bridge) + Host + Vite-Dev-Server (:5173)
pnpm test               # Vitest: 122 Unit-/Integrationstests
pnpm test:e2e           # Playwright: 8 Headless-E2E der Bühnen-Flows
pnpm lint && pnpm typecheck
pnpm screenshots        # README-Screenshots headless neu erzeugen
```

### CLI-Flags des Hosts

| Flag | Default | Bedeutung |
|---|---|---|
| `--http-port` | `4400` | Web-UI + WebSocket + REST |
| `--osc-host` | `127.0.0.1` | Rechner, auf dem Live läuft |
| `--osc-port` | `11000` | AbletonOSC-Empfangsport |
| `--osc-listen-port` | `11001` | Antwort-Port |
| `--osc-remote-port` | `9000` | OSC-Fernsteuerung (0 = aus) |
| `--data-dir` | `./unableset-data` | Setlists/Settings (Tipp: in den Live-Projektordner legen — dann zieht beim Umzug alles mit) |

Der Host läuft headless auf macOS, Windows und Raspberry Pi 5 (arm64) —
z. B. als systemd-Service mit `Restart=always` (Watchdog).

## Locator-Notation

| Locator-Name | Bedeutung |
|---|---|
| `Songtitel` | startet einen Song |
| `Songtitel {Beschreibung}` | mit Beschreibung |
| `>Chorus` | Section innerhalb des laufenden Songs |
| `>Drop +LOOP:4` | loop-bare Section |
| `*Irgendwas` | wird ignoriert |
| `SONG END` | beendet den laufenden Song (Lücke bis zum nächsten) |
| `STOP` | beendet den Song, Playback hält dort an |
| `Titel +STOP` | Playback hält am Songende an |

Details: [PROTOCOL.md](packages/shared/PROTOCOL.md)

## Bedienung

**Tastatur:** `Space` Play/Stop · `Enter` gequeueten Sprung sofort ·
`Esc` Queue verwerfen · `→`/`N` nächster Song · `←`/`P` vorheriger Song ·
`S` Stop

**Cuen:** Song oder Section antippen → wird gequeued (gelb hervorgehoben) und
springt je nach Jump-Modus an der nächsten Grenze — oder sofort per
„⤳ Jetzt". Bei stehendem Transport positioniert ein Tap direkt.

**Sperren:** Schloss oben rechts macht das Gerät zur reinen Anzeige
(Musiker-/Sänger-View).

**OSC-Fernsteuerung** (TouchOSC / Companion, UDP :9000): `/unableset/play`,
`/stop`, `/continue`, `/next`, `/prev`, `/jump`, `/queue <index>`,
`/safemode <0|1>` — für Companion das generische OSC-Modul verwenden.

**MIDI-Fußcontroller:** `<data-dir>/midi-map.json` anlegen, z. B.

```json
{
  "input": "MC6",
  "mappings": [
    { "event": "noteOn", "channel": 0, "data1": 60, "action": "play" },
    { "event": "noteOn", "channel": 0, "data1": 62, "action": "nextSong" }
  ]
}
```

und im Server-Package `@julusian/midi` installieren
(`pnpm --filter @unableset/server add @julusian/midi`) — ohne das Modul bleibt
MIDI einfach deaktiviert.

## Tests

- **122 Unit-/Integrationstests** (Vitest): Locator-Parser, Song-/Section-
  Builder, Jump-/Quantisierungs-Mathematik, Setlist-Engine (alle Jump-Modi,
  Safe Mode, Autoplay/STOP, Loops), Persistenz (atomar + Backup), Protokoll-
  Guards, MIDI-Matcher, Clock-Regeln, OSC-Bridge gegen simuliertes AbletonOSC
  (echtes UDP), WebSocket-Roundtrip mit 3 Clients
- **8 Headless-E2E-Tests** (Playwright, Chromium) gegen den kompletten Stack
  (Simulator + Host + gebauter Client): Verbinden/Snapshot, Play/Stop,
  Queue + Jump (stehend/laufend), Sections, Mixer, Sperre,
  Reorder + Reload-Persistenz

## Meilenstein-Status

- [x] **M0** – Gerüst: Monorepo, shared types, Host+Client, WS-Roundtrip, CI
- [x] **M1** – Ableton-Bridge (Weg A) + Read-Only: Locators/Transport/Tempo, Live-Anzeige, Restdauern
- [x] **M2** – Steuerung & Jumps: alle Jump-Modi, Queue+Highlight, Safe Mode, Autoplay/STOP, Shortcuts, Pre-Roll
- [x] **M3** – Setlist-Editor: Drag & Drop, Overrides, Farben/Notizen/Tags/Suche, mehrere Setlists, Import/Export, Song mehrfach, Sets
- [x] **M4** – Lyrics/Views: Teleprompter mit Akkorden + Auto-Scroll, sperrbare Views, Beat-Feedback *(Lyrics-Quelle: Setlist-Overrides; MIDI-Clip-Sync folgt)*
- [x] **M5** – MIDI/OSC/Mixer: OSC-In/Out, MIDI-Mapping (Datei, Hardware optional), Mixer mit Lock *(MIDI-Learn-UI folgt)*
- [ ] **M6** – Redundanz (Multi-Host-Sync mit Drift-Korrektur)
- [x] **M7 (teilweise)** – QR-Code; *Canvas/Scripting, mDNS, Electron-Hülle folgen*
- [x] **M8 (teilweise)** – Show-Presets (mehrere Setlists), Zwei-Listen-Prinzip, TTS-Ansage, Clock-Aktionen; *Multi-File-Projekte, BandHelper-Import folgen*
- [ ] **M9** – Politur: PWA-Service-Worker, 2000+-Marker-Virtualisierung

Details und offene Architektur-Entscheidungen:
[docs/umsetzungsplan.md](docs/umsetzungsplan.md)

## Lizenz / IP

Eigenständige Implementierung ohne Code, Assets oder Branding von
Drittprodukten; Funktionsideen sind frei. `UnableSet` ist ein
Platzhalter-Name. AbletonOSC (MIT) wird als externes Remote-Script
angesprochen, nicht eingebettet.
