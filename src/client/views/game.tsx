import { createSignal } from "solid-js";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { createRoom } from "../create-room";
import { createGame } from "../engine";

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [textCanvas, setTextCanvas] = createSignal<HTMLCanvasElement>();

  const { player, snapshot, snapCount, input, cameraOrientation } = createRoom("world-1");

  const game = createGame({
    glCanvas,
    inputCanvas: textCanvas,
    player,
    sendInput: input,
    cameraOrientation,
    snapshot,
    snapCount,
    localPlayerId: player.id,
  });

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <canvas ref={setTextCanvas} class="absolute inset-0 z-10 h-full w-full" />
      <DiagnosticsPanel
        playerName={player.state.name}
        fps={game.fps}
        computeTimeMs={game.computeTimeMs}
        computeTimeHistory={game.computeTimeHistory}
        tps={game.tps}
        mspt={game.mspt}
        msptHistory={game.msptHistory}
        snapsPerSec={game.snapsPerSec}
        onlinePlayers={Object.values(snapshot().players).map((p) => p.name)}
        pointerLocked={game.mouse.pointerLocked}
      />
    </div>
  );
}
