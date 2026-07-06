/**
 * Bündelt den Host-Server in eine einzige CJS-Datei für das Electron-Packaging
 * (keine node_modules-Auflösung zur Laufzeit nötig). Nutzt das mit Vite
 * installierte esbuild. Optionale native Module bleiben external (Runtime-
 * `import()` mit try/catch im Code).
 *
 *   node scripts/bundle-server.mjs  →  packages/server/dist-bundle/server.cjs
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'packages/server/dist/index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(root, 'packages/server/dist-bundle/server.cjs'),
  // Optionale Hardware-/native Module: zur Laufzeit optional, nie gebündelt
  external: ['@julusian/midi', '@serialport/bindings-cpp', 'serialport', 'bufferutil', 'utf-8-validate'],
  // ESM→CJS: import.meta.url auf __filename umbiegen (Server nutzt fileURLToPath)
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: {
    js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
  logLevel: 'info',
});

console.log('Server gebündelt → packages/server/dist-bundle/server.cjs');
