# Sicherheit

UnableSet ist ein **offline-first LAN-Werkzeug** für die Bühne: Host und
Clients laufen im selben lokalen Netz, ohne Cloud, ohne Internetzwang. Das
Bedrohungsmodell ist entsprechend das eines vertrauenswürdigen Backstage-LAN —
nicht das öffentliche Internet. Der Host sollte **nicht** ungeschützt ins
Internet exponiert werden.

## Umgesetzte Härtung

**Dependencies**
- `pnpm audit` ist Teil des Reviews; Stand des letzten Laufs: **0 bekannte
  Schwachstellen**. Ein transitives, verwundbares `ws` (über `osc`) wird per
  pnpm-Override auf die gepatchte Version gezwungen.

**HTTP (Express)**
- Security-Header auf allen Antworten: `Content-Security-Policy` (nur
  eigene Herkunft; `blob:` für den Canvas-Script-Worker, `data:` für
  QR-Codes, keine Fremd-Hosts), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` (Geo/Mikrofon/Kamera aus).
- `X-Powered-By` entfernt.
- Statische Auslieferung über `express.static` (kein Directory-Traversal).

**WebSocket (`ws`)**
- `maxPayload` = 256 KB pro Frame (Schutz vor Speicher-Missbrauch).
- Grobe Ratenbegrenzung pro Verbindung (400 Nachrichten/s); darüber werden
  Frames verworfen, die Verbindung bleibt bestehen.
- Alle eingehenden Frames werden tolerant geparst; ungültige/unbekannte
  Nachrichten werden ignoriert, ein Client-Kommando kann den Host nie zum
  Absturz bringen (try/catch pro Kommando).

**Kommando-Validierung**
- `sendOsc` (Canvas-Scripting): nur Adressen, die mit `/` beginnen und
  ≤ 200 Zeichen sind.
- `sharedSet`: Schlüssel ≤ 64 Zeichen, String-Werte ≤ 1024 Zeichen, maximal
  256 Schlüssel im geteilten Store.
- `projectOpen` (Multi-File): **Allowlist** — nur in `projects.json`
  registrierte Pfade werden geöffnet, nie beliebige Pfade vom Client.

**Scripting-Sandbox (Canvas)**
- User-Skripte laufen in einem **Web Worker** ohne DOM-, Netzwerk- oder
  Storage-Zugriff. Die API ist auf `sendOsc`/`command`/`shared`/`setShared`/
  `log`/`transport` beschränkt; Ausgaben werden im Main-Thread validiert,
  bevor sie den Host erreichen. Harter **500-ms-Timeout** gegen
  Endlosschleifen.

**Externe Tokens / Geheimnisse**
- UnableSet speichert keine Zugangsdaten. Setlists/Settings liegen als
  JSON im `--data-dir` (atomar geschrieben, mit `.bak`-Rotation).

## Empfehlungen für den Betrieb

- Host im vertrauenswürdigen Bühnen-/Proben-LAN betreiben, nicht ins
  Internet portforwarden.
- Für sensible Umgebungen ein isoliertes WLAN/VLAN nur für die Show nutzen.
- OSC-Fernsteuerung (`--osc-remote-port`) hört auf UDP; in offenen Netzen
  mit `--osc-remote-port 0` deaktivieren.

## Schwachstelle melden

Privat an den Repository-Eigentümer (`larszu`) melden — bitte nicht als
öffentliches Issue.
