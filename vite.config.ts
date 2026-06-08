import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Multi-page: one static build, several pure-browser tools sharing one origin
// (so they share IndexedDB). Launcher at /, coach at /coach.html. spike.html is
// a local-only proof-of-concept and is deliberately NOT a build input, so the
// debug page is never published to the public Pages site.
const page = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

// Relative base in production so the build works under a GitHub Pages project
// subpath (https://user.github.io/<repo>/) without knowing the repo name. Dev
// stays at "/". The capture worklet is loaded via import.meta.env.BASE_URL to
// match (see AudioEngine).
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "./" : "/",
  build: {
    rollupOptions: {
      input: {
        main: page("index.html"),
        coach: page("coach.html"),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Learning Coach",
        short_name: "Coach",
        description: "Pure-browser voice coach — English meetings & 日本語 travel, no server.",
        theme_color: "#0a1410",
        background_color: "#0a1410",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
}));
