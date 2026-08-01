import { describe, expect, it } from "vitest";

import { describeError } from "./errors";

describe("describeError", () => {
  it("maps mic permission denial (DOMException name survives)", () => {
    const e = new DOMException("Permission denied", "NotAllowedError");
    expect(describeError(e)).toContain("麥克風權限被拒");
  });

  it("maps an invalid-key API blob", () => {
    const e = new Error(
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
    );
    expect(describeError(e)).toContain("金鑰無效");
  });

  it("maps quota exhaustion and warns against blind retry", () => {
    const msg = describeError(new Error("429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric"));
    expect(msg).toContain("額度已用完");
    expect(msg).toContain("重試");
  });

  it("maps a retired/renamed model to the ⚙️ override hint", () => {
    const msg = describeError(
      new Error("models/gemini-3.1-flash-live-preview is not found for API version v1beta"),
    );
    expect(msg).toContain("語音模型");
  });

  it("maps plain connectivity failures", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toContain("網路連線失敗");
  });

  it("passes unknown errors through untouched — never hide diagnostics", () => {
    expect(describeError(new Error("something quite unexpected"))).toContain(
      "something quite unexpected",
    );
  });

  it("handles WebSocket close-reason strings (not Error instances)", () => {
    expect(describeError("quota exceeded")).toContain("額度已用完");
  });
});
