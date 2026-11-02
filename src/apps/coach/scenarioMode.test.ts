import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Scenario } from "../../kernel/types";
import { isDiscussion, withDiscussion } from "./scenarioMode";
import { ScenariosSheet, type ScenariosSheetProps } from "./ScenariosSheet";

const base: Scenario = {
  id: "s1",
  title: "茶敘",
  targetLanguage: "en",
  level: "B1",
  baseContext: "frame",
  contentContext: "ctx",
  coachRole: "Yuko Tanaka，同業",
  userRole: "與會者",
  objectives: ["聊一聊"],
  targetPhrases: [],
};

describe("discussion mode toggle", () => {
  it("on sets the mode; off removes the field entirely", () => {
    const on = withDiscussion(base, true);
    expect(isDiscussion(on)).toBe(true);
    const off = withDiscussion(on, false);
    expect(isDiscussion(off)).toBe(false);
    expect(off).not.toHaveProperty("mode");
    expect(off).toEqual(base);
    expect(base).not.toHaveProperty("mode"); // the input is never mutated
  });
});

const noop = () => {};
function sheet(mine: Scenario[], editing: Scenario | null): string {
  const props: ScenariosSheetProps = {
    lang: "en",
    langLabel: "英語",
    onClose: noop,
    busy: "",
    otherArcs: [],
    advancing: null,
    onPlayArc: noop,
    mine,
    editing,
    onEditChange: noop,
    onSaveEdit: noop,
    onPractice: noop,
    onExport: noop,
    onDelete: noop,
    samples: [],
    demoArcs: [],
    showSamples: false,
    onShowSamples: noop,
    onStartDemo: noop,
    level: "B1",
    onLevel: noop,
    brief: "",
    onBrief: noop,
    serial: false,
    onSerial: noop,
    building: false,
    onBuild: noop,
    onCopyPrompt: noop,
    onImportBrief: noop,
    onSurpriseSerial: noop,
  };
  return renderToStaticMarkup(createElement(ScenariosSheet, props));
}

describe("the editor and the card show the mode", () => {
  const discussion = withDiscussion(base, true);
  const checkedBox = /<input type="checkbox" checked=""\/><span class="muted">討論模式/;

  it("the editor's box is ticked for a discussion and clear for a meeting", () => {
    expect(sheet([discussion], discussion)).toMatch(checkedBox);
    const meeting = sheet([base], base);
    expect(meeting).toContain("討論模式");
    expect(meeting).not.toMatch(checkedBox);
  });

  it("a Japanese scenario offers no toggle (the mode changes only the English coach)", () => {
    const ja = { ...base, targetLanguage: "ja" as const, level: "A2" as const };
    expect(sheet([ja], ja)).not.toContain("討論模式");
  });

  it("the card carries a 討論 pill only in discussion mode", () => {
    expect(sheet([discussion], null)).toContain('<span class="pill pill--neutral">討論</span>');
    expect(sheet([base], null)).not.toContain('<span class="pill pill--neutral">討論</span>');
  });
});
