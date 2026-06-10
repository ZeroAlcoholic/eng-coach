// Coach app shell: loads shared kernel state (key, profile, scenarios) and
// switches between Home and a live Practice session. No router — two views.

import { useEffect, useState } from "react";

import { getApiKey, setApiKey } from "../../kernel/apikey";
import {
  countSessions,
  getDraft,
  getProfile,
  listItems,
  listScenarios,
  putProfile,
  scanSessionsDesc,
} from "../../kernel/db";
import {
  DEFAULT_PROFILE,
  type DraftSession,
  type LearnedItem,
  type LearnerProfile,
  type Scenario,
  type TargetLanguage,
} from "../../kernel/types";
import { Home } from "./Home";
import { Practice } from "./Practice";

export function CoachApp() {
  const [apiKey, setKey] = useState(getApiKey());
  const [profile, setProfile] = useState<LearnerProfile>(DEFAULT_PROFILE);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [items, setItems] = useState<LearnedItem[]>([]); // W6 counts + W7 review
  const [sessionCount, setSessionCount] = useState(0);
  const [draft, setDraft] = useState<DraftSession | null>(null); // crash recovery
  const [lastByLang, setLastByLang] = useState<Partial<Record<TargetLanguage, Scenario>>>({});
  const [practicing, setPracticing] = useState<Scenario | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  async function reload() {
    try {
      const [p, s, it, count, d] = await Promise.all([
        getProfile(),
        listScenarios(),
        listItems(),
        countSessions(), // count() — never deserializes transcripts
        getDraft(),
      ]);
      setProfile(p);
      setScenarios(s);
      setItems(it);
      setSessionCount(count);
      setDraft(d && d.transcript.length ? d : null); // empty drafts aren't worth recovering
      // Most recently practiced scenario per language → Home's「▶ 繼續上次」.
      // Newest-first index scan, stopping as soon as both languages are found —
      // normally touches only the first record or two, never the whole store.
      const byId = new Map(s.map((sc) => [sc.id, sc]));
      const last: Partial<Record<TargetLanguage, Scenario>> = {};
      let walked = 0;
      await scanSessionsDesc((sess) => {
        walked += 1;
        const sc = byId.get(sess.scenarioId);
        if (sc && !last[sc.targetLanguage]) last[sc.targetLanguage] = sc;
        // Stop once both languages are filled — or after 100 records, so a
        // never-practiced language can't turn this into a full-store walk.
        return walked < 100 && !(last.en && last.ja);
      });
      setLastByLang(last);
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
      items={items}
      sessionCount={sessionCount}
      draft={draft}
      lastPracticed={lastByLang[profile.language] ?? null}
      loadFailed={loadFailed}
      onApiKey={onApiKey}
      onProfile={onProfile}
      onPractice={setPracticing}
      onChanged={() => void reload()}
    />
  );
}
