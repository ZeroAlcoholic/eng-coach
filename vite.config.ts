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
      // apple-touch-icon isn't referenced by the manifest (iOS reads the <link>),
      // so it isn't auto-precached — list it explicitly so the offline install
      // has its home-screen icon. The worklet + manifest icons are already
      // covered (js glob / manifest-icon integration).
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Learning Coach",
        short_name: "Coach",
        description: "Pure-browser voice coach — English meetings & 日本語 travel, no server.",
        theme_color: "#0a1410",
        background_color: "#0a1410",
        display: "standalone",
        orientation: "portrait",
        // The installed app opens the coach directly — the launcher is one tool
        // deep with two "coming soon" tiles, an extra tap on EVERY launch. The
        // launcher stays reachable via the ⚙️「← 工具」link for future tools.
        start_url: "coach.html",
        // Raster PNGs are mandatory for real installs: iOS/Safari ignore SVG
        // icons entirely (no home-screen icon / splash). The SVG stays first as
        // the crisp option for engines that honour it. Maskable is a full-bleed
        // square so the platform's own mask shapes it without clipping content.
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Google Fonts are loaded via @import in app.css. Precache the local
        // shell (the default glob covers js/css/html/png/svg incl. the audio
        // worklet + the new icons); cache the remote fonts at runtime so the
        // in-car offline shell keeps its typography after the first online load.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
}));
