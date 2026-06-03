import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Multi-page: one static build, several pure-browser tools sharing one origin
// (so they share IndexedDB). Launcher at /, coach at /coach.html, spike kept.
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
        spike: page("spike.html"),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
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
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
}));
