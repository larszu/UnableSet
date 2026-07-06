# UnableSet Desktop (Electron-Hülle)

Optionale Desktop-App für macOS/Windows: startet den Host automatisch,
zeigt die Web-UI in einem Fenster, bietet ein Tray-Icon und ein kleines
Always-on-top-**Floating-Window** für die Bühne. Stürzt der Host ab, startet
die Hülle ihn nach 2 s neu (Watchdog).

Der Host bleibt vollständig ohne Electron lauffähig (`node
packages/server/dist/index.js`) — für Raspberry Pi & Headless-Setups.

## Start

```bash
# einmalig im Repo-Root bauen:
pnpm build

cd apps/desktop
npm install        # lädt Electron (bewusst NICHT Teil des pnpm-Workspace)
npm start          # Port über UNABLESET_PORT übersteuerbar
```

Hinweis: Dieses Verzeichnis liegt außerhalb des pnpm-Workspace, damit
`pnpm install` im Repo-Root schlank bleibt (kein Electron-Binary-Download).
