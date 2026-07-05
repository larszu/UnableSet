import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Im Dev-Modus proxen wir API + WebSocket auf den lokal laufenden Host,
// damit Client (5173) und Host (4400) wie in Produktion zusammenspielen.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:4400',
      '/ws': {
        target: 'ws://localhost:4400',
        ws: true,
      },
    },
  },
});
