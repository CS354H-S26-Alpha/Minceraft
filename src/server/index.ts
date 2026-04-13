import { Entrypoint, handler } from "@cloudflare/actors";
import { newWorkersRpcResponse } from "capnweb";
import { GameRoom, GameServer } from "../game/room";

export { GameRoom };

// NOTE: not really enforced on the actual RPC calls since those are made via capnweb
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Rejects cross-origin requests by comparing the `Origin` header's host
 * against the request URL's host. Same-origin requests and requests without
 * an `Origin` header are allowed.
 */
function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const requestHost = new URL(request.url).host;
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

/**
 * Cloudflare Worker entrypoint. Routes `/api` to the capnweb RPC handler
 * and rejects everything else with appropriate HTTP status codes.
 */
export class Worker extends Entrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api") {
        if (!isAllowedOrigin(request)) {
          return new Response("Forbidden", { status: 403, headers: SECURITY_HEADERS });
        }
        return await newWorkersRpcResponse(request, new GameServer(this.env));
      }
      return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: "worker fetch error", error: message, path: url.pathname }));
      return new Response("Internal server error", { status: 500, headers: SECURITY_HEADERS });
    }
  }
}

export default handler(Worker);
