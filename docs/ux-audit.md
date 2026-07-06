# UX- & Barrierefreiheits-Audit

Geprüft gegen die nicht-funktionalen Anforderungen des Briefs (§7): große
Touch-Ziele, hoher Kontrast, Dark-Theme, kein versehentliches Auslösen,
Tastaturbedienung, farbenblind-taugliche Statusfarben, Bühnentauglichkeit.

## Behoben in diesem Durchlauf

| Befund | Fix |
|---|---|
| Icon-Buttons (↑ ↓ ✎ ← →, ✕) ohne zugänglichen Namen | Alle Icon-Buttons haben jetzt `aria-label` **und** `title` (Screenreader + Tooltip) |
| Keine sichtbaren Fokus-Ringe → Tastaturbedienung unklar | Zentrale `Button`/`IconButton`/`Toggle`/`ToggleChip` setzen `focus-visible:outline` (2 px Akzent) |
| Toggle-Chips waren visuell Buttons, semantisch aber Umschalter | `role="switch"` + `aria-checked`; Toggles im Settings sind echte Checkboxen |
| Queue-Banner / Verbindungsverlust ohne Live-Ansage | Queue-Banner ist `role="status" aria-live="polite"`, Status-Badges tragen `role="status"` |
| Doppelte Button-/Toggle-/Card-Definitionen in drei Views | In `components/ui.tsx` zusammengeführt — ein Design, konsistente Größen/Fokus überall |
| Touch-Ziele teils 40 px | Sekundär-Buttons/Icon-Buttons jetzt ≥ 44 px (`min-h-11`), Steuer-Buttons ≥ 56 px |

## Bewusst so gelassen (mit Begründung)

- **Canvas-Edit-Controls (← ✎ →) unter jedem Widget sichtbar, wenn
  entsperrt.** Auf der Bühne wird das Gerät gesperrt (Schloss oben rechts),
  dann verschwinden sie und die Fläche ist reine Steuerung. Im Editier-Modus
  ist die Sichtbarkeit gewollt (direktes Anfassen ohne Hover, tauglich für
  Touch ohne Maus).
- **Statusfarben Grün/Rot** sind zusätzlich durch **Text** („PLAYING"/
  „STOPPED", „verbunden"/„getrennt") und Position eindeutig — nicht allein
  über Farbe (farbenblind-tauglich).
- **`user-scalable=no`** im Viewport: bewusst, damit auf der Bühne kein
  versehentliches Pinch-Zoom die Ansicht verschiebt. Schriftgrößen sind
  dafür durchgängig groß (Teleprompter bis `text-4xl`).

## Weiterhin erfüllte Grundsätze

- **Kein versehentliches Auslösen:** globaler Sperr-Modus pro Gerät, Safe
  Mode gegen Sofort-Sprünge, Bestätigungsdialoge beim Löschen von Setlists.
- **Reconnect ohne weißen Bildschirm:** Verbindungsverlust zeigt ein
  auffälliges Banner, die letzte Ansicht bleibt sichtbar, Reconnect läuft
  automatisch mit vollem State-Snapshot.
- **Tastatur:** alle Kern-Aktionen per Shortcut (`Space`/`Enter`/`Esc`/
  Pfeile/`S`), Eingabefelder werden dabei ausgenommen.
- **Wake-Lock + Fullscreen-fähig (PWA):** Display bleibt an, installierbar
  aufs Homescreen.

## Getestet

Die kritischen Flows sind in der Playwright-Suite abgesichert (Sperre
deaktiviert Steuerung, aber Ansicht bleibt; Reconnect stellt State her). Der
Kontrast des Dark-Themes (heller Text `#e8eefc` auf `#0a0f1a`) liegt deutlich
über WCAG-AA für normalen und großen Text.
