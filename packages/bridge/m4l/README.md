# UnableSet Bridge — Weg B (Max for Live)

Beat-genaue Alternative zum AbletonOSC-Remote-Script (Weg A): Ein
Max-for-Live-Device pusht die Song-Position alle **20 ms** direkt aus der
LiveAPI (statt ~100-ms-Polling) und beantwortet dieselben OSC-Adressen wie
AbletonOSC — der UnableSet-Host läuft **unverändert**, nur mit anderen Ports:

```bash
node packages/server/dist/index.js --osc-port 11010 --osc-listen-port 11011
```

## Installation (Live 11/12 Suite oder Max-Lizenz)

1. In Live ein **Max-Audio-Effekt**-Device auf einem beliebigen Track anlegen
   (oder das mitgelieferte Patch direkt öffnen).
2. `unableset-bridge.maxpat` und `unableset-bridge.js` in denselben Ordner
   legen und das Patch im Max-Editor öffnen — es besteht nur aus
   `[udpreceive 11010] → [js unableset-bridge.js] → [udpsend 127.0.0.1 11011]`.
3. Als `.amxd` einfrieren/speichern und ins Set ziehen. `loadbang`
   initialisiert die Bridge automatisch.

Läuft der Host auf einem anderen Rechner, im Patch das `udpsend`-Ziel auf
dessen IP ändern.

## Status

Funktionsfertig implementiert, aber **noch nicht gegen echtes Max/Live
verifiziert** (headless nicht möglich) — Weg A bleibt bis dahin der
empfohlene Standard. Beide Wege implementieren dasselbe Protokoll
(PROTOCOL.md §2) hinter demselben `AbletonBridge`-Interface.
