import { newHttpBatchRpcSession } from "capnweb";
import { createContext, useContext } from "solid-js";
import type { GameApi } from "../shared/types.js";

type GameApiSession = ReturnType<typeof newHttpBatchRpcSession<GameApi>>;

const GameApiContext = createContext<GameApiSession>();

export const GameApiProvider = GameApiContext.Provider;

export function useGameApi(): GameApiSession {
  const ctx = useContext(GameApiContext);
  if (!ctx) throw new Error("useGameApi must be used within a GameApiProvider");
  return ctx;
}

export function createGameApi() {
  return newHttpBatchRpcSession<GameApi>("/api");
}
