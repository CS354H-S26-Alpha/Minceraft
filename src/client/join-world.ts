import { makeTimer } from "@solid-primitives/timer";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Player, type PlayerInput } from "../game/player";
import type { RoomSessionApi, RoomSnapshot } from "../game/protocol";
import { LocalPrediction } from "./engine/local-prediction";
import { useSession } from "./session";

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

  let snapCount = 0;
  let session: RoomSessionApi | undefined;
  join(roomId, (snap: RoomSnapshot) => {
    snapCount++;
    setSnapshot(reconcile(snap));

    // Server includes our own state in `self` when we requested it.
    if (snap.self && !player()) {
      setPlayer(new Player(snap.self));
    }

    replicated()?.acknowledge(snap.acks[playerId] ?? 0);
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

  onCleanup(() => {
    session?.leave();
  });

  return { player, snapshot, snapCount: () => snapCount, input } as const;
}
