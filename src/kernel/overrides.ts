// Escape hatch for model renames. Google rotates live model names (2.5-live was
// pulled from the docs in 2026-05, 3.1-flash-live-preview went legacy in 2026-09);
// with no server there is no remote hotfix, so the deployed app must be
// repairable from the phone itself — an override in ⚙️ beats waiting for a
// rebuild + redeploy. The previous `gemini-3.1-flash-live-preview` still works
// as an override value if 3.8 misbehaves on a given key.

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

const LIVE_MODEL_KEY = "live_model_override";

export function getLiveModelOverride(): string {
  return localStorage.getItem(LIVE_MODEL_KEY)?.trim() ?? "";
}

export function setLiveModelOverride(name: string): void {
  const v = name.trim();
  if (v) localStorage.setItem(LIVE_MODEL_KEY, v);
  else localStorage.removeItem(LIVE_MODEL_KEY);
}

/** The live model to actually connect with: override if set, else the default. */
export function liveModel(): string {
  return getLiveModelOverride() || DEFAULT_LIVE_MODEL;
}
