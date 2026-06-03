# Learning Coach

A **pure-browser, no-server** voice coach — English (meetings) & 日本語 (travel)
spoken practice. The browser talks directly to the Gemini Live API; there is no
backend.

- **No secrets in this repo.** Your Gemini API key is entered on the device and
  stored only in the browser's `localStorage` — it is never committed or sent
  anywhere except Google's Gemini API. Set a budget cap on your Google Cloud
  project.
- **Data is local-first** (IndexedDB). Export/import a portable Learning Pack
  (JSON) to move between devices; export learned vocab as CSV for Anki.
- **Folder of tools** sharing one kernel: the Speaking Coach is live; flashcards
  and grammar can plug into the same data later.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173  (launcher), /coach.html
npm run build    # static site → dist/
```

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/pages.yml`. The site is served at a project subpath, so the
Vite build uses a relative base in production.

On your phone: open the Pages URL → paste your Gemini key once → **Add to Home
screen**. Mic capture needs HTTPS, which GitHub Pages provides.
