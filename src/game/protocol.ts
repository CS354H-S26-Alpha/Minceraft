import type { InventoryClickTarget, InventoryUiState } from "./crafting";
import type { PlayerPositionPacket, PlayerPublicState, PlayerState } from "./player";

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
  players: Record<string, PlayerPublicState>;
  /** Per-player ack counts; used by the client to trim its input history. */
  acks: Record<string, number>;
  /** Wall-clock time the server spent on the last tick (ms). */
  tickTimeMs: number;
  /** The client's own authoritative state, included when requested. */
  self?: PlayerState;
  /** Private inventory UI state for the current player. */
  inventoryUi?: InventoryUiState;
}

/** Per-session API surface available to a player once they've joined a room. */
export interface RoomSessionApi {
  /** Sends the latest client-reported position packet to the server. */
  sendPosition(packet: PlayerPositionPacket): void;
  /** Asks the server to include own state in the next tick's snapshot. */
  requestState(): void;
  /** Teleports this player to the given coordinates. */
  teleportTo(x: number, y: number, z: number): void;
  /** Interacts with the inventory or crafting UI. */
  clickInventory(target: InventoryClickTarget): void;
  /** Returns crafting/cursor items back to the player's inventory. */
  closeInventory(): void;
  /** Changes the active hotbar slot. */
  selectHotbarSlot(slotIndex: number): void;
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
