import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { connectToHost } from './ws.js';
import './index.css';

connectToHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
