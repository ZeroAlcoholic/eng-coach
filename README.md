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
- **Phone-safe sessions**: the screen stays awake while practicing, and the live
  transcript is saved as you speak — if the tab is killed, Home offers
  「恢復上次未儲存的練習」.
- **Your data is browsable**: tap the stat chips on Home for past recaps
  (練習紀錄), the vocab library (詞庫), and FSRS spaced review (複習 N) — due
  items are also recycled into your next live session.
- **Honest numbers only**: a saved session means the write committed; a recap
  exists only when the judge produced a valid sample (otherwise 練習紀錄 shows
  「評量未完成」with a retry); the three Home readouts (無提示做到 / 教過的用出來 /
  錯誤復發) are computed locally and each opens the sessions it came from.
- **Import is all-or-nothing**: a backup is validated in full, you are told how
  many records it adds / overwrites, and it is written in one transaction.
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

Verifying a deploy: the `pages.yml` run must show both `build` and `deploy`
green; the live `coach.html` must reference the same hashed asset names as the
local `dist/` for that commit.

Models are set in `src/kernel/overrides.ts` (live: `gemini-3.8-live`; text:
`gemini-3.5-flash`; judge samples: 3) and can be overridden from ⚙️ on the
device without a redeploy.
