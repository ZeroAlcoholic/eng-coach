import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A learner with history: every readout and stat chip renders.
vi.mock("./readouts", async (importOriginal) => {
  const part = { value: 0.5, n: 4, sourceSessionIds: ["s1"] };
  const readout = { ...part, trend: "up", betterWhen: "high" };
  return {
    ...(await importOriginal<object>()),
    computeReadouts: () => ({
      unaidedCanDo: readout,
      chunkUse: readout,
      focusResolution: { ...readout, drilled: part, undrilled: part },
    }),
  };
});
vi.mock("./srs", async (importOriginal) => ({ ...(await importOriginal<object>()), countDue: () => 7 }));

import type { Arc, DraftSession } from "../../kernel/types";
import { DEFAULT_PROFILE } from "../../kernel/types";
import { DEFAULT_SCENARIOS } from "./defaults";
import { Home } from "./Home";

const noop = () => {};
const lastPracticed = DEFAULT_SCENARIOS.en[0];
const arc: Arc = {
  id: "a1",
  title: "倫敦出差",
  targetLanguage: "en",
  level: "B1",
  premise: "p",
  episodes: [{ n: 1, scenarioId: "ep1", title: "第一集", canDoIds: [] }],
  plannedEpisodes: 6,
  storyState: { characters: [], events: [], openThreads: [] },
  canDos: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const draft = {
  id: "d1",
  scenarioId: lastPracticed.id,
  startedAt: "2026-11-02T00:00:00.000Z",
  transcript: [{ who: "user", text: "hi" }],
} as unknown as DraftSession;

function render(p: { apiKey?: string; arcs?: Arc[]; draft?: DraftSession | null; last?: boolean }) {
  return renderToStaticMarkup(
    createElement(Home, {
      apiKey: p.apiKey ?? "k",
      profile: { ...DEFAULT_PROFILE, language: "en" },
      scenarios: [lastPracticed],
      arcs: p.arcs ?? [],
      items: [],
      sessionCount: 12,
      recentSessions: [],
      draft: p.draft ?? null,
      lastPracticed: p.last === false ? null : lastPracticed,
      loadFailed: false,
      persist: "persisted" as never,
      onApiKey: noop,
      onProfile: noop,
      onPractice: noop,
      onChanged: noop,
    }),
  );
}

/** Splits the markup at the topbar's matching </div>. */
function splitTopbar(html: string): { topbar: string; rest: string } {
  const start = html.indexOf('<div class="topbar');
  expect(start).toBeGreaterThan(-1);
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) {
      const end = m.index + m[0].length;
      return { topbar: html.slice(start, end), rest: html.slice(0, start) + html.slice(end) };
    }
  }
  throw new Error("topbar is not closed");
}
const buttons = (html: string) => (html.match(/<button\b/g) ?? []).length;

describe("Home first screen — at most 3 buttons outside the topbar (U1)", () => {
  const states = {
    key: render({ apiKey: "", arcs: [arc], draft }),
    draft: render({ arcs: [arc], draft }),
    arc: render({ arcs: [arc] }),
    replay: render({}),
    new: render({ last: false }),
  };

  for (const [name, html] of Object.entries(states)) {
    it(`${name}: the readouts render, inside the topbar; the page below has ≤3 buttons`, () => {
      const { topbar, rest } = splitTopbar(html);
      for (const chip of ["練習 12 次", "詞庫 0", "複習 7", "無提示做到", "教過的用出來", "焦點沒再犯"]) {
        expect(topbar, chip).toContain(chip);
        expect(rest, chip).not.toContain(chip);
      }
      expect(buttons(rest)).toBeLessThanOrEqual(3);
    });
  }

  it("each state leads with its own main action", () => {
    expect(splitTopbar(states.key).rest).toContain("連結你的 Gemini API 金鑰");
    expect(splitTopbar(states.key).rest).not.toContain("上次練習未儲存"); // waits for the key, stored
    expect(splitTopbar(states.draft).rest).toContain("上次練習未儲存");
    expect(splitTopbar(states.draft).rest).not.toContain("🎲 換個新劇情");
    expect(splitTopbar(states.arc).rest).toContain("倫敦出差");
    expect(splitTopbar(states.replay).rest).toContain("再練一次");
    expect(splitTopbar(states.new).rest).toContain('<button class="btn btn--block btn--primary">🎲 換個新劇情');
  });

  it("negative control: readouts rendered below the topbar are caught by both checks", () => {
    const html = states.arc;
    const { topbar } = splitTopbar(html);
    const a = topbar.indexOf('<div class="statbar');
    const strip = topbar.slice(a, topbar.lastIndexOf("</div>"));
    const movedTopbar = topbar.slice(0, a) + topbar.slice(a + strip.length);
    const moved = html.replace(topbar, movedTopbar + strip); // same markup, strip just below the header
    const { topbar: t2, rest } = splitTopbar(moved);
    expect(t2).not.toContain("練習 12 次");
    expect(rest).toContain("練習 12 次");
    expect(buttons(rest)).toBeGreaterThan(3);
  });
});
