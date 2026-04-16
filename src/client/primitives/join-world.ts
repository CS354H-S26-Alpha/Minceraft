import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { LocalPrediction } from "@/client/engine/entities";
import { useSession } from "@/client/session";
import { createInventoryUiState } from "@/game/crafting";
import { Player, type PlayerPublicState } from "@/game/player";
import type { RoomSessionApi, ServerPacket, ServerTick } from "@/game/protocol";
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
          replicated()?.initialize(packet.state);
        }
        return;
      }
      case "self": {
        const current = player();
        if (!current) {
          setPlayer(new Player(packet.state));
        } else {
          const previousHealth = current.state.health;
          const { x, y, z, yaw, pitch, ...rest } = packet.state;
          Object.assign(current.state, rest);
          if (packet.state.health < previousHealth) sounds.playPlayerHit();
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
    }
  }

  onCleanup(() => {
    session()?.leave();
  });

  return { player, remotePlayers, tickInfo, snapCount, session, replicated, inventoryUi } as const;
}
