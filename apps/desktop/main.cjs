/**
 * UnableSet Desktop-Hülle (Electron, optional — M7):
 * - startet den Host-Server als Kindprozess (Auto-Start)
 * - Hauptfenster mit der Web-UI, Tray-Icon mit Statusmenü
 * - Floating-Window (klein, always-on-top) für die Bühne
 *
 * Der Host bleibt vollständig ohne Electron lauffähig (CLI, Pi) —
 * diese Hülle ist reiner Komfort für macOS/Windows-Rechner.
 *
 * Start:  cd apps/desktop && npm install && npm start
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

const HTTP_PORT = Number(process.env.UNABLESET_PORT ?? 4400);
const URL = `http://localhost:${HTTP_PORT}`;

const fs = require('node:fs');

/**
 * Server-Entry finden: im Release liegt das gebündelte server.cjs unter
 * resources/server/, in der Entwicklung das normale dist/index.js.
 */
function resolveServer() {
  const packaged = path.join(process.resourcesPath ?? '', 'server', 'server.cjs');
  if (process.resourcesPath && fs.existsSync(packaged)) {
    return {
      entry: packaged,
      clientDist: path.join(process.resourcesPath, 'client', 'dist'),
    };
  }
  return {
    entry: path.join(__dirname, '..', '..', 'packages', 'server', 'dist', 'index.js'),
    clientDist: path.join(__dirname, '..', '..', 'packages', 'client', 'dist'),
  };
}

const SERVER = resolveServer();

let serverProcess = null;
let mainWindow = null;
let floatingWindow = null;
let tray = null;
let quitting = false;

function startServer() {
  serverProcess = fork(SERVER.entry, ['--http-port', String(HTTP_PORT)], {
    stdio: 'inherit',
    env: { ...process.env, UNABLESET_CLIENT_DIST: SERVER.clientDist },
  });
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    // Watchdog: Host-Absturz darf die Show nicht beenden — neu starten
    if (!quitting) {
      console.error(`Host beendet (Code ${code}) — Neustart in 2 s`);
      setTimeout(startServer, 2000);
    }
  });
}

async function waitForHost() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // noch nicht bereit
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    backgroundColor: '#0a0f1a',
    title: 'UnableSet',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.removeMenu();
  mainWindow.loadURL(URL);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // Externe Links im System-Browser öffnen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function toggleFloatingWindow() {
  if (floatingWindow) {
    floatingWindow.close();
    floatingWindow = null;
    return;
  }
  floatingWindow = new BrowserWindow({
    width: 420,
    height: 300,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    backgroundColor: '#0a0f1a',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  floatingWindow.loadURL(URL);
  floatingWindow.setAlwaysOnTop(true, 'screen-saver');
  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });
}

function createTray() {
  // 16x16-PNG (1x1 skaliert) als minimales Tray-Icon; OS rendert Monochrom
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOUlEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMgpEIAAglAAGkG9C1AAAAAElFTkSuQmCC',
  );
  tray = new Tray(icon);
  tray.setToolTip('UnableSet Host');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'UnableSet öffnen', click: createMainWindow },
      { label: 'Floating-Window umschalten', click: toggleFloatingWindow },
      { label: `Host: ${URL}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Beenden',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', createMainWindow);
}

app.whenReady().then(async () => {
  startServer();
  await waitForHost();
  createTray();
  createMainWindow();
});

app.on('window-all-closed', () => {
  // Host läuft im Tray weiter — die Show darf nicht enden, weil ein Fenster zu ist
});

app.on('before-quit', () => {
  quitting = true;
  serverProcess?.kill('SIGTERM');
});
