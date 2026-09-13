"use client";
import { useEffect, useRef } from "react";

/** Keyboard focus stays in the open call; Escape hangs up and restores focus. */
export function useCallDialog(onEnd: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const end = useRef(onEnd);
  useEffect(() => { end.current = onEnd; }, [onEnd]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']"));
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); end.current(); }
      if (event.key !== "Tab") return;
      const nodes = controls(), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element.addEventListener("keydown", keydown);
    return () => { element.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}
