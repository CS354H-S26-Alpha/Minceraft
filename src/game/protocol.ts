import type { PlayerInput, PlayerState } from "./player";

/** Credentials returned after successful authentication. */
export interface PlayerCredentials {
  playerId: string;
  name: string;
}

/**
 * Point-in-time snapshot of the room's authoritative state, broadcast to all
 * connected clients after every tick that changes player positions.
 */
export interface RoomSnapshot {
  /** Monotonically increasing server tick counter. */
  tick: number;
  /** Current state of every remote player, keyed by player ID. */
  players: Record<string, PlayerState>;
  /** Per-player ack counts; used by the client to trim its input history. */
  acks: Record<string, number>;
  /** Wall-clock time the server spent on the last tick (ms). */
  tickTimeMs: number;
  /** The client's own authoritative state, included when requested. */
  self?: PlayerState;
}

/** Per-session API surface available to a player once they've joined a room. */
export interface RoomSessionApi {
  /** Sends a batch of player inputs to the server. */
  sendInputs(inputs: PlayerInput[]): void;
  /** Asks the server to include own state in the next tick's snapshot. */
  requestState(): void;
  /** Teleports this player to the given coordinates. */
  teleportTo(x: number, y: number, z: number): void;
  /** Leaves the room and disposes the session. */
  leave(): void;
}

/** API surface available to a client after authentication. */
export interface AuthenticatedApi {
  /** The authenticated player's credentials. */
  get credentials(): PlayerCredentials;
  /** Join a named room and register a snapshot listener. */
  join(roomId: string, onSnapshot: (snap: RoomSnapshot) => void): Promise<RoomSessionApi>;
}

/** Top-level WebSocket RPC entry point. */
export interface GameApi {
  /** Authenticate with a display name and receive an `AuthenticatedApi` capability. */
  authenticate(name: string): Promise<AuthenticatedApi>;
}
