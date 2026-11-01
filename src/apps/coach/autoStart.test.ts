import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { appleTouchDevice, runAutoStart, shouldAutoStart, stillIdle } from "./autoStart";

const perms = (state: PermissionState) => ({ query: vi.fn(async () => ({ state })) });

describe("shouldAutoStart (U2)", () => {
  it("granted and asked for → start", async () => {
    const p = perms("granted");
    expect(await shouldAutoStart(p, true)).toBe(true);
    expect(p.query).toHaveBeenCalledWith({ name: "microphone" });
  });

  it("prompt or denied → keep the button", async () => {
    expect(await shouldAutoStart(perms("prompt"), true)).toBe(false);
    expect(await shouldAutoStart(perms("denied"), true)).toBe(false);
  });

  it("a query that throws (e.g. unknown permission name) → keep the button", async () => {
    const p = { query: vi.fn(async () => Promise.reject(new TypeError("microphone is not a valid PermissionName"))) };
    expect(await shouldAutoStart(p, true)).toBe(false);
  });

  it("no Permissions API → keep the button, exactly as before (no query at all)", async () => {
    expect(await shouldAutoStart(undefined, true)).toBe(false);
  });

  it("autoStart false → never even asks", async () => {
    const p = perms("granted");
    expect(await shouldAutoStart(p, false)).toBe(false);
    expect(p.query).not.toHaveBeenCalled();
  });
});

describe("runAutoStart — the mount effect (U2)", () => {
  it("granted → start exactly once", async () => {
    const start = vi.fn();
    await runAutoStart(perms("granted"), true, () => true, start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("prompt / denied / throwing query / no API / autoStart false → zero starts", async () => {
    const start = vi.fn();
    const throwing = { query: vi.fn(async () => Promise.reject(new Error("x"))) };
    for (const [p, auto] of [
      [perms("prompt"), true],
      [perms("denied"), true],
      [throwing, true],
      [undefined, true],
      [perms("granted"), false],
    ] as const) {
      await runAutoStart(p, auto, () => true, start);
    }
    expect(start).not.toHaveBeenCalled();
  });

  it("the learner tapped 開始 while the query was pending → not started twice", async () => {
    const start = vi.fn();
    await runAutoStart(perms("granted"), true, () => false, start);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("Practice keeps its 開始 button (U2)", () => {
  it("the first render always has it; auto-start only ever acts later, from the mount effect", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Practice } = await import("./Practice");
    const { DEFAULT_SCENARIOS } = await import("./defaults");
    const { DEFAULT_PROFILE } = await import("../../kernel/types");
    for (const autoStart of [true, false, undefined]) {
      const html = renderToStaticMarkup(
        createElement(Practice, { apiKey: "k", scenario: DEFAULT_SCENARIOS.en[0], profile: DEFAULT_PROFILE, onExit: () => {}, autoStart }),
      );
      expect(html).toContain("開始");
      expect(html).toContain("mic-btn");
    }
  });
});

describe("the guards around auto-start (U2)", () => {
  it("stillIdle: only a current effect run, with no start in flight and a session still idle", () => {
    expect(stillIdle({ alive: true, starting: false, phase: "idle" })).toBe(true);
    expect(stillIdle({ alive: false, starting: false, phase: "idle" })).toBe(false); // StrictMode's discarded run / unmounted
    expect(stillIdle({ alive: true, starting: true, phase: "idle" })).toBe(false); // the learner tapped 開始 meanwhile
    expect(stillIdle({ alive: true, starting: false, phase: "connecting" })).toBe(false);
  });

  it("Apple touch devices keep the button; Android and desktop Chrome do not", () => {
    expect(appleTouchDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(true);
    expect(appleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(appleTouchDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", platform: "Linux armv81", maxTouchPoints: 5 })).toBe(false);
    expect(appleTouchDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 })).toBe(false);
    expect(appleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("Practice wires both guards into the mount effect", () => {
    const src = readFileSync(new URL("./Practice.tsx", import.meta.url), "utf8");
    expect(src).toContain("!!props.autoStart && !!nav && !appleTouchDevice(nav)");
    expect(src).toContain("stillIdle({ alive, starting: startingRef.current, phase: session().currentPhase().kind })");
  });
});
