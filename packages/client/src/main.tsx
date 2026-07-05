import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { connectToHost } from './ws.js';
import './index.css';

connectToHost();

// PWA: Offline-Shell (nur im Build — der Vite-Dev-Server liefert kein sw.js)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Ohne SW funktioniert alles weiter — nur kein Offline-Start
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
