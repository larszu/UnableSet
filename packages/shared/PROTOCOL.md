# UnableSet – Protokoll-Referenz

Dieses Dokument beschreibt die drei Schnittstellen des Hosts:

1. **WebSocket-Protokoll** Host ↔ Browser-Clients (`packages/shared/src/protocol.ts`)
2. **OSC-Protokoll** Host ↔ Ableton Live (`packages/shared/src/oscAddresses.ts`)
3. **OSC-Fernsteuerung** des Hosts (TouchOSC, Open Stage Control, Bitfocus Companion)

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
| `hello` | `role?`, `deviceName?` | Selbstauskunft nach Connect |
| `ping` | `id`, `sentAt` | Latenz-Messung; Host antwortet mit `pong` |
| `command` | `command: TransportCommand` | Play / Stop / Continue / `jumpToLocator` |
| `refreshLocators` | – | Cue Points neu aus Live lesen |
| `queue` | `songId`, `entryId?`, `sectionId?` | Song/Section cuen; bei stehendem Transport sofortiger Sprung |
| `clearQueue` | – | Queue verwerfen |
| `jumpNow` | – | Gequeueten Sprung sofort ausführen (Safe Mode blockiert bei Playback) |
| `nextSong` / `prevSong` | – | Nächsten/vorherigen Setlist-Eintrag cuen |
| `setJumpMode` | `mode: JumpMode` | quantized / endOfSection / endOfSong / dynamic / manual |
| `setSafeMode` | `enabled` | Safe Mode an/aus |
| `setPreRoll` | `bars` | Pre-Roll (Count-in) für Section-Sprünge, 0–8 Takte |
| `setHidePlayed` | `enabled` | Gespielte Songs ausblenden |
| `markPlayed` | `entryId`, `played` | Eintrag abhaken |
| `loopSection` | `songId`, `sectionId`, `enabled` | Ableton-Loop-Bracket um die Section |
| `setlistUpdate` | `setlist: Setlist` | Komplette Setlist ersetzen (Reorder, Overrides, Sets) |
| `setlistCreate` | `name`, `copyFromId?` | Neue Setlist (optional als Kopie) |
| `setlistDelete` | `setlistId` | Setlist löschen (`default` nicht löschbar) |
| `setlistActivate` | `setlistId` | Aktive Setlist wechseln |
| `setlistImportText` | `name`, `text` | Plaintext-Import (eine Zeile = ein Song, `# Set` als Trenner) |
| `mixerRefresh` | – | Tracks neu aus Live lesen |
| `mixerSet` | `trackIndex`, `field`, `value` | `volume` (0..1) / `mute` / `solo` |
| `clockRulesUpdate` | `rules: ClockRule[]` | Uhrzeit-Aktionen ersetzen |

### Host → Client

| `type` | Payload | Wann |
|---|---|---|
| `snapshot` | `state: HostState` | direkt nach Connect/Reconnect |
| `transport` | `transport` | bei jeder Transport-Änderung (~10 Hz bei Playback) |
| `songs` | `songs` | Locators neu geparst |
| `setlists` | `setlists`, `activeSetlistId` | Setlist-Änderungen |
| `engine` | `engine: EngineState` | Queue/Jump-Modus/Safe-Mode/Played geändert |
| `tracks` | `tracks: TrackInfo[]` | Mixer-Zustand gelesen |
| `clockRules` | `rules` | Clock-Regeln geändert |
| `bridge` | `bridge` | Verbindungsstatus zur Ableton-Bridge |
| `pong` | `id`, `sentAt`, `serverTime` | Antwort auf `ping` |

### REST (ergänzend)

| Route | Zweck |
|---|---|
| `GET /api/health` | Liveness (`{ok, version}`) |
| `GET /api/state` | Voller Host-State als JSON |
| `GET /api/info` | LAN-URLs des Hosts (QR-Code-Quelle) |
| `GET /api/setlist/export.txt` | Plaintext-Export der aktiven Setlist |

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
| `/live/song/get/tempo` | → / ← | Tempo (BPM) |
| `/live/song/get/is_playing` | → / ← | Transport läuft? |
| `/live/song/get/current_song_time` | → / ← | Position in Beats; Polling ~10 Hz bei Playback |
| `/live/song/set/current_song_time` | → | Position setzen (Basis aller Setlist-Jumps) |
| `/live/song/get/song_length` | → / ← | Arrangement-Länge in Beats |
| `/live/song/get/cue_points` | → / ← | Locator-Liste (`name`, `time` alternierend) |
| `/live/song/get/signature_numerator` / `_denominator` | → / ← | Taktart |
| `/live/song/get/num_tracks` | → / ← | Track-Anzahl |
| `/live/song/start_listen/<prop>` / `stop_listen` | → | Change-Listener (`tempo`, `is_playing`, Taktart) |
| `/live/song/start_playing` / `stop_playing` / `continue_playing` | → | Transport |
| `/live/song/cue_point/jump` | → | Sprung auf Cue Point |
| `/live/song/set/loop` / `loop_start` / `loop_length` | → | Loop-Bracket (Section-Loops) |
| `/live/track/get|set/name·volume·mute·solo` | → / ← | Mixer (Argument: Track-Index) |

**Beat-genaue Quantisierung** ist mit Weg A eine Host-Rechnung aus Tempo +
Position (`packages/shared/src/jump.ts`, unit-getestet); sample-genaue Jumps
liefert später die optionale Max-for-Live-Bridge (Weg B) hinter demselben
`AbletonBridge`-Interface.

---

## 3. OSC-Fernsteuerung des Hosts (OSC-In)

Der Host lauscht selbst auf UDP (Default-Port **9000**, `--osc-remote-port`,
`0` = deaktiviert). Kompatibel mit TouchOSC, Open Stage Control und dem
generischen OSC-Modul von **Bitfocus Companion**.

| Adresse | Argument | Aktion |
|---|---|---|
| `/unableset/play` | – | Play |
| `/unableset/stop` | – | Stop |
| `/unableset/continue` | – | Continue |
| `/unableset/next` | – | nächsten Setlist-Eintrag cuen |
| `/unableset/prev` | – | vorherigen Setlist-Eintrag cuen |
| `/unableset/jump` | – | gequeueten Sprung sofort ausführen |
| `/unableset/queue` | int: Eintrags-Index (0-basiert) | Song aus der aktiven Setlist cuen |
| `/unableset/safemode` | int: 0/1 | Safe Mode setzen |

**MIDI-Fernsteuerung:** Mapping-Datei `<data-dir>/midi-map.json` (Note/CC/
Program-Change → Aktion); Hardware-Anbindung optional via `@julusian/midi`
(siehe `packages/server/src/midiMapping.ts`).

### OSC-Out-Feed (Floor-Displays, Licht, Video)

Mit `--osc-out host:port[,host2:port2]` sendet der Host einen herstellerneutralen
Status-Feed (plus die `oscOnEnter`-Nachrichten des jeweiligen Songs, editierbar
im Setlist-Editor, Zeilen-Notation `/adresse arg1 arg2 …`):

| Adresse | Argumente | Wann |
|---|---|---|
| `/unableset/out/song` | `index` (int, 0-basiert), `titel` | Songwechsel |
| `/unableset/out/next` | `titel` | Songwechsel (nächster Eintrag) |
| `/unableset/out/section` | `name` | Section-Wechsel |
| `/unableset/out/playing` | `0/1` | Play/Stop |

### Redundanz (M6, `--mirror`)

Mit `--mirror host:port[,…]` spiegelt der Host alle Transport-/Mixer-Kommandos
an weitere AbletonOSC-Rigs (Backup-Rechner). Pro Ziel laufen Heartbeat und
Drift-Messung (`current_song_time`); Abweichungen über 0,25 Beats werden bei
laufendem Playback automatisch korrigiert — unterhalb der Schwelle greift
nichts mehr ein. Status (verbunden/Drift/Korrekturen) erscheint im Snapshot
(`mirrors`) und in den Settings.

### Discovery

Der Host announced sich per mDNS als `_unableset._tcp` (und `_http._tcp`),
abschaltbar mit `--no-mdns`. Zusätzlich liefert `GET /api/info` die LAN-URLs
für den QR-Code.

---

## 4. Locator-Notation (Cue-Point-Namen → Setlist)

Der Parser (`packages/bridge/src/locatorParser.ts`) versteht:

| Notation | Bedeutung |
|---|---|
| `Songtitel` | startet einen Song an der Locator-Position |
| `Songtitel {Beschreibung}` | Beschreibung (in der Setlist sichtbar, nicht Teil des Titels) |
| `>Section-Name` | Section innerhalb des laufenden Songs (z. B. `>Chorus`) |
| `*Irgendwas` | Locator wird komplett ignoriert (kein Song, kein Marker) |
| `SONG END` | beendet den laufenden Song; bis zum nächsten Locator ist „kein Song" |
| `STOP` | wie `SONG END`, zusätzlich `stopAfter` für den beendeten Song |
| `+STOP` (Token im Songnamen) | Playback soll am Songende anhalten |
| `+LOOP:4` (Token an einer Section) | Section als loop-bar markieren (Anzahl optional) |
| `+KEY` / `+KEY:VALUE` | generische Flags — geparst, weitere Auswertung folgt |

Groß-/Kleinschreibung ist bei Markern und Flags egal. Ein Song endet am
nächsten Song-/Marker-Locator (Sections zählen nicht), der letzte Song an der
Arrangement-Länge.
