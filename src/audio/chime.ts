// C1 — the「換你說」tone: a short sine blip on the engine's own context, so it
// needs no asset and follows the same output route as the coach's voice.

export const CHIME = { hz: 880, gain: 0.15, seconds: 0.08 } as const;

type ChimeContext = Pick<BaseAudioContext, "state" | "currentTime" | "destination" | "createOscillator" | "createGain">;

/** Schedule one chime now. A context that is not running (suspended by the
 *  browser, or closed) plays nothing and throws nothing. */
export function scheduleChime(ctx: ChimeContext | null): void {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(CHIME.hz, t);
  gain.gain.setValueAtTime(CHIME.gain, t);
  gain.gain.linearRampToValueAtTime(0, t + CHIME.seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + CHIME.seconds);
}
