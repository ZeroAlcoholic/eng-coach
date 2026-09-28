// D8 — the micro session's safety net. The prompt asks the coach to wrap up
// after about 90 seconds; a model that keeps going must not turn the drill into
// an open-ended session, so the screen stops it at a hard limit through the
// same Stop path the learner would use. A full session has no timer at all.

export const MICRO_CUTOFF_MS = 120_000;

export interface Stoppable {
  stop: () => Promise<void>;
}

export interface Clock {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

const browserClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

/** Arm the cutoff for a micro session; returns the disarm. For a full session
 *  nothing is armed and the disarm is a no-op — the caller does not branch. */
export function armMicroCutoff(
  isMicro: boolean,
  session: Stoppable,
  onCutoff: () => void,
  clock: Clock = browserClock,
  ms = MICRO_CUTOFF_MS,
): () => void {
  if (!isMicro) return () => {};
  const id = clock.setTimeout(() => {
    void session.stop().then(onCutoff);
  }, ms);
  return () => clock.clearTimeout(id);
}
