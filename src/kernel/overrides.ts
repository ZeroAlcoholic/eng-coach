// Escape hatches for things Google changes under a deployed static app. With no
// server there is no remote hotfix, so the model names and the judge's sampling
// must be repairable from the phone itself (⚙️) — an override in localStorage
// beats waiting for a rebuild + redeploy. Every default lives HERE and nowhere
// else, so a rename is one edit.
//
// Live: 3.1-flash-live-preview went legacy in 2026-09; `gemini-3.8-live` is the
// stable default and the old name still works as an override on a key that
// misbehaves on 3.8. Text: `gemini-3.8-flash` 晉級 in the fixture screening
// (docs/SCREENING_2026-09-24.md: 1.3% validator failures vs 29.3%).

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
export const DEFAULT_TEXT_MODEL = "gemini-3.8-flash";
// How many times the judge samples the transcript before medianing the numbers.
// The same screening found median-of-3 did not reduce the CEFR spread by a band,
// so 1 is the default; 3 remains available as an override.
export const DEFAULT_JUDGE_SAMPLES = 1;
const JUDGE_SAMPLES_RANGE = { min: 1, max: 5 };

const LIVE_MODEL_KEY = "live_model_override";
const TEXT_MODEL_KEY = "text_model_override";
const JUDGE_SAMPLES_KEY = "judge_samples_override";

// Absent outside a browser (vitest runs in node), where defaults simply apply.
function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function readOverride(key: string): string {
  return storage()?.getItem(key)?.trim() ?? "";
}

function writeOverride(key: string, value: string): void {
  const v = value.trim();
  if (v) storage()?.setItem(key, v);
  else storage()?.removeItem(key);
}

export const getLiveModelOverride = () => readOverride(LIVE_MODEL_KEY);
export const setLiveModelOverride = (name: string) => writeOverride(LIVE_MODEL_KEY, name);
/** The live model to actually connect with: override if set, else the default. */
export const liveModel = () => getLiveModelOverride() || DEFAULT_LIVE_MODEL;

export const getTextModelOverride = () => readOverride(TEXT_MODEL_KEY);
export const setTextModelOverride = (name: string) => writeOverride(TEXT_MODEL_KEY, name);
/** The text (judge / generator) model: override if set, else the default. */
export const textModel = () => getTextModelOverride() || DEFAULT_TEXT_MODEL;

export const getJudgeSamplesOverride = () => readOverride(JUDGE_SAMPLES_KEY);
export const setJudgeSamplesOverride = (n: string) => writeOverride(JUDGE_SAMPLES_KEY, n);
/** Judge sample count: a valid override in range, else the default. */
export function judgeSamples(): number {
  const n = Number.parseInt(getJudgeSamplesOverride(), 10);
  return Number.isInteger(n) && n >= JUDGE_SAMPLES_RANGE.min && n <= JUDGE_SAMPLES_RANGE.max
    ? n
    : DEFAULT_JUDGE_SAMPLES;
}
