// U2 — skip the extra「開始」tap, but only where the browser has already granted
// the microphone. Anything else — prompt, denied, a query that throws, no
// Permissions API — keeps the button: starting would raise a permission prompt
// the learner did not ask for, or fail. Apple touch devices keep the button
// too: WebKit may hold an AudioContext created without a fresh tap suspended,
// and the session would sit at「等待麥克風」.

type MicPermissions = { query: (d: { name: PermissionName }) => Promise<{ state: PermissionState }> };

export async function shouldAutoStart(permissions: MicPermissions | undefined, autoStart: boolean): Promise<boolean> {
  if (!autoStart || !permissions) return false;
  try {
    const status = await permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false; // unknown permission name, or the query itself failed: keep the button
  }
}

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function appleTouchDevice(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
}

/** Still nothing started: this effect run is current, no start is in flight,
 *  and the session never left idle (the learner did not tap 開始 meanwhile). */
export function stillIdle(s: { alive: boolean; starting: boolean; phase: string }): boolean {
  return s.alive && !s.starting && s.phase === "idle";
}

/** Practice's mount effect: start at most once, and only on a granted mic.
 *  `isStillIdle` is checked after the async query, so a learner who tapped
 *  開始 (or left the page) meanwhile is not started a second time. */
export async function runAutoStart(
  permissions: MicPermissions | undefined,
  autoStart: boolean,
  isStillIdle: () => boolean,
  start: () => void,
): Promise<void> {
  if ((await shouldAutoStart(permissions, autoStart)) && isStillIdle()) start();
}
