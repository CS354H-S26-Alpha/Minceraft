import { newWebSocketRpcSession } from "capnweb";
import { createContext, createResource, createSignal, onCleanup, type ParentProps, Show, useContext } from "solid-js";
import type { GameApi, PlayerCredentials, RoomSessionApi, ServerTick } from "../game/protocol";

interface SessionContextValue {
  credentials: PlayerCredentials;
  join(roomId: string, onTick: (tick: ServerTick) => void): Promise<RoomSessionApi>;
}

const SessionContext = createContext<SessionContextValue>();

/** Brief pause before reload so the overlay is visible. */
const RELOAD_DELAY_MS = 800;

/**
 * SolidJS context provider that opens the capnweb WebSocket session,
 * authenticates with the given name, and makes the session available to
 * descendants via `useSession()`. Renders children only after authentication
 * completes.
 *
 * When the WebSocket breaks, we have no reconnect logic — so any break is
 * terminal. Flip `disconnected` to show a brief overlay, then reload.
 */
export function SessionProvider(props: { name: string } & ParentProps) {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const api = newWebSocketRpcSession<GameApi>(`${wsProtocol}//${window.location.host}/api`);
  const [disconnected, setDisconnected] = createSignal(false);

  api.onRpcBroken((error) => {
    if (disconnected()) return;
    console.error("RPC connection broken:", error);
    setDisconnected(true);
    setTimeout(() => location.reload(), RELOAD_DELAY_MS);
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
    <>
      <Show when={session()}>
        {(resolved) => <SessionContext.Provider value={resolved()}>{props.children}</SessionContext.Provider>}
      </Show>
      <Show when={disconnected()}>
        <DisconnectOverlay />
      </Show>
    </>
  );
}

function DisconnectOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "background-color": "rgba(0, 0, 0, 0.75)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "z-index": "9999",
        color: "white",
        "font-family": "system-ui, sans-serif",
        "font-size": "18px",
      }}
    >
      Connection lost — reloading…
    </div>
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
