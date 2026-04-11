/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App.tsx";
import { createGameApi, GameApiProvider } from "./api.js";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const api = createGameApi();

render(
  () => (
    <GameApiProvider value={api}>
      <App />
    </GameApiProvider>
  ),
  root,
);
