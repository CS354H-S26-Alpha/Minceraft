import { createSignal } from "solid-js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { createGame } from "../engine";
import { joinWorld } from "../join-world";

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
        playerName={room.player()?.state.name ?? ""}
        fps={game.diagnostics.client.fps}
        computeTimeMs={game.diagnostics.client.computeTimeMs}
        computeTimeHistory={game.diagnostics.client.computeTimeHistory}
        tps={game.diagnostics.server.tps}
        mspt={game.diagnostics.server.mspt}
        msptHistory={game.diagnostics.server.msptHistory}
        snapsPerSec={game.diagnostics.server.snapsPerSec}
        onlinePlayers={Object.values(room.snapshot.players).map((p) => p.name)}
        pointerLocked={game.diagnostics.client.mouse.pointerLocked}
      />
    </div>
  );
}
