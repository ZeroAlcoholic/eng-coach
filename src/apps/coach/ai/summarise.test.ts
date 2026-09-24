import { beforeEach, describe, expect, it, vi } from "vitest";

// The ONE injection boundary of the judge: the model call. Everything else
// (prompt, validator, median) runs for real.
vi.mock("./client", async (importOriginal) => {
  const real = await importOriginal<typeof import("./client")>();
  return { ...real, generateJson: vi.fn() };
});

import { generateJson } from "./client";
import { summariseSession } from "./review";

const mocked = vi.mocked(generateJson);

const sample = (grammar: number) => ({
  cefr: "B1",
  subscores: { grammar, vocab: 3, fluency: 3, interaction: 3 },
  reviewEn: "ok",
  reviewZh: "好",
  progressNote: "n",
  errors: [],
});

const transcript = [
  { who: "coach" as const, text: "Hi" },
  { who: "user" as const, text: "I goed to the office" },
];

beforeEach(() => mocked.mockReset());

describe("summariseSession — orchestration over validated samples", () => {
  it("never calls the model when the learner did not speak", async () => {
    const out = await summariseSession("k", { transcript: [{ who: "coach", text: "Hello?" }, { who: "user", text: "   " }], level: "B1" });
    expect(out.kind).toBe("unavailable");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("all samples rejected → unavailable with the first rejection's reason, no fallback merged", async () => {
    mocked.mockRejectedValueOnce(new Error("$.subscores.grammar: expected an integer in 1..6"));
    mocked.mockRejectedValueOnce(new Error("503"));
    const out = await summariseSession("k", { transcript, level: "B1" }, { samples: 2 });
    expect(out).toEqual({ kind: "unavailable", reason: "$.subscores.grammar: expected an integer in 1..6" });
  });

  it("k of n valid → median over the k survivors only, samples = k", async () => {
    // generateJson resolves with the PARSED review in production; here the mock
    // stands in for parse too, so hand it already-shaped reviews.
    mocked.mockResolvedValueOnce({ ...sample(2), cefr: "A2" });
    mocked.mockRejectedValueOnce(new Error("invalid"));
    mocked.mockResolvedValueOnce({ ...sample(4), cefr: "B2" });
    const out = await summariseSession("k", { transcript, level: "B1" }, { samples: 3 });
    expect(out.kind).toBe("review");
    if (out.kind === "review") {
      expect(out.samples).toBe(2);
      expect(out.review.subscores?.grammar).toBe(3); // median(2, 4)
    }
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("uses the configured sample count when none is given", async () => {
    mocked.mockResolvedValue(sample(3));
    await summariseSession("k", { transcript, level: "B1" });
    expect(mocked).toHaveBeenCalledTimes(1); // DEFAULT_JUDGE_SAMPLES in overrides.ts
  });
});
