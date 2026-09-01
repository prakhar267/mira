"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export function Modal({ title, description, children, onClose }: { title: string; description?: string; children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("button, input, select, textarea");
    first?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <div className="modal__surface">
        <button type="button" className="icon-button modal__close" aria-label="Close dialog" onClick={onClose}><X aria-hidden="true" /></button>
        <h2 id={titleId}>{title}</h2>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {children}
      </div>
    </dialog>
  );
}
