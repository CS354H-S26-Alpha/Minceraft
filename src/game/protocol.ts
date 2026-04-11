import type { PlayerInput, PlayerState } from "./player";

export interface PlayerCredentials {
  playerId: string;
  name: string;
}

export interface RoomSnapshot {
  tick: number;
  players: Record<string, PlayerState>;
  acks: Record<string, number>;
  tickTimeMs: number;
}

export interface RoomSessionApi {
  sendInputs(inputs: PlayerInput[]): void;
  leave(): void;
}

export interface AuthenticatedApi {
  get credentials(): PlayerCredentials;
  join(roomId: string, onSnapshot: (snap: RoomSnapshot) => void): Promise<RoomSessionApi>;
}

export interface GameApi {
  authenticate(name: string): Promise<AuthenticatedApi>;
}
