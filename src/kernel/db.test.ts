import { describe, expect, it } from "vitest";

import { settle, type SettleableRequest, type SettleableTransaction } from "./db";

// Stand-ins for the two IndexedDB objects `settle` listens to. They hold the
// handlers so the test can fire events in the order the browser would.
function fakes<T>(result: T) {
  const tx: SettleableTransaction = { oncomplete: null, onerror: null, onabort: null, error: null };
  const req: SettleableRequest<T> = { onsuccess: null, onerror: null, result, error: null };
  const ev = new Event("x");
  return {
    tx,
    req,
    success: () => req.onsuccess?.(ev),
    complete: () => tx.oncomplete?.(ev),
    abort: (error: DOMException | null = null) => {
      tx.error = error;
      tx.onabort?.(ev);
    },
    requestError: (error: DOMException) => {
      req.error = error;
      req.onerror?.(ev);
    },
  };
}

describe("settle — 「已儲存」means the transaction committed, not that a request succeeded", () => {
  it("does not resolve on the request's onsuccess alone", async () => {
    const f = fakes("key");
    let settled = false;
    const p = settle(f.tx, f.req).then(() => (settled = true));
    f.success();
    await Promise.resolve();
    expect(settled).toBe(false);
    f.complete();
    await p;
    expect(settled).toBe(true);
  });

  it("rejects when the transaction aborts AFTER the request reported success", async () => {
    const f = fakes("key");
    const p = settle(f.tx, f.req);
    f.success();
    f.abort(new DOMException("quota", "QuotaExceededError"));
    await expect(p).rejects.toMatchObject({ name: "QuotaExceededError" });
  });

  it("rejects on a request error with that error", async () => {
    const f = fakes("key");
    const p = settle(f.tx, f.req);
    f.requestError(new DOMException("bad key", "DataError"));
    await expect(p).rejects.toMatchObject({ name: "DataError" });
  });

  it("resolves with the request's result once complete", async () => {
    const f = fakes({ id: "s1" });
    const p = settle(f.tx, f.req);
    f.success();
    f.complete();
    await expect(p).resolves.toEqual({ id: "s1" });
  });
});
