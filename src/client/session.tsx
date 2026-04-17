import { newWebSocketRpcSession } from "capnweb";
import { createContext, createResource, onCleanup, type ParentProps, Show, useContext } from "solid-js";
import type { GameApi, PlayerCredentials, RoomSessionApi, ServerTick } from "../game/protocol";

interface SessionContextValue {
  credentials: PlayerCredentials;
  join(roomId: string, onTick: (tick: ServerTick) => void): Promise<RoomSessionApi>;
}

const SessionContext = createContext<SessionContextValue>();

/**
 * SolidJS context provider that opens the capnweb WebSocket session,
 * authenticates with the given name, and makes the session available to
 * descendants via `useSession()`. Renders children only after authentication
 * completes.
 */
export function SessionProvider(props: { name: string } & ParentProps) {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const api = newWebSocketRpcSession<GameApi>(`${wsProtocol}//${window.location.host}/api`);

  api.onRpcBroken((error) => {
    console.error("RPC connection broken:", error);
    location.reload(); // temp bad fix
  });

  const [session] = createResource(async () => {
    const authPromise = api.authenticate(props.name);
    const [auth, credentials] = await Promise.all([authPromise, authPromise.credentials]);
    return {
      credentials,
      join: (roomId: string, onTick: (tick: ServerTick) => void) => auth.join(roomId, onTick),
    } satisfies SessionContextValue;
  });

  onCleanup(() => api[Symbol.dispose]());

  return (
    <Show when={session()}>
      {(resolved) => <SessionContext.Provider value={resolved()}>{props.children}</SessionContext.Provider>}
    </Show>
  );
}

/**
 * Returns the current session context.
 * @throws If called outside a `<SessionProvider>`.
 */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
