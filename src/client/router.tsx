import { makePersisted } from "@solid-primitives/storage";
import { createSignal } from "solid-js";
import { generateName } from "@/utils/name";
import { SessionProvider } from "./session";
import GameView from "./views/game";

// TODO: replace with proper login/auth
export default function Router() {
  const [name, setName] = makePersisted(createSignal(generateName()), {
    name: "player-name",
  });
  // persist player name to localStorage, slightly buggy ._.
  setName(name());

  return (
    <SessionProvider name={name()}>
      <GameView />
    </SessionProvider>
  );
}
