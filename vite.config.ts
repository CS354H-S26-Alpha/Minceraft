import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import solid from "vite-plugin-solid";

// Plugins shared with vitest.config.ts. Excludes `cloudflare()` (incompatible
// with `@cloudflare/vitest-pool-workers`) and `solid()` (pulls in jsdom).
export const sharedPlugins = [glsl()];

export const sharedAliases = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  plugins: [...sharedPlugins, tailwindcss(), solid(), cloudflare()],
  resolve: {
    alias: sharedAliases,
  },
});
