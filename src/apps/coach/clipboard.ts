// Copy text on a user tap. The async Clipboard API is missing on plain-http
// origins and in some WebViews, and can be denied; the legacy execCommand path
// still works in most of those. Returns false only when both fail, so the
// caller can show the text for a manual copy instead of claiming success.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path
  }
  // select() moves focus into the throwaway textarea; hand it back afterwards,
  // or a sheet opened next would return focus to <body> instead of the button.
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    prev?.focus();
  }
}
