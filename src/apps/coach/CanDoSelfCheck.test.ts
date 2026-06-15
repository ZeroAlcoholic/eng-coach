import { describe, expect, it } from "vitest";

import { calibrationNote } from "./CanDoSelfCheck";

describe("calibrationNote — self-assessment vs judge (C3)", () => {
  it("nudges on overconfidence: learner says 可以 but judge says not met", () => {
    expect(calibrationNote("yes", false)).toContain("還沒很穩");
  });

  it("reassures on underconfidence: learner unsure but judge says met", () => {
    expect(calibrationNote("no", true)).toContain("做到了");
    expect(calibrationNote("partly", true)).toContain("做到了");
  });

  it("stays silent when self and judge agree", () => {
    expect(calibrationNote("yes", true)).toBeNull();
    expect(calibrationNote("no", false)).toBeNull();
    expect(calibrationNote("partly", false)).toBeNull();
  });
});
