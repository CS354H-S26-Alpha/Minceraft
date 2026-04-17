import { createMemo, For, Show } from "solid-js";
import { ENEMY_HEIGHT, ENEMY_MAX_HEALTH, type EnemyPublicState } from "@/game/enemy";

interface EnemyHealthBarsProps {
  enemies: () => Readonly<Record<string, EnemyPublicState>>;
  frame: number;
  hidden?: boolean;
  projectWorldToScreen: (x: number, y: number, z: number) => { x: number; y: number; depth: number } | undefined;
}

interface EnemyBar {
  id: string;
  health: number;
  left: number;
  top: number;
}

const BAR_WIDTH_PX = 56;
const BAR_HEIGHT_PX = 8;
const BAR_WORLD_Y_OFFSET = ENEMY_HEIGHT + 0.7;

export function EnemyHealthBars(props: EnemyHealthBarsProps) {
  const bars = createMemo<EnemyBar[]>(() => {
    props.frame;
    return Object.values(props.enemies())
      .map((enemy) => {
        const projected = props.projectWorldToScreen(enemy.x, enemy.y + BAR_WORLD_Y_OFFSET, enemy.z);
        if (!projected) return undefined;
        return {
          id: enemy.id,
          health: enemy.health,
          left: projected.x,
          top: projected.y,
        };
      })
      .filter((bar): bar is EnemyBar => bar !== undefined);
  });

  return (
    <Show when={!props.hidden}>
      <div class="pointer-events-none absolute inset-0 z-20">
        <For each={bars()}>
          {(bar) => {
            const fillPercent = `${Math.max(0, Math.min(1, bar.health / ENEMY_MAX_HEALTH)) * 100}%`;
            return (
              <div
                class="absolute"
                style={{
                  left: `${bar.left}px`,
                  top: `${bar.top}px`,
                  width: `${BAR_WIDTH_PX}px`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div class="mb-1 text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                  enemy
                </div>
                <div
                  class="overflow-hidden rounded-sm border border-black/90 bg-black/80 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                  style={{ height: `${BAR_HEIGHT_PX}px` }}
                >
                  <div
                    class="h-full bg-[linear-gradient(90deg,#ffea61_0%,#ff7c1f_45%,#ff2f2f_100%)]"
                    style={{ width: fillPercent }}
                  />
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
