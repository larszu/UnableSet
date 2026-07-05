# UnableSet – Protokoll-Referenz

Dieses Dokument beschreibt die beiden Schnittstellen des Hosts:

1. **WebSocket-Protokoll** Host ↔ Browser-Clients (`packages/shared/src/protocol.ts`)
2. **OSC-Protokoll** Host ↔ Ableton Live (`packages/shared/src/oscAddresses.ts`)

Grundsatz: **Der Host ist die einzige Wahrheitsquelle.** Clients sind
synchronisierte Ansichten. Jeder State-Change wird an alle Clients
gebroadcastet; ein (re)verbundener Client bekommt sofort einen vollen
Snapshot.

---

## 1. WebSocket-Protokoll

- Endpoint: `ws://<host>:<port>/ws`
- Frames: JSON (UTF-8), ein Objekt pro Frame, Feld `type` diskriminiert.
- Ungültige Frames werden **ignoriert** (geloggt), niemals ein Grund für einen
  Verbindungsabbruch — auf der Bühne darf nichts crashen.

### Client → Host

| `type` | Payload | Bedeutung |
|---|---|---|
| `hello` | `role?`, `deviceName?` | Selbstauskunft nach Connect (View-Preset, Anzeige im Host) |
| `ping` | `id`, `sentAt` (epoch ms) | Latenz-Messung; Host antwortet mit `pong` |
| `command` | `command: TransportCommand` | Transport-Steuerung (siehe unten) |
| `refreshLocators` | – | Bridge soll Cue Points neu aus Live lesen |

`TransportCommand` (M0-Prototyp, wird in M2 erweitert):

| `action` | Parameter | Wirkung |
|---|---|---|
| `play` | – | Ableton „Play" (vom Songanfang der aktuellen Position) |
| `stop` | – | Ableton „Stop" |
| `continue` | – | Ableton „Continue" (weiter ab Pause-Position) |
| `jumpToLocator` | `locatorIndex` | Springt auf einen Cue Point (Index in der Cue-Point-Liste) |

### Host → Client

| `type` | Payload | Wann |
|---|---|---|
| `snapshot` | `state: HostState` | direkt nach Connect/Reconnect |
| `transport` | `transport: TransportState` | bei jeder Transport-Änderung (Position ~10 Hz bei laufendem Playback) |
| `songs` | `songs: Song[]`, `setlist: Setlist` | wenn Locators neu gelesen/geparst wurden |
| `bridge` | `bridge: BridgeStatus` | Verbindungsstatus zur Ableton-Bridge geändert |
| `pong` | `id`, `sentAt`, `serverTime` | Antwort auf `ping` |

Alle Typen sind in `packages/shared/src/types.ts` definiert und werden von
Host und Client gemeinsam importiert.

---

## 2. OSC-Protokoll zur Ableton-Bridge (Weg A)

Die Bridge spricht das Adressschema von
[AbletonOSC](https://github.com/ideoforms/AbletonOSC) (MIT-Lizenz), einem
quelloffenen MIDI-Remote-Script für Live 11/12. Installation siehe README.

- Transport: UDP. Live lauscht auf Port **11000**, Antworten kommen auf Port
  **11001** zurück (beides konfigurierbar via CLI-Flags des Hosts).
- Antworten tragen dieselbe OSC-Adresse wie die Anfrage.

### Vom Host verwendete Adressen

| Adresse | Richtung | Zweck |
|---|---|---|
| `/live/test` | → / ← | Handshake + Heartbeat (alle 2 s; 5 s Timeout ⇒ „getrennt") |
| `/live/application/get/version` | → / ← | Live-Version für Statusanzeige |
| `/live/song/get/tempo` | → / ← | Tempo (BPM, float) |
| `/live/song/get/is_playing` | → / ← | Transport läuft? |
| `/live/song/get/current_song_time` | → / ← | Position in Beats (Vierteln); Polling ~10 Hz bei Playback |
| `/live/song/get/song_length` | → / ← | Arrangement-Länge in Beats |
| `/live/song/get/cue_points` | → / ← | Locator-Liste als abwechselnd `name` (string), `time` (float) |
| `/live/song/get/signature_numerator` | → / ← | Taktart-Zähler |
| `/live/song/get/signature_denominator` | → / ← | Taktart-Nenner |
| `/live/song/start_listen/<prop>` | → | Change-Listener registrieren (`tempo`, `is_playing`, Taktart) |
| `/live/song/stop_listen/<prop>` | → | Listener abmelden (beim Shutdown) |
| `/live/song/start_playing` | → | Play |
| `/live/song/stop_playing` | → | Stop |
| `/live/song/continue_playing` | → | Continue |
| `/live/song/cue_point/jump` | → | Sprung auf Cue Point (Argument: Index oder Name) |

**Beat-genaue Quantisierung** ist mit Weg A eine Host-Rechnung aus Tempo +
Position (Ziel: M2); sample-genaue Jumps liefert später die optionale
Max-for-Live-Bridge (Weg B) hinter demselben `AbletonBridge`-Interface.

---

## 3. Locator-Notation (Cue-Point-Namen → Setlist)

Der Parser (`packages/bridge/src/locatorParser.ts`) versteht:

| Notation | Bedeutung |
|---|---|
| `Songtitel` | startet einen Song an der Locator-Position |
| `Songtitel {Beschreibung}` | Beschreibung (in der Setlist sichtbar, nicht Teil des Titels) |
| `*Irgendwas` | Locator wird komplett ignoriert (kein Song, kein Marker) |
| `SONG END` | beendet den laufenden Song; bis zum nächsten Locator ist „kein Song" |
| `STOP` | wie `SONG END`, zusätzlich `stopAfter` für den beendeten Song |
| `+STOP` (Token im Songnamen) | Playback soll am Songende anhalten |
| `+KEY` / `+KEY:VALUE` | generische Flags (z. B. `+LOOP:4`, `+SECTIONS`) — geparst, Auswertung folgt in späteren Meilensteinen |

Groß-/Kleinschreibung ist bei Markern und Flags egal. Ein Song endet am
nächsten Marker/Locator, der letzte Song an der Arrangement-Länge.
