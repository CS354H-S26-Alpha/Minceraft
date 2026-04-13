import { makeTimer } from "@solid-primitives/timer";
import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { LocalPrediction } from "@/client/engine/entities";
import { useSession } from "@/client/session";
import { createInventoryUiState, type InventoryClickTarget } from "@/game/crafting";
import { cloneInventory, Player, type PlayerInput, type PlayerState } from "@/game/player";
import type { RoomSessionApi, RoomSnapshot } from "@/game/protocol";

const INPUT_SEND_INTERVAL_MS = 50;

/**
 * SolidJS primitive that connects to a game room over capnweb WebSocket RPC.
 *
 * Joins the server room and waits for the first snapshot to construct the
 * local `Player` from authoritative state. Returns reactive accessors
 * consumed by `createGame`. Must be called inside a Solid reactive scope.
 */
export function joinWorld(roomId: string) {
  const { credentials, join } = useSession();
  const { playerId } = credentials;
  const [player, setPlayer] = createSignal<Player>();
  const [selfStateVersion, setSelfStateVersion] = createSignal(0);
  const replicated = createMemo(() => {
    const p = player();
    return p ? new LocalPrediction(p) : undefined;
  });

  const [snapshot, setSnapshot] = createStore<RoomSnapshot>({
    tick: 0,
    players: {},
    acks: {},
    tickTimeMs: 0,
  });
  const [inventoryUi, setInventoryUi] = createStore(createInventoryUiState());

  const [snapCount, setSnapCount] = createSignal(0);
  let session: RoomSessionApi | undefined;

  // The snapshot callback fires from capnweb (outside Solid's reactive scope).
  // batch coalesces the store + signal writes into a single reactive flush.
  join(roomId, (snap: RoomSnapshot) => {
    batch(() => {
      setSnapCount((c) => c + 1);
      setSnapshot(reconcile(snap));
      if (snap.inventoryUi) {
        setInventoryUi(reconcile(snap.inventoryUi));
      }

      if (snap.self) {
        const current = player();
        if (current) {
          syncPrivatePlayerState(current, snap.self);
        } else {
          setPlayer(new Player(snap.self));
        }
        setSelfStateVersion((version) => version + 1);
      }

      replicated()?.acknowledge(snap.acks[playerId] ?? 0);
    });
  }).then((s) => {
    session = s;
  });

  let unsent: PlayerInput[] = [];
  makeTimer(
    () => {
      if (unsent.length === 0 || !session) return;
      session.sendInputs(unsent);
      unsent = [];
    },
    INPUT_SEND_INTERVAL_MS,
    setInterval,
  );

  function input(next: PlayerInput) {
    const r = replicated();
    if (!r) return;
    r.predict(next);
    unsent.push(next);
  }

  function clickInventory(target: InventoryClickTarget) {
    session?.clickInventory(target);
  }

  function closeInventory() {
    session?.closeInventory();
  }

  function requestState() {
    session?.requestState();
  }

  function selectHotbarSlot(slotIndex: number) {
    if (player()?.setSelectedHotbarSlot(slotIndex)) {
      setSelfStateVersion((version) => version + 1);
    }
    session?.selectHotbarSlot(slotIndex);
  }

  onCleanup(() => {
    session?.closeInventory();
    session?.leave();
  });

  return {
    player,
    snapshot,
    snapCount,
    selfStateVersion,
    inventoryUi,
    input,
    clickInventory,
    closeInventory,
    requestState,
    selectHotbarSlot,
  } as const;
}

function syncPrivatePlayerState(player: Player, self: PlayerState) {
  player.state.name = self.name;
  player.state.health = self.health;
  player.state.inventory = cloneInventory(self.inventory);
  player.state.selectedHotbarSlot = self.selectedHotbarSlot;
}
