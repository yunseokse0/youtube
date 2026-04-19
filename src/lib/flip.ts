import { useLayoutEffect, useRef } from "react";

export function useFlip(keys: string[], duration = 500) {
  const prevRects = useRef(new Map<string, DOMRect>());
  const elements = useRef(new Map<string, HTMLElement>());
  const keySignature = keys.join("|");

  const setEl = (key: string) => (el: HTMLElement | null) => {
    if (el) elements.current.set(key, el);
    else elements.current.delete(key);
  };

  useLayoutEffect(() => {
    const rects = new Map<string, DOMRect>();
    for (const [k, el] of elements.current.entries()) {
      rects.set(k, el.getBoundingClientRect());
    }
    const prev = prevRects.current;
    for (const [k, el] of elements.current.entries()) {
      const newR = rects.get(k);
      const oldR = prev.get(k);
      if (!newR || !oldR) continue;
      const dx = oldR.left - newR.left;
      const dy = oldR.top - newR.top;
      if (dx !== 0 || dy !== 0) {
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        // Force reflow
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
        el.style.transform = "translate(0px, 0px)";
        const cleanup = () => {
          el.style.transition = "";
          el.removeEventListener("transitionend", cleanup);
        };
        el.addEventListener("transitionend", cleanup);
      }
    }
    prevRects.current = rects;
  }, [keySignature, duration]);

  return setEl;
}
