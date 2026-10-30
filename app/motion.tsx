"use client";
import { useEffect, type RefObject } from "react";
import "lenis/dist/lenis.css";
export function useInterfaceMotion(
  scope: RefObject<HTMLDivElement | null>,
  view: string,
  ready: boolean,
) {
  useEffect(() => {
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
    });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let revert: (() => void) | undefined;
    void import("gsap").then(({ default: gsap }) => {
      if (disposed || !scope.current) return;
      const context = gsap.context(() => {
        const media = gsap.matchMedia();
        media.add("(prefers-reduced-motion: no-preference)", () => {
          gsap.from(".page-heading > div", {
            y: 18,
            opacity: 0,
            duration: 0.7,
            stagger: 0.08,
            ease: "power3.out",
          });
          const elements = scope.current?.querySelectorAll(
            "[data-enter], .metrics-grid > *, .system-card, .integration-card",
          );
          if (elements?.length)
            gsap.from(elements, {
              y: 16,
              opacity: 0,
              duration: 0.65,
              stagger: 0.055,
              ease: "power3.out",
              clearProps: "transform,opacity",
            });
          const bars = scope.current?.querySelectorAll(".waterfall .span-bar");
          if (bars?.length)
            gsap.from(bars, {
              scaleX: 0,
              transformOrigin: "left",
              duration: 0.7,
              stagger: 0.025,
              ease: "power2.out",
            });
        });
        return () => media.revert();
      }, scope);
      revert = () => context.revert();
    });
    return () => {
      disposed = true;
      revert?.();
    };
  }, [scope, view, ready]);
}
