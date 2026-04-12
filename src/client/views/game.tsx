import { createSignal } from "solid-js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { joinWorld } from "../create-room";
import { createGame } from "../engine";

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [textCanvas, setTextCanvas] = createSignal<HTMLCanvasElement>();

  const room = joinWorld("world-1");

  const game = createGame({
    glCanvas,
    inputCanvas: textCanvas,
    room,
  });

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <canvas ref={setTextCanvas} class="absolute inset-0 z-10 h-full w-full" />
      <DiagnosticsPanel
        playerName={room.player.state.name}
        fps={game.diagnostics.renderer.fps}
        computeTimeMs={game.diagnostics.server.computeTimeMs}
        computeTimeHistory={game.diagnostics.server.computeTimeHistory}
        tps={game.diagnostics.server.tps}
        mspt={game.diagnostics.server.mspt}
        msptHistory={game.diagnostics.server.msptHistory}
        snapsPerSec={game.diagnostics.server.snapsPerSec}
        onlinePlayers={Object.values(room.snapshot().players).map((p) => p.name)}
        pointerLocked={game.diagnostics.renderer.mouse.pointerLocked}
      />
    </div>
  );
}
