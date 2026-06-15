import { describe, expect, it } from "vitest";

import type { ObjectiveMastery } from "../../kernel/types";
import { isStillDeveloping } from "./objectives";

function rec(p: Partial<ObjectiveMastery>): ObjectiveMastery {
  return { id: "s::o", scenarioId: "s", objective: "o", attempts: 0, met: 0, updatedAt: "", ...p };
}

describe("isStillDeveloping — which objectives the coach should prioritise", () => {
  it("never flags an objective the judge has not yet assessed (avoids noise)", () => {
    expect(isStillDeveloping(rec({ attempts: 0 }))).toBe(false);
  });

  it("flags it when the most recent verdict was 'not met'", () => {
    expect(isStillDeveloping(rec({ attempts: 3, met: 2, lastMet: false }))).toBe(true);
  });

  it("flags it when met less than half the time even if the last was a pass", () => {
    expect(isStillDeveloping(rec({ attempts: 4, met: 1, lastMet: true }))).toBe(true);
  });

  it("clears it once it's mostly met and the last verdict was a pass", () => {
    expect(isStillDeveloping(rec({ attempts: 4, met: 3, lastMet: true }))).toBe(false);
  });
});
