"use client";
import { useEffect, type RefObject } from "react";
import "lenis/dist/lenis.css";

/**
 * Scroll remains smooth without resetting content after it is already visible.
 *
 * Previously an asynchronously imported gsap.from() animation ran after React
 * hydration and data arrival. The page briefly rendered, disappeared, then
 * re-entered on each view change/refresh. First-paint CSS motion lives in
 * premium.css instead; no delayed opacity/transform writes occur here.
 */
export function useInterfaceMotion(
  _scope: RefObject<HTMLDivElement | null>,
  _view: string,
  _ready: boolean,
) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    void import("lenis").then(({ default: Lenis }) => {
      if (disposed) return;
      const lenis = new Lenis({
        autoRaf: true,
        lerp: 0.13,
        smoothWheel: true,
        syncTouch: false,
        anchors: true,
        respectReducedMotion: true,
      });
      destroy = () => lenis.destroy();
    }).catch(() => {
      // Native scrolling remains usable if the optional smooth-scroll
      // enhancement cannot load.
    });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, []);
}
