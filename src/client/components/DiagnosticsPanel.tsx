const FRAME_GRAPH_WIDTH = 240;
const FRAME_GRAPH_HEIGHT = 80;
const FRAME_GRAPH_MAX_MS = 16.67;

interface DiagnosticsPanelProps {
  fps: number;
  computeTimeMs: number;
  computeTimeHistory: readonly number[];
  pointerLocked: boolean;
}

const frameGuides = [
  { label: "240Hz / 4.17ms", ms: 4.17, stroke: "rgb(34 197 94 / 0.7)" },
  { label: "120Hz / 8.33ms", ms: 8.33, stroke: "rgb(250 204 21 / 0.7)" },
  { label: "60Hz / 16.67ms", ms: 16.67, stroke: "rgb(239 68 68 / 0.7)" },
] as const;

const frameGuideY = (targetMs: number) =>
  (FRAME_GRAPH_HEIGHT - (targetMs / FRAME_GRAPH_MAX_MS) * FRAME_GRAPH_HEIGHT).toFixed(1);

const framePolyline = (history: readonly number[]) => {
  const step = history.length > 1 ? FRAME_GRAPH_WIDTH / (history.length - 1) : FRAME_GRAPH_WIDTH;
  return history
    .map((ms, index) => {
      const x = index * step;
      const clamped = Math.min(ms, FRAME_GRAPH_MAX_MS);
      const y = FRAME_GRAPH_HEIGHT - (clamped / FRAME_GRAPH_MAX_MS) * FRAME_GRAPH_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

export function DiagnosticsPanel(props: DiagnosticsPanelProps) {
  return (
    <div class="absolute top-2 right-2 z-20 w-80 rounded bg-black/60 p-3 font-mono text-sm text-white">
      <div class="flex items-center justify-between gap-3">
        <div>
          {props.fps} fps ({props.computeTimeMs.toFixed(2)}ms)
        </div>
        <div class="text-gray-400">{props.pointerLocked ? "(locked)" : null}</div>
      </div>
      <div class="my-2">
        <svg
          viewBox={`0 0 ${FRAME_GRAPH_WIDTH} ${FRAME_GRAPH_HEIGHT}`}
          class="h-20 w-full rounded border border-white/20 bg-black/40"
          preserveAspectRatio="none"
          aria-label="Frame pacing graph"
          role="img"
        >
          <title>Per-frame compute time graph</title>
          {frameGuides.map((guide) => (
            <>
              <line
                x1="0"
                x2={FRAME_GRAPH_WIDTH.toString()}
                y1={frameGuideY(guide.ms)}
                y2={frameGuideY(guide.ms)}
                stroke={guide.stroke}
                stroke-dasharray="4 3"
                stroke-width="1"
              />
              <rect
                x={(FRAME_GRAPH_WIDTH - 76).toString()}
                y={(Number(frameGuideY(guide.ms)) - 7).toString()}
                width="76"
                height="12"
                fill="rgb(0 0 0 / 0.55)"
                rx="2"
              />
              <text
                x={(FRAME_GRAPH_WIDTH - 72).toString()}
                y={(Number(frameGuideY(guide.ms)) + 2.5).toString()}
                fill={guide.stroke}
                font-size="8"
              >
                {guide.label}
              </text>
            </>
          ))}
          <polyline
            fill="none"
            points={framePolyline(props.computeTimeHistory)}
            stroke="rgb(96 165 250)"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
