// Coach app shell: loads shared kernel state (key, profile, scenarios) and
// switches between Home and a live Practice session. No router — two views.

import { useEffect, useState } from "react";

import { getApiKey, setApiKey } from "../../kernel/apikey";
import { getProfile, listItems, listScenarios, listSessions, putProfile } from "../../kernel/db";
import { DEFAULT_PROFILE, type LearnerProfile, type Scenario } from "../../kernel/types";
import { Home } from "./Home";
import { Practice } from "./Practice";

export function CoachApp() {
  const [apiKey, setKey] = useState(getApiKey());
  const [profile, setProfile] = useState<LearnerProfile>(DEFAULT_PROFILE);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [stats, setStats] = useState({ items: 0, sessions: 0 }); // W6 glanceable counts
  const [practicing, setPracticing] = useState<Scenario | null>(null);

  async function reload() {
    try {
      const [p, s, items, sessions] = await Promise.all([
        getProfile(),
        listScenarios(),
        listItems(),
        listSessions(),
      ]);
      setProfile(p);
      setScenarios(s);
      setStats({ items: items.length, sessions: sessions.length });
    } catch (e) {
      // IndexedDB unavailable (e.g. storage blocked) — keep defaults, don't crash.
      console.warn("kernel reload failed", e);
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
      stats={stats}
      onApiKey={onApiKey}
      onProfile={onProfile}
      onPractice={setPracticing}
      onChanged={() => void reload()}
    />
  );
}
