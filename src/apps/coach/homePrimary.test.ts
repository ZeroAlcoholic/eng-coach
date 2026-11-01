import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIOS } from "./defaults";
import { primaryAction } from "./homePrimary";
import { ScenariosSheet, type ScenariosSheetProps } from "./ScenariosSheet";

describe("primaryAction — Home's one main button (U1)", () => {
  it("no key → the key card, whatever else exists", () => {
    expect(primaryAction({ hasKey: false, hasArc: true, hasLastPracticed: true })).toBe("key");
    expect(primaryAction({ hasKey: false, hasArc: false, hasLastPracticed: false })).toBe("key");
  });
  it("an unfinished story line → next episode, ahead of a replay", () => {
    expect(primaryAction({ hasKey: true, hasArc: true, hasLastPracticed: true })).toBe("arc");
  });
  it("no story line, something practised → 再練一次", () => {
    expect(primaryAction({ hasKey: true, hasArc: false, hasLastPracticed: true })).toBe("replay");
  });
  it("nothing yet → 換個新劇情", () => {
    expect(primaryAction({ hasKey: true, hasArc: false, hasLastPracticed: false })).toBe("new");
  });
});

const noop = () => {};
const base: ScenariosSheetProps = {
  lang: "en",
  langLabel: "英文",
  onClose: noop,
  busy: "",
  otherArcs: [],
  advancing: null,
  onPlayArc: noop,
  mine: [{ ...DEFAULT_SCENARIOS.en[0], id: "mine-1", title: "我的會議" }],
  editing: null,
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
const render = (p: Partial<ScenariosSheetProps>) => renderToStaticMarkup(createElement(ScenariosSheet, { ...base, ...p }));

describe("ScenariosSheet (U1)", () => {
  it("a half-typed brief survives close and reopen: Home owns it, every open shows it", () => {
    const draft = "和新加坡團隊的季度檢討，我要說明延遲";
    expect(render({ brief: draft })).toContain(draft); // first open
    expect(render({ brief: draft, serial: true })).toContain(draft); // reopened later, same Home state
    const sheetSrc = readFileSync(new URL("./ScenariosSheet.tsx", import.meta.url), "utf8");
    const homeSrc = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
    expect(sheetSrc).not.toMatch(/useState[^\n]*(brief|serial)/i);
    expect(homeSrc).toMatch(/const \[brief, setBrief\] = useState/);
    expect(homeSrc).toMatch(/const \[serial, setSerial\] = useState/);
    // Closing the sheet changes only which sheet is open — never the draft.
    const mount = homeSrc.slice(homeSrc.indexOf("<ScenariosSheet"), homeSrc.indexOf("/>", homeSrc.indexOf("<ScenariosSheet")));
    expect(mount).toContain("onClose={() => setSheet(null)}");
    expect(homeSrc).not.toMatch(/setBrief\(""\)/);
  });

  it("a scenario card shows one main tap; 編輯／匯出／刪除 wait behind ⋯", () => {
    const out = render({});
    expect(out).toContain("我的會議");
    expect(out).toContain("▶ 開始練習");
    expect(out).toContain("⋯");
    for (const hidden of ["編輯", "匯出", "刪除"]) expect(out).not.toContain(`>${hidden}<`);
  });

  it("the status line is shown inside the sheet (the page behind is covered)", () => {
    expect(render({ busy: "建立失敗：配額已滿" })).toContain("建立失敗：配額已滿");
  });
});
