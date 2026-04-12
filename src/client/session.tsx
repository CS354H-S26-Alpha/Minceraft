import { newWebSocketRpcSession } from "capnweb";
import { createContext, createResource, onCleanup, type ParentProps, Show, useContext } from "solid-js";
import type { GameApi, PlayerCredentials, RoomSessionApi, RoomSnapshot } from "../game/protocol";

interface SessionContextValue {
  credentials: PlayerCredentials;
  join(roomId: string, onSnapshot: (snap: RoomSnapshot) => void): Promise<RoomSessionApi>;
}

const SessionContext = createContext<SessionContextValue>();

export function SessionProvider(props: { name: string } & ParentProps) {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const api = newWebSocketRpcSession<GameApi>(`${wsProtocol}//${window.location.host}/api`);

  const [session] = createResource(async () => {
    const authPromise = api.authenticate(props.name);
    const [auth, credentials] = await Promise.all([authPromise, authPromise.credentials]);
    return {
      credentials,
      join: (roomId: string, onSnapshot: (snap: RoomSnapshot) => void) => auth.join(roomId, onSnapshot),
    } satisfies SessionContextValue;
  });

  onCleanup(() => api[Symbol.dispose]());

  return (
    <Show when={session()}>
      {(value) => <SessionContext.Provider value={value()}>{props.children}</SessionContext.Provider>}
    </Show>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
