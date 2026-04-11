import { makeTimer } from "@solid-primitives/timer";
import { createSignal, onCleanup } from "solid-js";
import { Player, type PlayerInput, playerDistanceSq } from "../game/player";
import type { RoomSessionApi, RoomSnapshot } from "../game/protocol";
import { ClientEntity } from "./replication";
import { useSession } from "./session";

const INPUT_SEND_INTERVAL_MS = 50;

export function createRoom(roomId: string) {
  const { credentials, join } = useSession();
  const { playerId, name } = credentials;

  const player = new Player({ id: playerId, name, x: 0, y: 70, z: 20, yaw: 0, pitch: 0 });
  const replicated = new ClientEntity(player, playerDistanceSq);
  const [snapshot, setSnapshot] = createSignal<RoomSnapshot>({ tick: 0, players: {}, acks: {} });

  let session: RoomSessionApi | undefined;
  join(roomId, (snap: RoomSnapshot) => {
    setSnapshot(snap);
    const auth = snap.players[playerId];
    if (auth) replicated.reconcile(auth, snap.acks[playerId] ?? 0);
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
    replicated.predict(next);
    unsent.push(next);
  }

  onCleanup(() => {
    session?.leave();
  });

  return { player, snapshot, input } as const;
}
