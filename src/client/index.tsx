/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import Router from "./router";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

render(() => <Router />, root);
