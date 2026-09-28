// D8 — the micro session's safety net. The prompt asks the coach to wrap up
// after about 90 seconds; a model that keeps going must not turn the drill into
// an open-ended session, so the screen ends it at a hard limit through the
// same「停止並儲存」path the learner would tap. The timer calls that path and
// nothing else: stopping the session here first would emit an `ended` phase
// before the screen has marked itself as finalising, and the screen would
// briefly offer Start again. A full session has no timer at all.

export const MICRO_CUTOFF_MS = 120_000;

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
export function armMicroCutoff(isMicro: boolean, onCutoff: () => void, clock: Clock = browserClock, ms = MICRO_CUTOFF_MS): () => void {
  if (!isMicro) return () => {};
  const id = clock.setTimeout(onCutoff, ms);
  return () => clock.clearTimeout(id);
}
