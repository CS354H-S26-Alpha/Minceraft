import { newWorkersRpcResponse } from "capnweb";
import { GameApiServer } from "./api.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api") {
      return newWorkersRpcResponse(request, new GameApiServer());
    }

    return new Response("Not found", { status: 404 });
  },
};
