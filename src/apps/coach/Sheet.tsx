// Minimal bottom sheet — the W5 home for anything that isn't the primary action.
//
// A native <dialog> opened with showModal(): the browser owns focus (Tab stays
// inside, focus returns to the opener on close), Esc fires `cancel`, and the
// page behind is inert — none of which the old div-with-role="dialog" did.

import { useEffect, useRef, type ReactNode } from "react";

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Parents pass a fresh arrow every render; reading it through a ref keeps the
  // dialog open across re-renders instead of closing and re-opening (which would
  // replay the animation and throw focus away).
  const onCloseRef = useRef(props.onClose);
  useEffect(() => {
    onCloseRef.current = props.onClose;
  });

  // Close the ELEMENT first, then tell React. The browser restores focus to the
  // opener only when close() runs on a connected dialog; unmounting an open
  // dialog drops focus on <body>.
  const requestClose = () => {
    const el = ref.current;
    if (el?.open) el.close();
    onCloseRef.current();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showModal();
    // Esc → the dialog's `cancel` event; route it through the same close path.
    const onCancel = (e: Event) => {
      e.preventDefault();
      requestClose();
    };
    // Backdrop tap = close: a click whose target is the dialog element itself
    // landed on ::backdrop (children swallow their own clicks). Keyboard users
    // have Esc and the ✕ button, so this is pointer-only on purpose.
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === el) requestClose();
    };
    el.addEventListener("cancel", onCancel);
    el.addEventListener("click", onBackdrop);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("click", onBackdrop);
      if (el.open) el.close();
    };
  }, []);

  return (
    <dialog ref={ref} className="sheet" aria-label={props.title}>
      <div className="sheet-head">
        <b>{props.title}</b>
        <button className="btn btn--ghost btn--sm" onClick={requestClose}>
          ✕ 關閉
        </button>
      </div>
      <div className="sheet-body">{props.children}</div>
    </dialog>
  );
}
