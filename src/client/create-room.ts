import { makeTimer } from "@solid-primitives/timer";
import { createSignal, onCleanup } from "solid-js";
import { Player, type PlayerInput, playerDistanceSq } from "../game/player";
import type { RoomSessionApi, RoomSnapshot } from "../game/protocol";
import { ClientEntity } from "./replication";
import { useSession } from "./session";

const INPUT_SEND_INTERVAL_MS = 50;

export interface Orientation {
  yaw: number;
  pitch: number;
}

/**
 * SolidJS primitive that connects to a game room over capnweb WebSocket RPC.
 *
 * Creates a local `Player`, joins the server room, and sets up an input
 * batching interval. Returns reactive accessors consumed by `createGame`.
 * Must be called inside a Solid reactive scope; tears down via `onCleanup`.
 */
export function joinWorld(roomId: string) {
  const { credentials, join } = useSession();
  const { playerId, name } = credentials;

  const player = new Player({ id: playerId, name, x: 0, y: 70, z: 20, yaw: 0, pitch: 0 });
  const replicated = new ClientEntity(player, playerDistanceSq);
  const [snapshot, setSnapshot] = createSignal<RoomSnapshot>({
    tick: 0,
    players: {},
    acks: {},
    tickTimeMs: 0,
  });
  const [cameraOrientation, setCameraOrientation] = createSignal<Orientation | null>(null);

  let snapCount = 0;

  let synced = false;
  let session: RoomSessionApi | undefined;
  join(roomId, (snap: RoomSnapshot) => {
    snapCount++;
    setSnapshot(snap);
    const auth = snap.players[playerId];
    if (auth) {
      const applied = replicated.reconcile(auth, snap.acks[playerId] ?? 0);
      if (applied) {
        setCameraOrientation({ yaw: auth.yaw, pitch: auth.pitch });
      }
      synced = true;
    }
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
    if (!synced) return;
    replicated.predict(next);
    unsent.push(next);
  }

  onCleanup(() => {
    session?.leave();
  });

  return { player, snapshot, snapCount: () => snapCount, input, cameraOrientation } as const;
}
