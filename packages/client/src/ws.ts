/**
 * WebSocket-Verbindung zum Host mit automatischem Reconnect (Exponential
 * Backoff, 0,5 s → 5 s) und Latenz-Messung per Ping/Pong. Der Host schickt
 * nach jedem (Re)Connect einen vollen Snapshot — der Client hält nie eigenen
 * Wahrheits-State.
 */

import {
  WS_PATH,
  parseServerMessage,
  serializeMessage,
  type ClientMessage,
} from '@unableset/shared';
import { useAppStore } from './store.js';

const PING_INTERVAL_MS = 2000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 5000;

let socket: WebSocket | null = null;
let backoffMs = BACKOFF_MIN_MS;
let pingTimer: number | null = null;
let pingId = 0;

export function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(serializeMessage(message));
  }
}

function startPinging(): void {
  stopPinging();
  pingTimer = window.setInterval(() => {
    pingId += 1;
    send({ type: 'ping', id: pingId, sentAt: Date.now() });
  }, PING_INTERVAL_MS);
}

function stopPinging(): void {
  if (pingTimer !== null) window.clearInterval(pingTimer);
  pingTimer = null;
}

export function connectToHost(): void {
  const store = useAppStore.getState();
  store.setConnection('connecting');

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    backoffMs = BACKOFF_MIN_MS;
    useAppStore.getState().setConnection('open');
    send({ type: 'hello', deviceName: navigator.userAgent.slice(0, 60) });
    startPinging();
  };

  socket.onmessage = (event) => {
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === 'pong') {
      useAppStore.getState().setLatency(Date.now() - message.sentAt);
      return;
    }
    useAppStore.getState().applyServerMessage(message);
  };

  socket.onclose = () => {
    stopPinging();
    useAppStore.getState().setConnection('closed');
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    window.setTimeout(connectToHost, delay);
  };

  socket.onerror = () => {
    socket?.close();
  };
}
