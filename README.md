# UnableSet

Browser-basierter Setlist- und Playback-Controller für Ableton Live —
quelloffene, eigenständige Neuimplementierung. Ein MD/Playback-Engineer steuert
von jedem Gerät im LAN (Handy, iPad, Laptop, Fußcontroller) eine aus
Ableton-Locators erzeugte Setlist, ohne die Live-Session anzufassen und ohne
Internetverbindung.

**Status: M0 + Bridge-Prototyp (Weg A).** Monorepo-Gerüst, gemeinsames
Datenmodell, Host mit WebSocket-Broadcast, Client-Grundgerüst und eine echte
OSC-Bridge, die Locators/Transport/Tempo aus Live liest.

## Architektur

```
Ableton Live  ←OSC/UDP→  Host (Node/TS)  ←WebSocket→  Clients (Browser/PWA)
  AbletonOSC              Single Source                Setlist · Performance
  Remote-Script           of Truth                     · Lyrics · Mixer · …
```

- `packages/shared` — Datenmodell, WS-Protokoll, OSC-Adressen ([PROTOCOL.md](packages/shared/PROTOCOL.md))
- `packages/bridge` — Ableton-Anbindung hinter dem `AbletonBridge`-Interface;
  Weg A: OSC via [AbletonOSC](https://github.com/ideoforms/AbletonOSC),
  Weg B (später): Max for Live, beat-genau
- `packages/server` — Host: State-Store, WebSocket-Server, REST, statischer Client
- `packages/client` — React-PWA (React 19, Vite, Tailwind 4, Zustand)

Der Host ist die einzige Wahrheitsquelle; Clients sind synchronisierte
Ansichten mit automatischem Reconnect + vollem State-Snapshot.

## Setup

Voraussetzungen: Node ≥ 20, pnpm ≥ 9, Ableton Live 11/12 mit installiertem
[AbletonOSC](https://github.com/ideoforms/AbletonOSC)-Remote-Script
(MIT-Lizenz; in Live unter *Settings → Link/Tempo/MIDI → Control Surface*
aktivieren).

```bash
pnpm install
pnpm build            # alle Packages (shared zuerst, topologisch)
pnpm test             # Vitest in allen Packages
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit in allen Packages

# Entwicklung (Host auf :4400, Client-Dev-Server auf :5173 mit Proxy):
pnpm dev

# Produktion: Client bauen, dann liefert der Host alles auf einem Port aus
pnpm build
node packages/server/dist/index.js --http-port 4400
```

CLI-Flags des Hosts: `--http-port` (Default 4400), `--osc-host` (127.0.0.1),
`--osc-port` (11000), `--osc-listen-port` (11001).

## Locator-Notation

Songs entstehen aus Ableton-Locators (Cue Points), die Session wird nie
verändert. Notation (Details in [PROTOCOL.md](packages/shared/PROTOCOL.md)):

| Locator-Name | Bedeutung |
|---|---|
| `Songtitel` | startet einen Song |
| `Songtitel {Beschreibung}` | mit Beschreibung |
| `*Irgendwas` | wird ignoriert |
| `SONG END` | beendet den laufenden Song |
| `STOP` | beendet den Song, Playback soll dort anhalten |
| `+FLAG` / `+FLAG:WERT` | Flags wie `+STOP`, `+LOOP:4` (Auswertung folgt) |

## Meilensteine

- [x] **M0** – Gerüst: Monorepo, shared types, Host+Client, WS-Roundtrip, CI/Lint/Tests
- [x] **M0.5** – Prototyp Ableton-Bridge Weg A (Locators/Transport/Tempo lesen)
- [ ] **M1** – Read-Only bühnenstabil (Live-Anzeige Song/Section/Position/Restdauer)
- [ ] **M2** – Steuerung & Jumps (Jump-Modi, Queue, Safe Mode, Autoplay/STOP)
- [ ] **M3** – Setlist-Editor (Drag & Drop, Overrides, Import/Export, Sets)
- [ ] **M4** – Lyrics/Chords + Views
- [ ] **M5** – MIDI/OSC/Mixer
- [ ] **M6** – Redundanz (Multi-Host-Sync)
- [ ] **M7** – Canvas & Scripting, Fußcontroller, QR/mDNS, Electron-Host
- [ ] **M8** – Differenzierer (Show-Presets, Zwei-Listen, TTS, Clock-Aktionen)
- [ ] **M9** – Politur (PWA-Härtung, 2000+ Marker, E2E)

Umsetzungsplan und offene Architektur-Entscheidungen:
[docs/umsetzungsplan.md](docs/umsetzungsplan.md)

## Lizenz / IP

Eigenständige Implementierung ohne Code, Assets oder Branding von
Drittprodukten. `UnableSet` ist ein Platzhalter-Name.
