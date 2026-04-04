"use client";

import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

interface ScrollSceneContextValue {
  lenis: Lenis | null;
}

const ScrollSceneContext = createContext<ScrollSceneContextValue>({ lenis: null });

export function useScrollScene() {
  return useContext(ScrollSceneContext);
}

export function ScrollScene({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);

  useEffect(() => {
    // F3: Override native smooth scroll — conflicts with Lenis
    const html = document.documentElement;
    html.style.scrollBehavior = "auto";

    const instance = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 2,
    });

    setLenis(instance);

    instance.on("scroll", ScrollTrigger.update);

    // F2: Store reference so cleanup removes the correct function
    const tickHandler = (time: number) => {
      instance.raf(time * 1000);
    };
    gsap.ticker.add(tickHandler);
    gsap.ticker.lagSmoothing(0);

    return () => {
      instance.destroy();
      setLenis(null);
      gsap.ticker.remove(tickHandler);
      ScrollTrigger.getAll().forEach((t) => t.kill());
      html.style.scrollBehavior = "";
    };
  }, []);

  return (
    <ScrollSceneContext.Provider value={{ lenis }}>
      {children}
    </ScrollSceneContext.Provider>
  );
}
