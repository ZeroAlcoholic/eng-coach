import { describe, expect, it } from "vitest";

import { arrayKeeping, arrayOf, enumOf, field, integerIn, Invalid, nonEmptyString, optional, record } from "./validate";

describe("validate primitives — refuse with a path, never coerce", () => {
  it("names the path of the offending field", () => {
    expect(() => field(record({ a: {} }, "$"), "a", nonEmptyString, "$")).toThrow(/^\$\.a: /);
  });

  it("enumOf rejects a value outside the closed set", () => {
    const p = enumOf(["en", "ja"] as const);
    expect(p("en", "$")).toBe("en");
    expect(() => p("zh", "$")).toThrow(Invalid);
  });

  it("integerIn rejects floats and out-of-range integers", () => {
    const p = integerIn(1, 6);
    expect(() => p(2.5, "$")).toThrow(Invalid);
    expect(() => p(0, "$")).toThrow(Invalid);
    expect(p(6, "$")).toBe(6);
  });

  it("arrayOf rejects the whole array on one bad element; arrayKeeping drops it", () => {
    expect(() => arrayOf(nonEmptyString)(["a", ""], "$")).toThrow(Invalid);
    expect(arrayKeeping(nonEmptyString)(["a", "", 3, "b"], "$")).toEqual(["a", "b"]);
  });

  it("optional passes undefined/null through and still validates a present value", () => {
    const p = optional(nonEmptyString);
    expect(p(undefined, "$")).toBeUndefined();
    expect(p(null, "$")).toBeUndefined();
    expect(() => p(1, "$")).toThrow(Invalid);
  });
});
