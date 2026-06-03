// The folder's front page: a launcher listing the static tools that share the
// kernel. Today only the coach is live; flashcards / grammar are placeholders
// that will plug into the SAME IndexedDB with zero refactor.

import { useEffect, useState } from "react";

import { listItems, listScenarios, listSessions } from "../../kernel/db";

interface Counts {
  scenarios: number;
  items: number;
  sessions: number;
}

export function Launcher() {
  const [counts, setCounts] = useState<Counts>({ scenarios: 0, items: 0, sessions: 0 });

  useEffect(() => {
    void Promise.all([listScenarios(), listItems(), listSessions()]).then(([sc, it, se]) =>
      setCounts({ scenarios: sc.length, items: it.length, sessions: se.length }),
    );
  }, []);

  return (
    <main className="app">
      <h1>
        <span style={{ color: "var(--primary)" }}>🌲</span> Learning tools
      </h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>
        Pure-browser, no server. Every tool shares your data on this device.
      </p>

      <a href="coach.html" className="tile">
        <div className="tile-title">🎙️ Speaking Coach</div>
        <div className="muted" style={{ marginTop: 4 }}>
          English / 日本語 spoken practice — {counts.scenarios} scenarios, {counts.sessions} sessions.
        </div>
      </a>

      <div className="tile tile--soon">
        <div className="tile-title">🃏 Flashcards</div>
        <div className="muted" style={{ marginTop: 4 }}>
          Coming soon — SRS drill over your {counts.items} learned items.
        </div>
      </div>

      <div className="tile tile--soon">
        <div className="tile-title">📐 Grammar</div>
        <div className="muted" style={{ marginTop: 4 }}>
          Coming soon.
        </div>
      </div>
    </main>
  );
}
