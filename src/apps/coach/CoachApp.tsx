// Coach app shell: loads shared kernel state (key, profile, scenarios) and
// switches between Home and a live Practice session. No router — two views.

import { useEffect, useState } from "react";

import { getApiKey, setApiKey } from "../../kernel/apikey";
import {
  countSessions,
  getDraft,
  getProfile,
  listArcs,
  listItems,
  listScenarios,
  putProfile,
  scanSessionsDesc,
} from "../../kernel/db";
import {
  DEFAULT_PROFILE,
  type Arc,
  type DraftSession,
  type LearnedItem,
  type LearnerProfile,
  type Scenario,
  type SessionRecord,
  type TargetLanguage,
} from "../../kernel/types";
import { ensurePersisted, type PersistState } from "../../kernel/storage";
import { Home } from "./Home";
import { Practice } from "./Practice";

const RECENT_SESSIONS = 40;

export function CoachApp() {
  const [apiKey, setKey] = useState(getApiKey());
  const [profile, setProfile] = useState<LearnerProfile>(DEFAULT_PROFILE);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]); // S1/S2 — story lines
  const [items, setItems] = useState<LearnedItem[]>([]); // W6 counts + W7 review
  const [sessionCount, setSessionCount] = useState(0);
  const [draft, setDraft] = useState<DraftSession | null>(null); // crash recovery
  const [lastByLang, setLastByLang] = useState<Partial<Record<TargetLanguage, Scenario>>>({});
  const [recentSessions, setRecentSessions] = useState<SessionRecord[]>([]); // for Home's readouts
  const [practicing, setPracticing] = useState<Scenario | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [persist, setPersist] = useState<PersistState>("unsupported");

  async function reload() {
    try {
      const [p, s, it, count, d, a] = await Promise.all([
        getProfile(),
        listScenarios(),
        listItems(),
        countSessions(), // count() — never deserializes transcripts
        getDraft(),
        listArcs(),
      ]);
      setProfile(p);
      setScenarios(s);
      setArcs(a);
      setItems(it);
      setSessionCount(count);
      setDraft(d && d.transcript.length ? d : null); // empty drafts aren't worth recovering
      // Most recently practiced scenario per language → Home's「▶ 繼續上次」.
      // Newest-first index scan, stopping as soon as both languages are found —
      // normally touches only the first record or two, never the whole store.
      const byId = new Map(s.map((sc) => [sc.id, sc]));
      const last: Partial<Record<TargetLanguage, Scenario>> = {};
      const recent: SessionRecord[] = [];
      let walked = 0;
      await scanSessionsDesc((sess) => {
        walked += 1;
        // The readouts look at the newest few dozen sessions across languages —
        // bounded, and the same single index scan as「繼續上次」.
        if (recent.length < RECENT_SESSIONS) recent.push(sess);
        const sc = byId.get(sess.scenarioId);
        // S2 — an arc episode is never「繼續上次」: the arc's single「▶ 下一集」
        // button owns that slot, and re-entering a finished episode would replay
        // the story instead of advancing it.
        if (sc && !sc.arc && !last[sc.targetLanguage]) last[sc.targetLanguage] = sc;
        // Stop once both languages are filled — or after 100 records, so a
        // never-practiced language can't turn this into a full-store walk.
        return walked < 100 && !(last.en && last.ja && recent.length >= RECENT_SESSIONS);
      });
      setLastByLang(last);
      setRecentSessions(recent);
      setLoadFailed(false);
    } catch (e) {
      // IndexedDB unavailable (e.g. storage blocked) — keep defaults, don't
      // crash, but SAY so: every empty state below would otherwise read as
      // data loss (console.warn is invisible on a phone PWA).
      console.warn("kernel reload failed", e);
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    // Initial async load from IndexedDB. setState runs after the await (a later
    // microtask), so this is not the synchronous cascading-render the rule guards.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    // A1 — ask the browser to exempt our IndexedDB from automatic eviction
    // (best-effort; the resulting state is shown in ⚙️). Independent of reload.
    void ensurePersisted().then(setPersist);
  }, []);

  function onApiKey(key: string) {
    setApiKey(key);
    setKey(key);
  }

  function onProfile(p: LearnerProfile) {
    setProfile(p);
    putProfile(p).catch((e) => console.warn("save profile failed", e));
  }

  if (practicing) {
    return (
      <Practice
        apiKey={apiKey}
        scenario={practicing}
        profile={profile}
        onExit={() => {
          setPracticing(null);
          void reload();
        }}
      />
    );
  }

  return (
    <Home
      apiKey={apiKey}
      profile={profile}
      scenarios={scenarios}
      arcs={arcs}
      items={items}
      sessionCount={sessionCount}
      draft={draft}
      recentSessions={recentSessions}
      lastPracticed={lastByLang[profile.language] ?? null}
      loadFailed={loadFailed}
      persist={persist}
      onApiKey={onApiKey}
      onProfile={onProfile}
      onPractice={setPracticing}
      onChanged={() => void reload()}
    />
  );
}
