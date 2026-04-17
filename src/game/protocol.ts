import type { InventoryClickTarget, InventoryUiState } from "./crafting";
import type { PlacedObject, PlacedObjectType } from "./object-placement";
import type { PlayerAttackPacket, PlayerPositionPacket, PlayerPublicState, PlayerState } from "./player";

/** Credentials returned after successful authentication. */
export interface PlayerCredentials {
  playerId: string;
  name: string;
}

/** Remote player positions and rotations for this tick. */
export interface PlayersPacket {
  type: "players";
  /** Remote players visible to the receiving client, keyed by player ID. */
  players: Record<string, PlayerPublicState>;
}

/** Latest input sequence the server has applied for the receiving client. */
export interface AckPacket {
  type: "ack";
  sequence: number;
}

/** Non-positional self state (inventory, health, hotbar selection). */
export interface SelfStatePacket {
  type: "self";
  state: PlayerState;
}

/** Authoritative position override — client should snap to this state. */
export interface ReconcilePacket {
  type: "reconcile";
  state: PlayerState;
}

/** Private crafting/inventory UI state for the receiving client. */
export interface InventoryUiPacket {
  type: "inventoryUi";
  ui: InventoryUiState;
}

/** A block mutation request sent by the client. */
export interface BlockActionPacket {
  seq: number;
  action: "place" | "break";
  x: number;
  y: number;
  z: number;
  blockType?: number;
}

/** Per-player acknowledgement of block actions. */
export interface BlockAckPacket {
  type: "blockAck";
  acks: Array<{ seq: number; accepted: boolean }>;
}

/** Block changes to apply to chunk data (broadcast to all clients). */
export interface BlockChangesPacket {
  type: "blockChanges";
  changes: Array<{ x: number; y: number; z: number; blockType: number }>;
}

/** Server-pushed chunk block data (RLE-encoded) for the receiving client. */
export interface ChunkDataPacket {
  type: "chunkData";
  chunks: Array<{
    originX: number;
    originZ: number;
    blocks: Uint8Array;
    placedObjects: readonly PlacedObject[];
    placedObjectCounts: Readonly<Record<PlacedObjectType, number>>;
  }>;
}

/** World-wide state — tick cost, time-of-day, etc. */
export interface WorldStatePacket {
  type: "world";
  /** Wall-clock time the server spent on the last tick (ms). */
  tickTimeMs: number;
  /** Server-authoritative day/night cycle position in seconds [0, DAY_LENGTH_S) (`DAY_LENGTH_S` wraps to `0`). */
  timeOfDayS: number;
}

/** Discriminated union of every packet the server may send to a client. */
export type ServerPacket =
  | PlayersPacket
  | AckPacket
  | SelfStatePacket
  | ReconcilePacket
  | InventoryUiPacket
  | WorldStatePacket
  | BlockAckPacket
  | BlockChangesPacket
  | ChunkDataPacket;

/** A single server tick delivered to one client. */
export interface ServerTick {
  /** Monotonically increasing server tick counter. */
  tick: number;
  /** All packets produced by systems (and the room) for this client. */
  packets: ServerPacket[];
}

/** Per-session API surface available to a player once they've joined a room. */
export interface RoomSessionApi {
  /** Sends the latest client-reported position packet to the server. */
  sendPosition(packet: PlayerPositionPacket): void;
  /** Sends a block place/break action to the server. */
  sendBlockAction(action: BlockActionPacket): void;
  /** Asks the server to include own state in the next tick's snapshot. */
  requestState(): void;
  /** Teleports this player to the given coordinates. */
  teleportTo(x: number, y: number, z: number): void;
  /** Respawns this player at the world spawn with starter state. */
  respawn(): void;
  /** Interacts with the inventory or crafting UI. */
  clickInventory(target: InventoryClickTarget): void;
  /** Returns crafting/cursor items back to the player's inventory. */
  closeInventory(): void;
  /** Changes the active hotbar slot. */
  selectHotbarSlot(slotIndex: number): void;
  /** Attempts a melee attack from a client-authoritative snapshot. */
  attack(packet: PlayerAttackPacket): void;
  /** Sets the server-authoritative time of day (seconds within the day cycle). */
  setTimeOfDay(timeS: number): void;
  /** Leaves the room and disposes the session. */
  leave(): void;
}

/** API surface available to a client after authentication. */
export interface AuthenticatedApi {
  /** The authenticated player's credentials. */
  get credentials(): PlayerCredentials;
  /** Join a named room and register a tick listener. */
  join(roomId: string, onTick: (tick: ServerTick) => void): Promise<RoomSessionApi>;
}

/** Top-level WebSocket RPC entry point. */
export interface GameApi {
  /** Authenticate with a display name and receive an `AuthenticatedApi` capability. */
  authenticate(name: string): Promise<AuthenticatedApi>;
}
