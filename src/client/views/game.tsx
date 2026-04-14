import { createSignal, Show } from "solid-js";
import { RENDERABLE_PLACED_OBJECT_TYPES } from "@/game/object-placement";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { createGame } from "../engine";
import { joinWorld } from "../primitives/join-world";

export default function GameView() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();

  const room = joinWorld("world-1");
  const game = createGame({
    glCanvas,
    room,
  });

  return (
    <div class="relative h-screen w-screen overflow-hidden">
      <canvas ref={setGlCanvas} class="absolute inset-0 h-full w-full" />
      <Show when={room.player()?.state}>
        {(playerState) => (
          <DiagnosticsPanel
            playerState={playerState()}
            fps={game.diagnostics.client.fps}
            computeTimeMs={game.diagnostics.client.computeTimeMs}
            computeTimeHistory={game.diagnostics.client.computeTimeHistory}
            placedObjectCount={game.diagnostics.client.placedObjectCount}
            generatedPlacedObjectCount={game.diagnostics.client.generatedPlacedObjectCount}
            placedObjectCounts={RENDERABLE_PLACED_OBJECT_TYPES.map((type) => ({
              type,
              count: game.diagnostics.client.placedObjectCounts[type],
            }))}
            tps={game.diagnostics.server.tps}
            mspt={game.diagnostics.server.mspt}
            msptHistory={game.diagnostics.server.msptHistory}
            snapsPerSec={game.diagnostics.server.snapsPerSec}
            onlinePlayers={Object.values(room.snapshot.players)}
            onTeleportTo={(id) => {
              const target = room.snapshot.players[id];
              const session = room.session();
              if (!target || !session) return;
              room.replicated()?.teleport({ x: target.x, y: target.y, z: target.z });
              session.teleportTo(target.x, target.y, target.z);
            }}
            pointerLocked={game.diagnostics.client.pointerLocked}
          />
        )}
      </Show>
    </div>
  );
}
