import { makePersisted } from "@solid-primitives/storage";
import { createSignal, Suspense } from "solid-js";
import { generateName } from "@/utils/name";
import { SessionProvider } from "./session";
import GameView from "./views/game";

// TODO: replace with proper login/auth
export default function Router() {
  const [name, setName] = makePersisted(createSignal(generateName()), {
    name: "player-name",
  });
  // persist player name to localStorage, makePersisted isn't working properly for some reason ._.
  setName(name());

  return (
    <Suspense>
      <SessionProvider name={name()}>
        <GameView />
      </SessionProvider>
    </Suspense>
  );
}
