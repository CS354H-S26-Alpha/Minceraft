import { createSignal, onCleanup, onMount } from "solid-js";
import { createRoom } from "./create-room";
import { createGame } from "./engine";

const backgroundAudioUrl = new URL("../../assets/audio/background.m4a", import.meta.url).href;

export default function App() {
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [textCanvas, setTextCanvas] = createSignal<HTMLCanvasElement>();

  const { player, input } = createRoom("world-1", crypto.randomUUID());

  createGame({
    glCanvas,
    inputCanvas: textCanvas,
    player,
    sendInput: input,
  });

  onMount(() => {
    const backgroundAudio = new Audio(backgroundAudioUrl);
    backgroundAudio.loop = true;
    backgroundAudio.preload = "auto";

    let started = false;

    const startBackgroundAudio = () => {
      if (started) {
        return;
      }

      void backgroundAudio.play().then(() => {
        started = true;
        window.removeEventListener("pointerdown", startBackgroundAudio);
        window.removeEventListener("keydown", startBackgroundAudio);
      }).catch(() => {
        // Browsers can block autoplay until the user interacts with the page.
      });
    };

    startBackgroundAudio();
    window.addEventListener("pointerdown", startBackgroundAudio);
    window.addEventListener("keydown", startBackgroundAudio);

    onCleanup(() => {
      window.removeEventListener("pointerdown", startBackgroundAudio);
      window.removeEventListener("keydown", startBackgroundAudio);
      backgroundAudio.pause();
      backgroundAudio.currentTime = 0;
    });
  });

  return (
    <div class="container">
      <canvas ref={setGlCanvas} id="glCanvas" class="card" width={1280} height={960} />
      <canvas ref={setTextCanvas} id="textCanvas" width={1280} height={960} />
    </div>
  );
}
