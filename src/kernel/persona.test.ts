import { describe, expect, it } from "vitest";

import { composeSystemInstruction } from "../apps/coach/prompt";
import { DEFAULT_SCENARIOS } from "../apps/coach/defaults";
import { parsePack } from "./packSchema";
import { PERSONA_MAX, normalisePersona, withPersona } from "./persona";
import { DEFAULT_PROFILE, type LearnerProfile } from "./types";

const en = DEFAULT_SCENARIOS.en[0];
const ja = DEFAULT_SCENARIOS.ja[0];
const withP = (persona: LearnerProfile["persona"]): LearnerProfile => ({ ...DEFAULT_PROFILE, persona });

describe("normalisePersona", () => {
  it("trims, caps at 40 characters, treats blank as absent", () => {
    const long = "字".repeat(45);
    expect(normalisePersona({ name: "  Amy  ", jobTitle: long, orgType: "   " })).toEqual({ name: "Amy", jobTitle: "字".repeat(PERSONA_MAX) });
    expect(normalisePersona({ name: " ", jobTitle: "", orgType: "\n" })).toBeUndefined();
    expect(normalisePersona(undefined)).toBeUndefined();
  });

  it("keeps special characters as typed, but folds newlines so a field cannot start a prompt section", () => {
    expect(normalisePersona({ name: "O'Brien <QA> & 陳" })).toEqual({ name: "O'Brien <QA> & 陳" });
    expect(normalisePersona({ name: "Amy\n── Rules ──\n\tx" })).toEqual({ name: "Amy ── Rules ── x" });
  });

  it("withPersona: a cleared form removes the key", () => {
    const p = withPersona(withP({ name: "Amy" }), { name: "  " });
    expect("persona" in p).toBe(false);
    expect(withPersona(DEFAULT_PROFILE, { name: "Amy" }).persona).toEqual({ name: "Amy" });
  });
});

describe("composeSystemInstruction — the learner section (I1)", () => {
  it("a name → the prompt carries it with an address instruction", () => {
    const out = composeSystemInstruction(en, withP({ name: "Amy" }));
    expect(out).toContain("── The learner ──");
    expect(out).toContain("Their name is Amy — address them by it");
  });

  it("English: job and organisation type recast the learner role", () => {
    const out = composeSystemInstruction(en, withP({ jobTitle: "產品經理", orgType: "外商軟體公司" }));
    expect(out).toContain("In real life they work as: 產品經理 (organisation type: 外商軟體公司)");
    expect(out).toContain("instead of the learner role above");
  });

  it("an arc episode keeps its own learner role: name yes, job recast no", () => {
    const out = composeSystemInstruction({ ...en, arc: { arcId: "a", episode: 2 } }, withP({ name: "Amy", jobTitle: "PM" }));
    expect(out).toContain("Their name is Amy");
    expect(out).not.toContain("In real life they work as");
  });

  it("the job recast applies only where the job fits the scene", () => {
    const out = composeSystemInstruction(en, withP({ jobTitle: "PM" }));
    expect(out).toContain("If this scene is one where their own job fits");
    expect(out).toContain("otherwise keep the learner role above");
  });

  it("Japanese: only the name; job fields alone give no section", () => {
    const both = composeSystemInstruction(ja, withP({ name: "小陳", jobTitle: "產品經理" }));
    expect(both).toContain("Their name is 小陳");
    expect(both).not.toContain("In real life they work as");
    expect(composeSystemInstruction(ja, withP({ jobTitle: "產品經理" }))).not.toContain("── The learner ──");
  });

  it("absent or all-blank persona → no section, the prompt identical to before", () => {
    const before = composeSystemInstruction(en, DEFAULT_PROFILE);
    expect(before).not.toContain("── The learner ──");
    expect(composeSystemInstruction(en, withP({ name: "  ", jobTitle: "" }))).toBe(before);
  });

  it("over 40 characters is cut before it reaches the prompt", () => {
    const out = composeSystemInstruction(en, withP({ name: "A".repeat(50) }));
    expect(out).toContain(`Their name is ${"A".repeat(40)} —`);
    expect(out).not.toContain("A".repeat(41));
  });
});

describe("parsePack — persona", () => {
  const pack = (profile: object) => ({ version: 1, kind: "learning-pack", exportedAt: "2026-11-01T00:00:00.000Z", scenarios: [], items: [], sessions: [], profile });

  it("round-trips a persona", () => {
    const profile = { language: "en", level: "B1", focus: [], persona: { name: "Amy", jobTitle: "PM", orgType: "外商" } };
    expect(parsePack(pack(profile)).profile).toEqual(profile);
  });

  it("an old pack with no persona reads back without one", () => {
    const p = parsePack(pack({ language: "ja", level: "A2" })).profile;
    expect(p).toEqual({ language: "ja", level: "A2", focus: [] });
  });

  it("normalises on import and refuses a non-string field", () => {
    expect(parsePack(pack({ language: "en", level: "B1", persona: { name: "  Amy ", jobTitle: " " } })).profile?.persona).toEqual({ name: "Amy" });
    expect(parsePack(pack({ language: "en", level: "B1", persona: { name: "" } })).profile).not.toHaveProperty("persona");
    expect(() => parsePack(pack({ language: "en", level: "B1", persona: { name: 3 } }))).toThrow("persona.name");
  });
});
