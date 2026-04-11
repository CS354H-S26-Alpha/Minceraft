/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App.tsx";
import "./index.css";
import { SessionProvider } from "./session.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

render(
  () => (
    <SessionProvider name="Player">
      <App />
    </SessionProvider>
  ),
  root,
);
