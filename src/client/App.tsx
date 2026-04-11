import { onMount } from "solid-js";
import { MinecraftAnimation } from "../minceraft/App.js";

export default function App() {
  let glCanvasRef!: HTMLCanvasElement;
  let textCanvasRef!: HTMLCanvasElement;

  onMount(() => {
    const animation = new MinecraftAnimation(glCanvasRef, textCanvasRef);
    animation.start();
  });

  return (
    <div class="container">
      <canvas ref={glCanvasRef} id="glCanvas" class="card" width={1280} height={960} />
      <canvas ref={textCanvasRef} id="textCanvas" width={1280} height={960} />
    </div>
  );
}
