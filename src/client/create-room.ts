import { newWebSocketRpcSession } from "capnweb";
import { createSignal, onCleanup } from "solid-js";
import { Player, type PlayerInput, playerDistanceSq } from "../game/player";
import type { GameApi, RoomSnapshot } from "../game/protocol";
import { ClientEntity } from "./replication";

const INPUT_SEND_INTERVAL_MS = 50;
const DEFAULT_PLAYER_HEALTH = 100;

export function createRoom(roomId: string, playerId: string) {
  const player = new Player({ id: playerId, x: 0, y: 100, z: 0, health: DEFAULT_PLAYER_HEALTH });
  const replicated = new ClientEntity(player, playerDistanceSq);
  const [snapshot, setSnapshot] = createSignal<RoomSnapshot>({ tick: 0, players: {}, acks: {} });

  const api = newWebSocketRpcSession<GameApi>(`wss://${window.location.host}/api`);
  const session = api.join(roomId, playerId, (snap: RoomSnapshot) => {
    setSnapshot(snap);
    const auth = snap.players[playerId];
    if (auth) replicated.reconcile(auth, snap.acks[playerId] ?? 0);
  });

  let unsent: PlayerInput[] = [];
  const sendTimer = setInterval(() => {
    if (unsent.length === 0) return;
    session.sendInputs(unsent);
    unsent = [];
  }, INPUT_SEND_INTERVAL_MS);

  function input(next: PlayerInput) {
    replicated.predict(next);
    unsent.push(next);
  }

  onCleanup(() => {
    clearInterval(sendTimer);
    session.leave();
    api[Symbol.dispose]();
  });

  return { player, snapshot, input } as const;
}
