// Narrowing primitives for UNTRUSTED input: model JSON, imported packs, records
// written by an older build. Each helper either returns the narrowed value or
// throws `Invalid` naming the path, so the caller can refuse the whole input
// with a message a person can act on instead of `as T`-ing it and failing later
// somewhere unrelated.
//
// Deliberately not a schema library: a dozen functions cover every contract in
// this app, and a thrown path is all the diagnostics a single-user tool needs.

export class Invalid extends Error {
  constructor(
    public readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = "Invalid";
  }
}

export type Parser<T> = (value: unknown, path: string) => T;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function record(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Invalid(path, "expected an object");
  return v;
}

export function string(v: unknown, path: string): string {
  if (typeof v !== "string") throw new Invalid(path, "expected a string");
  return v;
}

export function nonEmptyString(v: unknown, path: string): string {
  const s = string(v, path).trim();
  if (!s) throw new Invalid(path, "expected a non-empty string");
  return s;
}

export function boolean(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new Invalid(path, "expected a boolean");
  return v;
}

export function number(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Invalid(path, "expected a number");
  return v;
}

export const integerIn =
  (min: number, max: number): Parser<number> =>
  (v, path) => {
    const n = number(v, path);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Invalid(path, `expected an integer in ${min}..${max}`);
    return n;
  };

export const enumOf =
  <T extends string>(values: readonly T[]): Parser<T> =>
  (v, path) => {
    if (typeof v !== "string" || !(values as readonly string[]).includes(v))
      throw new Invalid(path, `expected one of ${values.join("|")}`);
    return v as T; // narrowed by the includes check above
  };

export const arrayOf =
  <T>(item: Parser<T>): Parser<T[]> =>
  (v, path) => {
    if (!Array.isArray(v)) throw new Invalid(path, "expected an array");
    return v.map((x, i) => item(x, `${path}[${i}]`));
  };

/** Like arrayOf, but DROPS entries that fail instead of rejecting the array —
 *  for lists where one bad element (a model hallucination) should not void the
 *  rest. Returns the survivors. */
export const arrayKeeping =
  <T>(item: Parser<T>): Parser<T[]> =>
  (v, path) => {
    if (!Array.isArray(v)) throw new Invalid(path, "expected an array");
    const out: T[] = [];
    v.forEach((x, i) => {
      try {
        out.push(item(x, `${path}[${i}]`));
      } catch (err) {
        if (!(err instanceof Invalid)) throw err;
      }
    });
    return out;
  };

/** undefined / null → undefined; anything else must parse. */
export const optional =
  <T>(item: Parser<T>): Parser<T | undefined> =>
  (v, path) =>
    v === undefined || v === null ? undefined : item(v, path);

/** Read one field of an already-checked record. */
export function field<T>(rec: Record<string, unknown>, key: string, item: Parser<T>, path: string): T {
  return item(rec[key], `${path}.${key}`);
}

/** ISO-ish timestamp: a string Date can parse. */
export function isoDate(v: unknown, path: string): string {
  const s = string(v, path);
  if (Number.isNaN(Date.parse(s))) throw new Invalid(path, "expected an ISO date string");
  return s;
}
