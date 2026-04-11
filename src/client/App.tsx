import { createSignal } from "solid-js";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { createRoom } from "./create-room";
import { createGame } from "./engine";

export default function App() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [textCanvas, setTextCanvas] = createSignal<HTMLCanvasElement>();

  const { player, input } = createRoom("world-1", crypto.randomUUID());

  const game = createGame({
    glCanvas,
    inputCanvas: textCanvas,
    player,
    sendInput: input,
  });

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <canvas ref={setTextCanvas} class="absolute inset-0 z-10 h-full w-full" />
      <DiagnosticsPanel
        fps={game.fps}
        computeTimeMs={game.computeTimeMs}
        computeTimeHistory={game.computeTimeHistory}
        pointerLocked={game.mouse.pointerLocked}
      />
    </div>
  );
}
