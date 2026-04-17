import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { LocalPrediction } from "@/client/engine/entities";
import { useSession } from "@/client/session";
import { createInventoryUiState } from "@/game/crafting";
import { Player, type PlayerPublicState, type PlayerState } from "@/game/player";
import type { ChunkDataPacket, RoomSessionApi, ServerPacket, ServerTick } from "@/game/protocol";
import { createSoundEffects } from "./sounds";

/** Reactive server-side diagnostics derived from every tick. */
export interface TickInfo {
  tick: number;
  tickTimeMs: number;
  timeOfDayS: number;
}

/**
 * SolidJS primitive that connects to a game room over capnweb WebSocket RPC.
 *
 * Joins the server room and waits for the first tick to construct the local
 * `Player` from authoritative state. Returns reactive accessors consumed by
 * `createGame`. Must be called inside a Solid reactive scope.
 */
export function joinWorld(roomId: string) {
  const { join } = useSession();
  const [player, setPlayer] = createSignal<Player>();
  const replicated = createMemo(() => {
    const p = player();
    return p ? new LocalPrediction(p) : undefined;
  });

  const [remotePlayers, setRemotePlayers] = createStore<Record<string, PlayerPublicState>>({});
  const [tickInfo, setTickInfo] = createStore<TickInfo>({ tick: 0, tickTimeMs: 0, timeOfDayS: 0 });
  const [inventoryUi, setInventoryUi] = createStore(createInventoryUiState());
  const sounds = createSoundEffects();

  const blockAckQueue: Array<{ seq: number; accepted: boolean }> = [];
  const blockChangesQueue: Array<{ x: number; y: number; z: number; blockType: number }> = [];
  const chunkDataQueue: Array<ChunkDataPacket["chunks"]> = [];

  const [snapCount, setSnapCount] = createSignal(0);
  const [session, setSession] = createSignal<RoomSessionApi>();

  // The tick callback fires from capnweb (outside Solid's reactive scope).
  // batch coalesces the store + signal writes into a single reactive flush.
  join(roomId, (serverTick: ServerTick) => {
    batch(() => {
      setSnapCount((c) => c + 1);
      setTickInfo("tick", serverTick.tick);
      for (const packet of serverTick.packets) {
        applyPacket(packet);
      }
    });
  }).then((s) => setSession(() => s));

  function applyPacket(packet: ServerPacket) {
    switch (packet.type) {
      case "players":
        setRemotePlayers(reconcile(packet.players));
        return;
      case "ack":
        replicated()?.acknowledge(packet.sequence);
        return;
      case "reconcile": {
        const current = player();
        if (!current) {
          setPlayer(new Player(packet.state));
        } else {
          applyAuthoritativePlayerState(current, packet.state, true);
        }
        return;
      }
      case "self": {
        const current = player();
        if (!current) {
          setPlayer(new Player(packet.state));
        } else {
          applyAuthoritativePlayerState(current, packet.state, false);
        }
        return;
      }
      case "inventoryUi":
        setInventoryUi(reconcile(packet.ui));
        return;
      case "world":
        setTickInfo("tickTimeMs", packet.tickTimeMs);
        setTickInfo("timeOfDayS", packet.timeOfDayS);
        return;
      case "blockAck":
        blockAckQueue.push(...packet.acks);
        return;
      case "blockChanges":
        blockChangesQueue.push(...packet.changes);
        return;
      case "chunkData":
        chunkDataQueue.push(packet.chunks);
        return;
    }
  }

  function applyAuthoritativePlayerState(current: Player, nextState: PlayerState, includeTransform: boolean) {
    const previousHealth = current.state.health;
    if (includeTransform) {
      replicated()?.initialize(nextState);
    } else {
      const { x, y, z, yaw, pitch, ...rest } = nextState;
      Object.assign(current.state, rest);
    }
    if (nextState.health < previousHealth) sounds.playPlayerHit();
  }

  onCleanup(() => {
    session()?.leave();
  });

  return {
    player,
    remotePlayers,
    tickInfo,
    snapCount,
    session,
    replicated,
    inventoryUi,
    blockAckQueue,
    blockChangesQueue,
    chunkDataQueue,
  } as const;
}
