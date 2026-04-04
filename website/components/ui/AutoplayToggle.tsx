"use client";

import { useEffect, useRef } from "react";
import { useScrollScene } from "./ScrollScene";

export function AutoplayToggle() {
  const { lenis } = useScrollScene();
  const lenisRef = useRef(lenis);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  // Keep lenis ref in sync
  useEffect(() => {
    lenisRef.current = lenis;
  }, [lenis]);

  useEffect(() => {
    function stop() {
      playingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    function play() {
      const l = lenisRef.current;
      if (!l) return;
      playingRef.current = true;

      const startScroll = window.scrollY;
      const startTime = performance.now();
      const duration = 90_000;

      function tick() {
        if (!playingRef.current) return;
        const totalHeight =
          document.documentElement.scrollHeight - window.innerHeight;
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const targetY = startScroll + (totalHeight - startScroll) * progress;

        lenisRef.current?.scrollTo(targetY, { immediate: true });

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          playingRef.current = false;
          rafRef.current = null;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Tab") {
        e.preventDefault();
        if (playingRef.current) stop();
        else play();
      }
    }

    function onManualScroll() {
      if (playingRef.current) stop();
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onManualScroll, { passive: true });
    window.addEventListener("touchstart", onManualScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onManualScroll);
      window.removeEventListener("touchstart", onManualScroll);
      stop();
    };
  }, []);

  return null;
}
