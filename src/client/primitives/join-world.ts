import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { LocalPrediction } from "@/client/engine/entities";
import { useSession } from "@/client/session";
import { createInventoryUiState } from "@/game/crafting";
import { Player } from "@/game/player";
import type { RoomSessionApi, RoomSnapshot } from "@/game/protocol";

/**
 * SolidJS primitive that connects to a game room over capnweb WebSocket RPC.
 *
 * Joins the server room and waits for the first snapshot to construct the
 * local `Player` from authoritative state. Returns reactive accessors
 * consumed by `createGame`. Must be called inside a Solid reactive scope.
 */
export function joinWorld(roomId: string) {
  const { join, credentials } = useSession();
  const playerId = credentials.playerId;
  const [player, setPlayer] = createSignal<Player>();
  const replicated = createMemo(() => {
    const p = player();
    return p ? new LocalPrediction(p) : undefined;
  });

  const [snapshot, setSnapshot] = createStore<RoomSnapshot>({
    tick: 0,
    players: {},
    acks: {},
    tickTimeMs: 0,
    timeOfDayS: 0,
  });
  const [inventoryUi, setInventoryUi] = createStore(createInventoryUiState());

  const [snapCount, setSnapCount] = createSignal(0);
  const [session, setSession] = createSignal<RoomSessionApi>();

  // The snapshot callback fires from capnweb (outside Solid's reactive scope).
  // batch coalesces the store + signal writes into a single reactive flush.
  join(roomId, (snap: RoomSnapshot) => {
    batch(() => {
      setSnapCount((c) => c + 1);
      setSnapshot(reconcile(snap));
      if (snap.inventoryUi) {
        setInventoryUi(reconcile(snap.inventoryUi));
      }
      replicated()?.acknowledge(snap.acks[playerId] ?? 0);
      const currentPlayer = player();

      if (snap.self) {
        if (!currentPlayer) {
          setPlayer(new Player(snap.self));
        } else {
          replicated()?.initialize(snap.self);
        }
      }
    });
  }).then((s) => setSession(() => s));

  onCleanup(() => {
    session()?.leave();
  });

  return { player, snapshot, snapCount, session, replicated, inventoryUi } as const;
}
