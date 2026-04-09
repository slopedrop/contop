"use client";

import { useRef, useEffect } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextPlugin } from "gsap/TextPlugin";
import { useReducedMotion } from "@/hooks/useReducedMotion";

gsap.registerPlugin(ScrollTrigger, TextPlugin);

export function CinematicExplainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  // Hide navbar on scroll
  useEffect(() => {
    const nav = document.querySelector("nav");
    if (!nav) return;
    let hidden = false;
    const onScroll = () => {
      if (window.scrollY > 80 && !hidden) {
        nav.style.transform = "translateY(-100%)";
        nav.style.transition = "transform 0.4s ease";
        hidden = true;
      } else if (window.scrollY <= 80 && hidden) {
        nav.style.transform = "";
        hidden = false;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      nav.style.transform = "";
      nav.style.transition = "";
    };
  }, []);

  useGSAP(
    () => {
      const container = containerRef.current;
      if (!container || reducedMotion) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: "+=11500%",
          pin: true,
          scrub: 0.3,
          anticipatePin: 1,
        },
      });

      // Helper: show scene, animate inside, hide scene
      const scene = (sel: string) => ({
        in: () => tl.to(sel, { opacity: 1, duration: 0.3 }),
        out: () => tl.to(sel, { opacity: 0, duration: 0.3 }),
        hold: (d = 0.4) => tl.to(sel, { opacity: 1, duration: d }),
      });

      // ── Scene 1: "Your phone is in your pocket." ──
      const s1 = scene(".s1");
      s1.in();
      tl.from(".s1-w", { opacity: 0, y: 8, stagger: 0.12, duration: 0.15 });
      s1.hold();
      s1.out();

      // ── Scene 2: "Your computer is at home." ──
      const s2 = scene(".s2");
      s2.in();
      tl.from(".s2-w", { opacity: 0, y: 8, stagger: 0.12, duration: 0.15 });
      s2.hold();
      s2.out();

      // ── Scene 3: "Something just broke." ──
      const s3 = scene(".s3");
      s3.in();
      tl.from(".s3-main", { opacity: 0, duration: 0.2 })
        .from(".s3-hit", {
          scale: 1.3,
          opacity: 0,
          duration: 0.25,
          ease: "power2.out",
        });
      s3.hold(0.5);
      s3.out();

      // ── Scene 4: Phone with voice + text input ──
      const s4 = scene(".s4");
      s4.in();
      tl.from(".s4-phone", { y: 60, opacity: 0, duration: 0.5, ease: "power3.out" })
        .from(".s4-wave-bar", {
          scaleY: 0,
          transformOrigin: "bottom center",
          stagger: 0.02,
          duration: 0.08,
        })
        .from(".s4-or", { opacity: 0, duration: 0.2 })
        .from(".s4-input", { opacity: 0, y: 10, duration: 0.3 })
        .to(".s4-typed", {
          text: { value: "export slides as PDF" },
          duration: 0.8,
          ease: "none",
        });
      tl.from(".s4-label", { opacity: 0, duration: 0.2 })
        .from(".s4-sub", { opacity: 0, duration: 0.2 });
      s4.hold(0.3);
      s4.out();

      // ── Scene 5: Three commands - char-by-char typewriter ──
      const s5 = scene(".s5");
      s5.in();
      // Command 1: tech
      tl.to(".s5-cmd1", { opacity: 1, duration: 0 })
        .to(".s5-text1", {
          text: { value: "\u201CMy server keeps crashing \u2014 check the logs and fix it.\u201D" },
          duration: 2.5, ease: "none",
        })
        .to({}, { duration: 0.6 })
        .to(".s5-cmd1", { opacity: 0, duration: 0.1 });
      // Command 2: non-tech
      tl.to(".s5-cmd2", { opacity: 1, duration: 0 })
        .to(".s5-text2", {
          text: { value: "\u201COpen my presentation, export it as PDF, and email it to the team.\u201D" },
          duration: 2.5, ease: "none",
        })
        .to({}, { duration: 0.6 })
        .to(".s5-cmd2", { opacity: 0, duration: 0.1 });
      // Command 3: browsing/action - stays
      tl.to(".s5-cmd3", { opacity: 1, duration: 0 })
        .to(".s5-text3", {
          text: { value: "\u201CCompress my project folder and upload it to Google Drive.\u201D" },
          duration: 2.5, ease: "none",
        });
      s5.hold(1.2);
      s5.out();

      // ── Scene 6: AI agent understands ──
      const s6 = scene(".s6");
      s6.in();
      tl.from(".s6-icon", {
        scale: 0,
        duration: 0.4,
        ease: "power2.out",
      })
        .from(".s6-ring", {
          scale: 0.5,
          opacity: 0,
          duration: 0.5,
        })
        .from(".s6-text", { opacity: 0, y: 10, duration: 0.3 });
      s6.hold(0.3);
      s6.out();

      // ── Scene 7: Agent working - lines type in char by char ──
      const s7 = scene(".s7");
      s7.in();
      tl.to(".s7-l1", { text: { value: "Reading your screen..." }, duration: 0.4, ease: "none" })
        .to(".s7-l2", { text: { value: "Planning the steps..." }, duration: 0.4, ease: "none" })
        .to(".s7-l3", { text: { value: "Executing actions on your computer..." }, duration: 0.5, ease: "none" })
        .to(".s7-l4", { text: { value: "All done. Everything looks good." }, duration: 0.4, ease: "none" });
      s7.hold(0.8);
      s7.out();

      // ── Scene 8: "Done." - big impact ──
      const s8 = scene(".s8");
      s8.in();
      tl.from(".s8-done", {
        scale: 0.6,
        opacity: 0,
        duration: 0.3,
        ease: "power2.out",
      }).from(".s8-time", { opacity: 0, y: 10, duration: 0.3 });
      s8.hold(0.6);
      s8.out();

      // ── Scene 9: "Here's how." ──
      const s9 = scene(".s9");
      s9.in();
      tl.from(".s9-text", { opacity: 0, duration: 0.3 });
      s9.hold(0.3);
      s9.out();

      // ── Scene 10: QR scan - pieces assemble ──
      const s10 = scene(".s10");
      s10.in();
      tl.from(".s10-cell", {
        scale: 0,
        opacity: 0,
        stagger: { amount: 0.5, from: "center" },
        duration: 0.1,
      })
        .from(".s10-label", { opacity: 0, duration: 0.15 })
        .to(".s10-qr", { opacity: 0, scale: 0.8, duration: 0.3, delay: 0.3 })
        .to(".s10-label", { opacity: 0, duration: 0.15 }, "<")
        .from(".s10-lock", { scale: 0, opacity: 0, duration: 0.3, ease: "power2.out" })
        .from(".s10-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s10-sub", { opacity: 0, duration: 0.2 });
      s10.hold(0.6);
      s10.out();

      // ── Live desktop on your phone ──
      const sReplica = scene(".s-replica");
      sReplica.in();
      tl.from(".s-replica-phone", { y: 50, opacity: 0, duration: 0.4, ease: "power3.out" })
        .from(".s-replica-screen", { opacity: 0, duration: 0.3 })
        .from(".s-replica-line", { scaleX: 0, transformOrigin: "left center", stagger: 0.1, duration: 0.15 })
        .from(".s-replica-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-replica-sub", { opacity: 0, duration: 0.2 });
      sReplica.hold(0.4);
      sReplica.out();

      // ── Scene 11: Your computer does the work ──
      const s11 = scene(".s11");
      s11.in();
      tl.from(".s11-icon", { scale: 0.8, opacity: 0, duration: 0.3, ease: "power2.out" })
        .from(".s11-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s11-sub", { opacity: 0, duration: 0.2 });
      s11.hold(0.3);
      s11.out();

      // ── Scene 12: Capabilities - staggered line reveals ──
      const s12 = scene(".s12");
      s12.in();
      tl.from(".s12-title", { opacity: 0, duration: 0.2 }).from(".s12-line", {
        opacity: 0,
        x: -15,
        stagger: 0.15,
        duration: 0.2,
      });
      s12.hold(1.0);
      s12.out();

      // ── Any model. Your keys. ──
      const sModels = scene(".s-models");
      sModels.in();
      tl.from(".s-models-name", { opacity: 0, y: 12, stagger: 0.12, duration: 0.2 })
        .from(".s-models-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-models-sub", { opacity: 0, duration: 0.2 });
      sModels.hold(0.7);
      sModels.out();

      // ── Or your subscription. Zero API keys. ──
      const sSub = scene(".s-sub");
      sSub.in();
      tl.from(".s-sub-badge", { scale: 0, opacity: 0, stagger: 0.15, duration: 0.2, ease: "back.out(2)" })
        .from(".s-sub-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-sub-detail", { opacity: 0, y: 8, stagger: 0.12, duration: 0.2 })
        .from(".s-sub-note", { opacity: 0, duration: 0.2 });
      sSub.hold(0.9);
      sSub.out();

      // ── Extend with skills ──
      const sSkills = scene(".s-skills");
      sSkills.in();
      tl.from(".s-skills-file", { y: 20, opacity: 0, duration: 0.3 })
        .to(".s-skills-typed", {
          text: { value: "name: deploy-preview\ntype: workflow\ntrigger: \"deploy this\"" },
          duration: 0.6, ease: "none",
        })
        .from(".s-skills-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-skills-sub", { opacity: 0, duration: 0.2 });
      sSkills.hold(0.4);
      sSkills.out();

      // ── Your rules. Your workflow. ──
      const sInstruct = scene(".s-instruct");
      sInstruct.in();
      tl.from(".s-instruct-card", { y: 20, opacity: 0, duration: 0.3 })
        .to(".s-instruct-typed", {
          text: { value: "Always prefer CLI over GUI.\nAsk before deleting anything." },
          duration: 0.6, ease: "none",
        })
        .from(".s-instruct-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-instruct-sub", { opacity: 0, duration: 0.2 });
      sInstruct.hold(0.4);
      sInstruct.out();

      // ── Scene 13: "Dangerous commands?" ──
      const s13 = scene(".s13");
      s13.in();
      tl.from(".s13-main", { opacity: 0, duration: 0.2 }).from(".s13-warn", {
        scale: 1.15,
        opacity: 0,
        duration: 0.3,
        ease: "power2.out",
      });
      s13.hold(0.4);
      s13.out();

      // ── Scene 14: Approval card - slides in ──
      const s14 = scene(".s14");
      s14.in();
      tl.from(".s14-card", {
        y: 40,
        opacity: 0,
        duration: 0.4,
        ease: "power3.out",
      })
        .to(".s14-cmd", {
          text: { value: "rm -rf ./build/*" },
          duration: 0.5,
          ease: "none",
        })
        .from(".s14-btn", {
          opacity: 0,
          y: 8,
          stagger: 0.1,
          duration: 0.2,
        })
      s14.hold(0.4);
      s14.out();

      // ── Security details - animated with icons ──
      const sSecure = scene(".s-secure");
      sSecure.in();
      tl.from(".s-secure-item", { opacity: 0, x: -20, stagger: 0.2, duration: 0.25 });
      sSecure.hold(1.0);
      sSecure.out();

      // ── Device Management - paired devices scene ──
      const sDevices = scene(".s-devices");
      sDevices.in();
      tl.from(".s-devices-card", { y: 30, opacity: 0, duration: 0.3, ease: "power3.out" })
        .from(".s-devices-dot", { scale: 0, duration: 0.15, ease: "back.out(3)" })
        .from(".s-devices-info", { opacity: 0, x: -10, stagger: 0.1, duration: 0.15 })
        .from(".s-devices-alert", { y: 15, opacity: 0, duration: 0.25, ease: "power2.out" })
        .from(".s-devices-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-devices-sub", { opacity: 0, duration: 0.2 });
      sDevices.hold(0.8);
      sDevices.out();

      // ── Away Mode - The problem ──
      const sAway = scene(".s-away");
      sAway.in();
      tl.from(".s-away-problem", { opacity: 0, duration: 0.3 })
        .to(".s-away-typed", { text: { value: "But what about when you walk away?" }, duration: 0.8, ease: "none" })
        .from(".s-away-warn", { opacity: 0, scale: 0.8, duration: 0.2 });
      sAway.hold(0.3);
      sAway.out();

      // ── Away Mode - Lock engages ──
      const sAwayLock = scene(".s-away-lock");
      sAwayLock.in();
      tl.from(".s-away-laptop", { opacity: 0, y: 20, duration: 0.3 })
        .to(".s-away-screen", { backgroundColor: "rgba(0,0,0,0.95)", duration: 0.3 })
        .from(".s-away-pin", { opacity: 0, scale: 0.9, duration: 0.2 })
        .from(".s-away-lock-icon", { opacity: 0, scale: 0, duration: 0.2, ease: "back.out(2)" });
      sAwayLock.hold(0.3);
      sAwayLock.out();

      // ── Away Mode - Split view ──
      const sAwaySplit = scene(".s-away-split");
      sAwaySplit.in();
      tl.from(".s-away-left", { opacity: 0, x: -30, duration: 0.3 })
        .from(".s-away-right", { opacity: 0, x: 30, duration: 0.3 }, "<0.1")
        .from(".s-away-caption", { opacity: 0, y: 10, duration: 0.2 });
      sAwaySplit.hold(0.4);
      tl.from(".s-away-feat", { opacity: 0, x: -20, stagger: 0.15, duration: 0.2 });
      sAwaySplit.hold(0.7);
      sAwaySplit.out();

      // ── Scene 15: Works everywhere ──
      const s15 = scene(".s15");
      s15.in();
      tl.from(".s15-title", { opacity: 0, duration: 0.2 }).from(
        ".s15-platform",
        { opacity: 0, y: 10, stagger: 0.08, duration: 0.15 }
      );
      s15.hold(0.8);
      s15.out();

      // ── Fully open source ──
      const sOpen = scene(".s-open");
      sOpen.in();
      tl.from(".s-open-icon", { scale: 0.8, opacity: 0, duration: 0.3, ease: "power2.out" })
        .from(".s-open-text", { opacity: 0, y: 10, duration: 0.3 })
        .from(".s-open-sub", { opacity: 0, duration: 0.2 });
      sOpen.hold(0.4);
      sOpen.out();

      // ── Scene 16: "Download. Launch. Scan. Talk." - one word at a time ──
      const s16 = scene(".s16");
      s16.in();
      tl.from(".s16-word", {
        opacity: 0,
        scale: 0.85,
        stagger: 0.25,
        duration: 0.2,
        ease: "power2.out",
      }).from(".s16-sub", { opacity: 0, duration: 0.2 });
      s16.hold(0.4);
      s16.out();

      // ── Scene 17: Logo mark appears, name types in ──
      const s17 = scene(".s17");
      s17.in();
      tl.from(".s17-mark", {
        scale: 0,
        opacity: 0,
        duration: 0.4,
        ease: "power2.out",
      })
        .to(".s17-name", {
          text: { value: "Contop" },
          duration: 0.8,
          ease: "none",
        })
        .from(".s17-tagline", { opacity: 0, y: 10, duration: 0.3 });
      s17.hold(1);
    },
    { scope: containerRef, dependencies: [reducedMotion] }
  );

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full overflow-hidden bg-bg-primary"
    >
      {/* ===== 1 ===== */}
      <div className="s1 scene">
        <p className="px-6 text-center text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          {["Your", "phone", "is", "in", "your", "pocket."].map((w) => (
            <span key={w} className="s1-w inline-block mr-[0.3em]">
              {w}
            </span>
          ))}
        </p>
      </div>

      {/* ===== 2 ===== */}
      <div className="s2 scene">
        <p className="px-6 text-center text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          {["Your", "computer", "is", "at", "home."].map((w) => (
            <span key={w} className="s2-w inline-block mr-[0.3em]">
              {w}
            </span>
          ))}
        </p>
      </div>

      {/* ===== 3 ===== */}
      <div className="s3 scene">
        <p className="px-6 text-center text-3xl font-medium tracking-tight sm:text-5xl lg:text-6xl">
          <span className="s3-main text-text-primary">You need something </span>
          <span className="s3-hit inline-block text-accent-light">done.</span>
        </p>
      </div>

      {/* ===== 4: Phone - voice + text input ===== */}
      <div className="s4 scene flex-col gap-6">
        <div className="s4-phone relative flex h-[260px] w-[130px] flex-col items-center justify-center rounded-[26px] border border-white/[0.08] sm:h-[320px] sm:w-[160px]">
          <div className="mb-6 h-1 w-10 rounded-full bg-white/[0.06]" />
          {/* Voice wave */}
          <div className="flex items-end gap-[3px]">
            {[18, 32, 48, 36, 54, 42, 26, 48, 32, 22, 42, 52, 38].map(
              (h, i) => (
                <div
                  key={i}
                  className="s4-wave-bar w-[3px] rounded-full bg-accent-light/50"
                  style={{ height: `${h}px` }}
                />
              )
            )}
          </div>
          {/* Or divider */}
          <p className="s4-or my-3 font-mono text-[10px] uppercase tracking-widest text-text-muted">
            or
          </p>
          {/* Text input */}
          <div className="s4-input mx-3 flex w-[calc(100%-1.5rem)] items-center rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <span className="s4-typed font-mono text-[10px] text-text-secondary sm:text-xs" />
          </div>
          <div className="mt-4 h-0.5 w-8 rounded-full bg-white/[0.06]" />
        </div>
        <p className="s4-label text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Speak or type. It understands both.
        </p>
        <p className="s4-sub text-base text-text-muted sm:text-lg">
          The AI sees your screen, plans the steps, and executes them.
        </p>
      </div>

      {/* ===== 5: Three commands - char-by-char typewriter ===== */}
      <div className="s5 scene">
        <div className="relative max-w-2xl px-6 text-center font-mono text-lg sm:text-2xl lg:text-3xl">
          <div className="s5-cmd1 absolute inset-0 flex items-center justify-center text-accent-light opacity-0">
            <span className="s5-text1" />
          </div>
          <div className="s5-cmd2 absolute inset-0 flex items-center justify-center px-6 text-cyan opacity-0">
            <span className="s5-text2" />
          </div>
          <div className="s5-cmd3 absolute inset-0 flex items-center justify-center px-6 text-green-400 opacity-0">
            <span className="s5-text3" />
          </div>
          {/* Invisible spacer for height */}
          <p className="invisible">
            &quot;Open my presentation, export it as PDF, and email it to the team.&quot;
          </p>
        </div>
      </div>

      {/* ===== 6: Agent understands ===== */}
      <div className="s6 scene flex-col gap-6">
        <div className="relative flex items-center justify-center">
          {/* Pulse ring */}
          <div className="s6-ring absolute h-32 w-32 rounded-full border border-accent/10 sm:h-40 sm:w-40" />
          <div className="s6-icon flex h-20 w-20 items-center justify-center rounded-3xl border border-accent/20 sm:h-24 sm:w-24">
            <svg
              viewBox="0 0 24 24"
              className="h-9 w-9 text-accent-light sm:h-11 sm:w-11"
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2" />
              <rect x="7" y="7" width="10" height="10" rx="2" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </div>
        </div>
        <p className="s6-text text-xl font-light text-text-secondary sm:text-2xl">
          An AI agent understands you.
        </p>
      </div>

      {/* ===== 7: Working - typed lines ===== */}
      <div className="s7 scene">
        <div className="w-full max-w-lg space-y-5 px-6 font-mono text-sm sm:text-base">
          <p className="min-h-[1.3em] text-cyan"><span className="s7-l1" /></p>
          <p className="min-h-[1.3em] text-cyan"><span className="s7-l2" /></p>
          <p className="min-h-[1.3em] text-amber-400"><span className="s7-l3" /></p>
          <p className="min-h-[1.3em] text-green-400"><span className="s7-l4" /></p>
        </div>
      </div>

      {/* ===== 8: Done ===== */}
      <div className="s8 scene flex-col gap-4">
        <p className="s8-done text-5xl font-bold tracking-tight text-green-400 sm:text-7xl lg:text-8xl">
          Done.
        </p>
        <p className="s8-time font-mono text-base text-text-muted sm:text-lg">
          47 seconds.
        </p>
      </div>

      {/* ===== 9: How ===== */}
      <div className="s9 scene">
        <p className="s9-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Here&apos;s how.
        </p>
      </div>

      {/* ===== 10: QR → Lock ===== */}
      <div className="s10 scene flex-col items-center gap-4">
        <div className="relative flex flex-col items-center justify-center -mb-[calc(12px+0.75rem)]">
          {/* QR grid */}
          <div className="s10-qr grid grid-cols-5 gap-1">
            {Array.from({ length: 25 }).map((_, i) => (
              <div
                key={i}
                className={`s10-cell h-5 w-5 rounded-[2px] sm:h-6 sm:w-6 ${[0, 1, 2, 4, 5, 6, 10, 12, 14, 18, 19, 20, 22, 23, 24].includes(
                  i
                )
                    ? "bg-white/80"
                    : "bg-white/[0.06]"
                  }`}
              />
            ))}
          </div>
          <p className="s10-label mt-3 font-mono text-xs text-text-muted sm:text-sm">QR Code</p>
          {/* Lock replaces QR */}
          <div className="s10-lock absolute">
            <svg
              viewBox="0 0 24 24"
              className="h-14 w-14 text-green-400 sm:h-16 sm:w-16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
        </div>
        <p className="s10-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          One scan to connect.
        </p>
        <p className="s10-sub text-base text-text-muted sm:text-lg">
          Encrypted. Peer-to-peer. No cloud. No open ports.
        </p>
      </div>

      {/* ===== Live desktop on phone ===== */}
      <div className="s-replica scene flex-col items-center gap-6">
        <div className="s-replica-phone relative flex h-[220px] w-[120px] flex-col overflow-hidden rounded-[22px] border border-white/[0.08] sm:h-[280px] sm:w-[150px]">
          {/* Video region */}
          <div className="s-replica-screen flex items-center justify-center bg-accent/10" style={{ flex: "0 0 45%" }}>
            <span className="font-mono text-[9px] text-accent-light/60">Screen</span>
          </div>
          {/* Separator with drag handle */}
          <div className="flex h-[6px] items-center justify-center bg-white/[0.02]">
            <div className="s-replica-line h-[4px] w-[40px] rounded-full bg-accent-light/40" />
          </div>
          {/* Chat region */}
          <div className="flex flex-1 flex-col bg-white/[0.03] px-2 pt-2">
            <div className="s-replica-line h-1 w-3/4 rounded-full bg-white/[0.08]" />
            <div className="s-replica-line mt-1.5 h-1 w-1/2 rounded-full bg-white/[0.06]" />
            <div className="s-replica-line mt-1.5 h-1 w-2/3 rounded-full bg-accent/20" />
            <div className="s-replica-line mt-1.5 h-1 w-1/3 rounded-full bg-white/[0.05]" />
          </div>
          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-white/[0.06]" />
        </div>
        <p className="s-replica-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          See your desktop. Live.
        </p>
        <p className="s-replica-sub text-base text-text-muted sm:text-lg">
          Pinch to zoom. Pan around. Full gesture control.
        </p>
      </div>

      {/* ===== 11: Your computer does the work ===== */}
      <div className="s11 scene flex-col gap-8">
        <svg viewBox="0 0 24 24" className="s11-icon h-14 w-14 text-accent-light sm:h-16 sm:w-16" fill="none" stroke="currentColor" strokeWidth={1}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <p className="s11-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Your computer does the work.
        </p>
        <p className="s11-sub text-base text-text-muted sm:text-lg">
          Runs on your machine. Full access to your apps, files, and tools.
        </p>
      </div>

      {/* ===== 12: Capabilities ===== */}
      <div className="s12 scene flex-col gap-6 px-6">
        <p className="s12-title text-xl font-medium text-text-primary sm:text-2xl">
          33 built-in tools. From terminal to browser.
        </p>
        <div className="max-w-lg space-y-3 text-base text-text-muted sm:text-lg">
          {[
            "Run commands. Read logs. Restart services.",
            "Open apps. Browse the web. Fill forms.",
            "Move windows. Resize layouts. Control any app.",
            "Read files. Edit documents. Download data.",
            "33 built-in capabilities. Extensible with custom skills.",
          ].map((line) => (
            <p key={line} className="s12-line">
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* ===== Any model. Your keys. ===== */}
      <div className="s-models scene flex-col gap-8">
        <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
          {[
            { name: "Gemini", logo: <svg width="20" height="20" viewBox="0 0 28 28" fill="none"><path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14Z" fill="#8B9CF7" /></svg> },
            { name: "OpenAI", logo: <svg width="20" height="20" viewBox="0 0 16 16" fill="#10A37F"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" /></svg> },
            { name: "Claude", logo: <svg width="20" height="20" viewBox="0 0 24 24" fill="#D4A27F"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" /></svg> },
            { name: "OpenRouter", logo: <svg width="20" height="20" viewBox="-10 20 530 460" fill="none"><path d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945" stroke="#F97316" strokeWidth="28" fill="none" strokeLinecap="round" /><path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" fill="#F97316" /><path d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377" stroke="#F97316" strokeWidth="28" fill="none" strokeLinecap="round" /><path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" fill="#F97316" /></svg> },
          ].map((m) => (
            <div key={m.name} className="s-models-name flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
              {m.logo}
              <span className="font-mono text-sm text-text-secondary sm:text-base">{m.name}</span>
            </div>
          ))}
        </div>
        <p className="s-models-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Any model. Your keys.
        </p>
        <p className="s-models-sub text-base text-text-muted sm:text-lg">
          4 providers. 20+ models. Switch anytime from your phone.
        </p>
      </div>

      {/* ===== Or your subscription ===== */}
      <div className="s-sub scene flex-col items-center gap-8">
        <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
          {[
            { name: "Claude Pro/Max", color: "text-[#D4A27F]" },
            { name: "Gemini Pro", color: "text-[#8B9CF7]" },
            { name: "ChatGPT Pro", color: "text-[#10A37F]" },
          ].map((s) => (
            <div key={s.name} className={`s-sub-badge flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5`}>
              <span className="flex items-center justify-center h-5 w-5 rounded bg-accent-light/20 font-mono text-[9px] font-bold text-accent-light">SUB</span>
              <span className={`font-mono text-sm sm:text-base ${s.color}`}>{s.name}</span>
            </div>
          ))}
        </div>
        <p className="s-sub-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Or your subscription. Zero API keys.
        </p>
        <div className="flex flex-col items-center gap-2 max-w-md text-center">
          <p className="s-sub-detail text-base text-text-muted sm:text-lg">
            Already paying for Claude, Gemini, or ChatGPT?
          </p>
          <p className="s-sub-detail text-base text-text-muted sm:text-lg">
            Contop routes through your existing CLI - no extra cost.
          </p>
        </div>
      </div>

      {/* ===== Extend with skills ===== */}
      <div className="s-skills scene flex-col gap-8 px-6">
        <div className="s-skills-file w-full max-w-xs rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="font-mono text-xs text-accent-light sm:text-sm">SKILL.md</p>
          <div className="mt-2">
            <span className="s-skills-typed whitespace-pre-wrap font-mono text-xs text-text-secondary sm:text-sm" />
          </div>
        </div>
        <p className="s-skills-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Extend with skills.
        </p>
        <p className="s-skills-sub text-base text-text-muted sm:text-lg">
          Drop a file. Teach your agent new workflows.
        </p>
      </div>

      {/* ===== Custom instructions ===== */}
      <div className="s-instruct scene flex-col gap-8 px-6">
        <div className="s-instruct-card w-full max-w-xs rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="text-[10px] uppercase tracking-widest text-text-muted">Custom Instructions</p>
          <div className="mt-3">
            <span className="s-instruct-typed whitespace-pre-wrap font-mono text-xs text-text-secondary sm:text-sm" />
          </div>
        </div>
        <p className="s-instruct-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Your rules. Built in.
        </p>
        <p className="s-instruct-sub text-base text-text-muted sm:text-lg">
          Shape how the agent behaves, right from your phone.
        </p>
      </div>

      {/* ===== 13: Security ===== */}
      <div className="s13 scene">
        <p className="px-6 text-center text-2xl font-medium tracking-tight sm:text-3xl lg:text-4xl">
          <span className="s13-main text-text-primary">Built with </span>
          <span className="s13-warn inline-block text-green-400">
            security first.
          </span>
        </p>
      </div>

      {/* ===== 14: Security features ===== */}
      <div className="s14 scene flex-col gap-8 px-6">
        {/* Approval card */}
        <div className="s14-card w-full max-w-sm rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-6">
          <p className="font-mono text-sm text-text-muted sm:text-base">
            <span className="text-amber-400">$</span>{" "}
            <span className="s14-cmd" />
          </p>
          <p className="mt-3 text-sm text-amber-400 sm:text-base">
            This could delete files. Allow?
          </p>
          <div className="mt-4 flex gap-3">
            <span className="s14-btn rounded-lg bg-amber-400/20 px-5 py-2.5 text-sm font-medium text-amber-400">
              Allow
            </span>
            <span className="s14-btn rounded-lg bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-text-muted">
              Deny
            </span>
          </div>
        </div>
      </div>

      {/* ===== Security details - animated ===== */}
      <div className="s-secure scene flex-col gap-5 px-6">
        <div className="flex max-w-sm flex-col gap-5">
          <div className="s-secure-item flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <p className="text-base text-text-secondary sm:text-lg">End-to-end encrypted. Peer-to-peer.</p>
          </div>
          <div className="s-secure-item flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p className="text-base text-text-secondary sm:text-lg">Direct connection. No cloud relay. No open ports.</p>
          </div>
          <div className="s-secure-item flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="2" y="7" width="7" height="14" rx="1.5" />
              <rect x="15" y="3" width="7" height="14" rx="1.5" />
              <path d="M9 14h6" />
            </svg>
            <p className="text-base text-text-secondary sm:text-lg">Nothing runs without device pairing first.</p>
          </div>
        </div>
      </div>

      {/* ===== Device Management ===== */}
      <div className="s-devices scene flex-col gap-8 px-6">
        {/* Device card */}
        <div className="s-devices-card w-full max-w-sm rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          {/* Device row */}
          <div className="flex items-center gap-3 mb-3">
            <div className="s-devices-dot h-2.5 w-2.5 rounded-full bg-green-500" />
            <div className="flex-1 min-w-0">
              <p className="s-devices-info font-mono text-sm text-text-primary sm:text-base">Alex&apos;s iPhone</p>
              <p className="s-devices-info font-mono text-[10px] text-green-400">Connected via Local Network</p>
            </div>
          </div>
          {/* Second device */}
          <div className="flex items-center gap-3 mb-3 opacity-50">
            <div className="h-2.5 w-2.5 rounded-full bg-text-muted/40" />
            <div className="flex-1 min-w-0">
              <p className="s-devices-info font-mono text-sm text-text-secondary sm:text-base">Work iPad</p>
              <p className="s-devices-info font-mono text-[10px] text-text-muted">Tunnel · San Francisco, US</p>
            </div>
          </div>
          {/* Alert toast */}
          <div className="s-devices-alert flex items-center gap-2 rounded-lg border border-green-400/20 bg-green-400/[0.05] px-3 py-2">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="font-mono text-[10px] text-green-400">Device Connected</span>
          </div>
        </div>

        <p className="s-devices-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Know who&apos;s connected.
        </p>
        <p className="s-devices-sub text-base text-text-muted sm:text-lg">
          Live status. Geo-location. Instant revocation.
        </p>
      </div>

      {/* ===== Away Mode - The problem ===== */}
      <div className="s-away scene flex-col gap-6 px-6">
        <div className="s-away-problem flex flex-col items-center gap-4">
          <svg viewBox="0 0 24 24" className="h-12 w-12 text-text-muted" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <p className="s-away-typed text-xl font-medium tracking-tight text-text-primary sm:text-2xl">&nbsp;</p>
          <svg className="s-away-warn h-8 w-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
      </div>

      {/* ===== Away Mode - Lock engages ===== */}
      <div className="s-away-lock scene flex-col gap-4">
        <div className="s-away-laptop relative flex flex-col items-center">
          <div className="s-away-screen relative flex h-48 w-72 items-center justify-center rounded-lg border border-border-subtle bg-surface-raised sm:h-56 sm:w-80">
            <div className="s-away-pin flex flex-col items-center gap-3">
              <svg className="s-away-lock-icon h-8 w-8 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <div className="flex gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-3 w-3 rounded-full border-2 border-text-muted" />
                ))}
              </div>
              <p className="text-xs text-text-muted">AWAY MODE</p>
            </div>
          </div>
          <div className="mt-1 h-2 w-32 rounded-b bg-border-subtle" />
        </div>
        <p className="text-lg font-medium text-text-primary sm:text-xl">Away Mode locks the screen.</p>
      </div>

      {/* ===== Away Mode - Split view ===== */}
      <div className="s-away-split scene flex-col gap-6">
        {/* Devices side by side - centered as a unit */}
        <div className="flex items-end justify-center gap-8 sm:gap-12">
          {/* Laptop - locked screen */}
          <div className="s-away-left flex flex-col items-center">
            <div className="relative flex h-[140px] w-[210px] items-center justify-center rounded-t-lg border border-b-0 border-white/[0.08] bg-black/90 sm:h-[170px] sm:w-[260px]">
              <div className="flex flex-col items-center gap-2 opacity-60">
                <svg className="h-6 w-6 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-2 w-2 rounded-full border border-white/20" />
                  ))}
                </div>
              </div>
            </div>
            {/* Laptop base */}
            <div className="h-[6px] w-[230px] rounded-b-md border border-t-0 border-white/[0.08] bg-white/[0.03] sm:w-[284px]" />
            <span className="mt-2 text-xs text-text-muted">Physical screen</span>
          </div>

          {/* Phone - live feed (matches s-replica style) */}
          <div className="s-away-right flex flex-col items-center">
            <div className="relative flex h-[180px] w-[90px] flex-col items-center justify-center rounded-[20px] border border-white/[0.08] sm:h-[210px] sm:w-[105px]">
              {/* Notch */}
              <div className="absolute top-2 h-1 w-8 rounded-full bg-white/[0.06]" />
              {/* Screen content */}
              <div className="flex h-[120px] w-[70px] items-center justify-center rounded-md bg-emerald-950/40 sm:h-[145px] sm:w-[82px]">
                <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
              <p className="mt-1.5 text-[9px] text-emerald-400">LIVE</p>
              {/* Home indicator */}
              <div className="absolute bottom-2 h-0.5 w-7 rounded-full bg-white/[0.06]" />
            </div>
            <span className="mt-2 text-xs text-text-muted">Your phone</span>
          </div>
        </div>

        <p className="s-away-caption text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          You keep watching. They see nothing.
        </p>

        <div className="flex flex-col gap-3">
          <div className="s-away-feat flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-sm text-text-secondary sm:text-base">Keyboard locked - only PIN keys work</p>
          </div>
          <div className="s-away-feat flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-green-400" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-sm text-text-secondary sm:text-base">Phone gets instant security alerts</p>
          </div>
        </div>
      </div>

      {/* ===== 15: Platforms ===== */}
      <div className="s15 scene flex-col gap-8">
        <p className="s15-title text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Works everywhere.
        </p>
        <div className="flex flex-wrap justify-center gap-8 sm:gap-12">
          {[
            { name: "Windows", icon: <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.851" /></svg> },
            { name: "macOS", icon: <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg> },
            { name: "Linux", icon: <svg viewBox="0 0 24 24" className="h-8 w-8 sm:h-9 sm:w-9" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 0 0-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 0 1-.004-.021l-.004-.024a1.807 1.807 0 0 1-.15.706.953.953 0 0 1-.213.335.71.71 0 0 0-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 0 0-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 0 0-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 0 0-.205.334 1.18 1.18 0 0 0-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 0 1-.018-.2v-.02a1.772 1.772 0 0 1 .15-.768 1.08 1.08 0 0 1 .43-.533.985.985 0 0 1 .594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 0 0-.166-.267.248.248 0 0 0-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 0 0-.12.27.944.944 0 0 0-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 0 1-.131.068 2.62 2.62 0 0 1-.275-.402 1.772 1.772 0 0 1-.155-.667 1.759 1.759 0 0 1 .08-.668 1.43 1.43 0 0 1 .283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 0 1 .016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 0 1-.448-.067 3.566 3.566 0 0 1-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 0 0-.402-.533 1.45 1.45 0 0 0-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 0 0 .314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 0 1 .647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 0 1-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" /></svg> },
            { name: "iOS (Soon)", icon: <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg> },
            { name: "Android", icon: <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="currentColor"><path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V7H6v11zM3.5 7C2.67 7 2 7.67 2 8.5v7c0 .83.67 1.5 1.5 1.5S5 16.33 5 15.5v-7C5 7.67 4.33 7 3.5 7zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0 0 12 0c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.98 5.98 0 0 0 6 6h12c0-1.65-.67-3.15-1.47-4.16zM10 4H9V3h1v1zm5 0h-1V3h1v1z" /></svg> },
          ].map((p) => (
            <div key={p.name} className="s15-platform flex flex-col items-center gap-2 text-text-muted">
              {p.icon}
              <span className="text-xs sm:text-sm">{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ===== Fully open source ===== */}
      <div className="s-open scene flex-col gap-8">
        <svg viewBox="0 0 16 16" className="s-open-icon h-14 w-14 text-text-primary sm:h-16 sm:w-16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <p className="s-open-text text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Fully open source.
        </p>
        <p className="s-open-sub text-base text-text-muted sm:text-lg">
          Inspect the code. Contribute. Build on top of it.
        </p>
      </div>

      {/* ===== 16: Four words ===== */}
      <div className="s16 scene flex-col gap-6">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:gap-x-8">
          {["Download.", "Launch.", "Scan.", "Talk."].map((word) => (
            <span
              key={word}
              className="s16-word text-2xl font-medium tracking-tight text-text-primary sm:text-4xl lg:text-5xl"
            >
              {word}
            </span>
          ))}
        </div>
        <p className="s16-sub font-mono text-sm text-text-muted">
          60 seconds to get started.
        </p>
      </div>

      {/* ===== 17: Logo reveal - mark appears, name types in ===== */}
      <div className="s17 scene flex-col gap-6">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Logo mark */}
          <svg viewBox="0 0 512 512" className="s17-mark h-14 w-14 text-accent-light sm:h-20 sm:w-20" fill="none" aria-hidden="true">
            <rect x="106" y="106" width="150" height="300" rx="14" stroke="currentColor" strokeWidth="36" fill="#000" />
            <rect x="166" y="256" width="240" height="150" rx="12" stroke="currentColor" strokeWidth="36" fill="#000" />
            <polyline points="226,298 270,331 226,364" stroke="currentColor" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <line x1="288" y1="364" x2="356" y2="364" stroke="currentColor" strokeWidth="28" strokeLinecap="round" />
          </svg>
          <span className="s17-name text-4xl font-bold tracking-tight text-text-primary sm:text-6xl" />
        </div>
        <p className="s17-tagline text-base text-text-muted sm:text-lg">
          Your desktop, from anywhere.
        </p>
      </div>
    </div>
  );
}
