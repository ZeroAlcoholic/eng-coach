import { describe, expect, it } from "vitest";

import type { ObjectiveMastery } from "../../kernel/types";
import { canonicalizeVerdicts, isStillDeveloping } from "./objectives";

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

describe("canonicalizeVerdicts — judge-string drift can't fork the ledger key", () => {
  const canonical = ["Order a coffee politely", "Ask for the bill"];

  it("maps a drifted judge string back to the scenario's canonical objective", () => {
    // trailing period + different case + extra spaces all collapse to the canon
    const v = canonicalizeVerdicts([{ objective: "order a coffee  politely.", met: true }], canonical);
    expect(v.get("Order a coffee politely")).toBe(true);
    expect(v.size).toBe(1);
  });

  it("dedupes the same objective listed twice in one session (last verdict wins)", () => {
    const v = canonicalizeVerdicts(
      [
        { objective: "Ask for the bill", met: false },
        { objective: "ask for the bill", met: true },
      ],
      canonical,
    );
    expect(v.size).toBe(1);
    expect(v.get("Ask for the bill")).toBe(true);
  });

  it("keeps an unmatched objective's own text (no canonical to map to)", () => {
    const v = canonicalizeVerdicts([{ objective: "Improvised side-quest", met: false }], canonical);
    expect(v.get("Improvised side-quest")).toBe(false);
  });

  it("tolerates a missing objectivesMet list", () => {
    expect(canonicalizeVerdicts(undefined, canonical).size).toBe(0);
  });
});
