"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function ProgressBar() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const trigger = ScrollTrigger.create({
      trigger: document.documentElement,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        bar.style.width = `${self.progress * 100}%`;
      },
    });

    return () => {
      trigger.kill();
    };
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-[3px]">
      <div
        ref={barRef}
        className="h-full w-0 bg-accent-light"
        style={{
          boxShadow: "0 0 8px rgba(59, 130, 246, 0.5)",
        }}
      />
    </div>
  );
}
