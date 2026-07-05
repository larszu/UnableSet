import { create } from 'zustand';
import {
  INITIAL_TRANSPORT,
  type BridgeStatus,
  type ServerMessage,
  type Setlist,
  type Song,
  type TransportState,
} from '@unableset/shared';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface AppState {
  connection: ConnectionState;
  latencyMs: number | null;
  serverVersion: string | null;
  bridge: BridgeStatus | null;
  transport: TransportState;
  songs: Song[];
  setlist: Setlist | null;

  setConnection(connection: ConnectionState): void;
  setLatency(latencyMs: number): void;
  applyServerMessage(message: ServerMessage): void;
}

export const useAppStore = create<AppState>((set) => ({
  connection: 'connecting',
  latencyMs: null,
  serverVersion: null,
  bridge: null,
  transport: INITIAL_TRANSPORT,
  songs: [],
  setlist: null,

  setConnection: (connection) => set({ connection }),
  setLatency: (latencyMs) => set({ latencyMs }),

  applyServerMessage: (message) => {
    switch (message.type) {
      case 'snapshot':
        set({
          serverVersion: message.state.serverVersion,
          bridge: message.state.bridge,
          transport: message.state.transport,
          songs: message.state.songs,
          setlist: message.state.setlist,
        });
        break;
      case 'transport':
        set({ transport: message.transport });
        break;
      case 'songs':
        set({ songs: message.songs, setlist: message.setlist });
        break;
      case 'bridge':
        set({ bridge: message.bridge });
        break;
      case 'pong':
        // Latenz wird in ws.ts berechnet (braucht die lokale Sendezeit)
        break;
    }
  },
}));
