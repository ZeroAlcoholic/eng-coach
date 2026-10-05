import { describe, expect, it } from "vitest";

import { TARGET_LANGUAGES } from "../../kernel/types";
import { randomSeedBrief, SEED_BRIEFS } from "./seeds";

describe("seeds — 換個新劇情", () => {
  it("every language has a pool of distinct, substantial briefs", () => {
    for (const l of TARGET_LANGUAGES) {
      const pool = SEED_BRIEFS[l.id];
      expect(pool.length).toBeGreaterThanOrEqual(10);
      expect(new Set(pool).size).toBe(pool.length);
      for (const b of pool) expect(b.trim().length).toBeGreaterThan(40);
    }
  });

  it("prefers seeds that have not become a scenario yet", () => {
    const pool = SEED_BRIEFS.en;
    const used = pool.slice(1); // everything but the first
    for (let i = 0; i < 20; i++) expect(randomSeedBrief("en", used, Math.random)).toBe(pool[0]);
  });

  it("falls back to the whole pool once every seed has been used, and clamps the rng", () => {
    const pool = SEED_BRIEFS.ja;
    expect(pool).toContain(randomSeedBrief("ja", pool, () => 0.5));
    expect(randomSeedBrief("ja", [], () => 1)).toBe(pool[pool.length - 1]);
    expect(randomSeedBrief("ja", [undefined], () => 0)).toBe(pool[0]);
  });
});
