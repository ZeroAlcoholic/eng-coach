// Minimal bottom sheet — the W5 home for anything that isn't the primary
// action. One overlay, scrollable body, closes on backdrop tap, Esc, or ✕.

import { useEffect, type ReactNode } from "react";

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props;

  // Esc closes (desktop nicety; harmless on touch).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // Backdrop tap = close. Keyboard users have Esc and the ✕ button, so the
    // presentation role is honest here.
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="sheet-head">
          <b>{props.title}</b>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            ✕ 關閉
          </button>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
