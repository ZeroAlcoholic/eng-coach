import { describe, expect, it, vi } from "vitest";

// The store is the boundary; buildPack and parsePack run for real.
vi.mock("./db", () => ({
  getProfile: async () => ({ language: "en", level: "B1", focus: [], persona: { name: "Amy", jobTitle: "PM", orgType: "外商" } }),
  listScenarios: async () => [],
  listItems: async () => [],
  listSessions: async () => [],
  listObjectives: async () => [],
  listArcs: async () => [],
}));

import { buildPack } from "./pack";
import { parsePack } from "./packSchema";

describe("export → import keeps the persona (I1)", () => {
  it("buildPack carries it and parsePack reads it back", async () => {
    const back = parsePack(JSON.parse(JSON.stringify(await buildPack())));
    expect(back.profile?.persona).toEqual({ name: "Amy", jobTitle: "PM", orgType: "外商" });
  });
});
