import { makePersisted } from "@solid-primitives/storage";
import { createSignal, Suspense } from "solid-js";
import { generateName } from "@/utils/name";
import { Spinner } from "./components/Spinner";
import { SessionProvider } from "./session";
import { worldReady } from "./state/loading";
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
      <div
        class="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black transition-opacity duration-500"
        classList={{ "opacity-0": worldReady(), "opacity-100": !worldReady() }}
      >
        <Spinner />
      </div>
    </Suspense>
  );
}
