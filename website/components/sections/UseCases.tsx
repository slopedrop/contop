"use client";

import { useEffect, useRef, useState } from "react";

const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function FadeUp({
  visible,
  delay,
  children,
  className = "",
}: {
  visible: boolean;
  delay: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.6s ${EASING}, transform 0.6s ${EASING}`,
        transitionDelay: `${delay}ms`,
        willChange: visible ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="h-2 w-2 rounded-full bg-accent-light/60" />
      <span className="font-mono text-[10px] text-text-secondary tracking-wider uppercase">
        {label}
      </span>
      <span className="font-mono text-[9px] text-text-muted/50 ml-auto">
        {sub}
      </span>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-block rounded-full bg-accent/20 border border-accent/30 px-2.5 py-0.5 font-mono text-[9px] text-accent-light tracking-wide">
      {label}
    </span>
  );
}

function VoiceBars() {
  return (
    <div className="flex items-end gap-0.5 h-3">
      {[0.6, 1, 0.4, 0.8].map((scale, i) => (
        <div
          key={i}
          className="w-0.5 rounded-full bg-accent-light"
          style={{
            height: `${scale * 100}%`,
            animation: `voice-bar 1.2s ease-in-out ${i * 0.15}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes voice-bar {
          0% { transform: scaleY(0.4); }
          100% { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes voice-bar { 0%, 100% { transform: scaleY(1); } }
        }
      `}</style>
    </div>
  );
}

function AnimDots() {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-accent-light/60"
          style={{ animation: `dot-pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`
        @keyframes dot-pulse {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes dot-pulse { 0%, 100% { opacity: 1; } }
        }
      `}</style>
    </span>
  );
}

/* ================================================
   Journey 1: Alex - Production Outage
   ================================================ */
function AlexJourney() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
      {/* LEFT - Visual mockups */}
      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <CardHeader label="Production Outage" sub="Voice → CLI" />

        {/* Phone voice bubble */}
        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light/60">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
            <VoiceBars />
            <span className="font-mono text-[9px] text-text-muted ml-auto">Voice Input</span>
          </div>
          <div className="rounded bg-white/[0.04] border border-white/[0.06] px-3 py-2">
            <div className="font-mono text-[10px] text-text-secondary leading-relaxed">
              &ldquo;Check the production logs for user-auth. If it&apos;s stalled, restart it.&rdquo;
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <AnimDots />
              <span className="font-mono text-[8px] text-text-muted">Processing</span>
            </div>
          </div>
        </div>

        {/* Terminal */}
        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
          <div className="rounded bg-black/60 border border-white/[0.03] p-2 font-mono text-[10px] leading-relaxed">
            <div className="text-text-muted">$ docker logs user-auth --tail 20</div>
            <div className="text-red-400 mt-0.5">ERROR: health check timeout</div>
            <div className="text-text-muted mt-1">$ docker restart user-auth</div>
            <div className="text-green-400 mt-0.5">Up 3 seconds (healthy)<span className="terminal-cursor" /></div>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="font-mono text-[9px] text-green-400">Resolved in 47s</span>
          </div>
        </div>
      </div>

      {/* RIGHT - Narrative */}
      <div className="flex flex-col justify-center gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-accent/20 border border-accent/30 font-mono text-[11px] font-bold text-accent-light">
            A
          </div>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Alex - Backend Engineer</div>
            <div className="font-mono text-[10px] text-text-muted">On a train · PagerDuty alert firing</div>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-text-secondary">
          PagerDuty fires while Alex is on the train. He opens Contop, speaks one command, and the
          agent checks the logs, finds the stalled container, and restarts it. Outage resolved in
          under a minute - no laptop needed.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Pill label="WebRTC Tunnel" />
          <Pill label="Voice Input" />
          <Pill label="CLI Execution" />
          <Pill label="Real-Time Video" />
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Journey 2: Sarah - Sandbox Safety
   ================================================ */
function SarahJourney() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
      {/* LEFT - Classification flow */}
      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <CardHeader label="Security Boundary" sub="Command Gate" />

        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3 flex flex-col gap-2">
          {/* Command */}
          <div className="rounded bg-white/[0.04] border border-white/[0.06] px-3 py-2">
            <div className="font-mono text-[10px] text-text-secondary">
              &ldquo;Run render-final.sh, but first delete old temp files in root directory&rdquo;
            </div>
          </div>

          {/* Arrow + gate */}
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="font-mono text-[9px] text-text-muted">Security Gate</span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {/* Blocked */}
          <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-1.5 flex items-center gap-2">
            <span className="rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 font-mono text-[9px] text-red-400 font-bold">
              BLOCKED
            </span>
            <span className="font-mono text-[9px] text-red-300">Root directory deletion</span>
          </div>

          {/* Confirmation */}
          <div className="rounded bg-white/[0.04] border border-accent/20 px-3 py-2">
            <div className="font-mono text-[10px] text-text-secondary">
              &ldquo;Proceed with render only?&rdquo;
            </div>
            <div className="flex gap-2 mt-1.5">
              <div className="rounded bg-green-500/20 border border-green-500/30 px-3 py-0.5 font-mono text-[9px] text-green-400 font-semibold">
                Yes
              </div>
              <div className="rounded bg-white/[0.04] border border-white/[0.06] px-3 py-0.5 font-mono text-[9px] text-text-muted">
                No
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT - Narrative */}
      <div className="flex flex-col justify-center gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-purple/20 border border-purple/30 font-mono text-[11px] font-bold text-purple">
            S
          </div>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Sarah - Motion Designer</div>
            <div className="font-mono text-[10px] text-text-muted">Coffee shop · 4K render deadline</div>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-text-secondary">
          Sarah asks Contop to run her render script and casually adds &ldquo;delete temp files in
          root.&rdquo; The security gate blocks the dangerous part, asks her phone to confirm,
          and kicks off just the render. System stays safe.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Pill label="DualToolEvaluator" />
          <Pill label="Sandbox" />
          <Pill label="User Confirmation" />
          <Pill label="Restricted Paths" />
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Journey 3: Marcus - GUI Automation
   ================================================ */
function MarcusJourney() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
      {/* LEFT - Desktop GUI overlay */}
      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <CardHeader label="GUI Automation" sub="Visual Navigation" />

        {/* Blender mockup with error dialog */}
        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted">
              <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
              <line x1="2" y1="7" x2="22" y2="7" />
            </svg>
            <span className="font-mono text-[9px] text-text-muted">Blender 4.1</span>
            <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse ml-auto" />
          </div>
          <div className="rounded bg-black/60 border border-white/[0.03] p-2 font-mono text-[8px] flex flex-col gap-1">
            {/* Render progress */}
            <div className="flex items-center gap-2 text-text-muted/50">
              <span>Render</span>
              <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full w-[72%] rounded-full bg-accent-light/40" />
              </div>
              <span>72%</span>
            </div>
            {/* Error dialog overlay */}
            <div className="rounded border border-dashed border-accent-light/50 bg-accent/10 px-2 py-1.5 mt-1">
              <div className="text-red-400 font-semibold mb-0.5">GPU Memory Error</div>
              <div className="text-text-muted/60">CUDA out of memory - tile size too large</div>
              <div className="flex gap-1.5 mt-1">
                <span className="rounded bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-text-secondary">Retry</span>
                <span className="rounded bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-text-muted/40">Cancel</span>
              </div>
            </div>
          </div>
        </div>

        {/* Voice command */}
        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan/60">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
            <VoiceBars />
            <span className="font-mono text-[9px] text-text-muted ml-auto">Voice Command</span>
          </div>
          <div className="rounded bg-white/[0.04] border border-white/[0.06] px-3 py-1.5 font-mono text-[10px] text-text-secondary">
            &ldquo;Lower the tile size in render settings and hit retry&rdquo;
          </div>
        </div>
      </div>

      {/* RIGHT - Narrative */}
      <div className="flex flex-col justify-center gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-cyan/20 border border-cyan/30 font-mono text-[11px] font-bold text-cyan">
            M
          </div>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Marcus - 3D Artist</div>
            <div className="font-mono text-[10px] text-text-muted">Dinner out · Blender render running at home</div>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-text-secondary">
          Marcus left a Blender render running on his workstation. At dinner, his phone
          shows a GPU memory error dialog blocking the process. He tells Contop to lower the tile
          size and hit retry - the agent navigates Blender&apos;s UI visually, clicks through
          the settings, and the render resumes.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Pill label="GUI Automation" />
          <Pill label="Visual Stream" />
          <Pill label="Desktop Apps" />
          <Pill label="No CLI Needed" />
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Description card icons
   ================================================ */
function ZapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const descriptions = [
  {
    icon: <ZapIcon />,
    category: "RESPONSE TIME",
    title: "Instant Response",
    desc: "Resolve critical issues in seconds, not minutes. Voice-to-action from any location.",
  },
  {
    icon: <ShieldIcon />,
    category: "SAFETY",
    title: "Safety by Design",
    desc: "Dangerous actions are caught, sandboxed, and confirmed before execution.",
  },
  {
    icon: <UsersIcon />,
    category: "SUPPORT",
    title: "Zero Walkthrough",
    desc: "Remote support without asking users to follow complex steps.",
  },
];

/* ================================================
   Main section
   ================================================ */
export default function UseCases() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.08 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sectionRef} className="mx-auto max-w-5xl">
      {/* Header */}
      <FadeUp visible={visible} delay={0} className="mb-4 text-center">
        <h2 className="text-3xl font-bold tracking-[-0.02em] text-text-primary">
          Use Cases
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          Real people, real problems, solved in seconds.
        </p>
      </FadeUp>

      <div
        role="img"
        aria-label="Three user journey stories: Alex resolves a production outage from his phone, Sarah's dangerous command is caught by the security gate, Marcus fixes a stalled Blender render via GUI automation."
      >
        {/* Journey 1 - Alex */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <AlexJourney />
          </div>
        </FadeUp>

        {/* Journey 2 - Sarah */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <SarahJourney />
          </div>
        </FadeUp>

        {/* Journey 3 - Marcus */}
        <FadeUp visible={visible} delay={400} className="mb-3">
          <div className="arch-container">
            <MarcusJourney />
          </div>
        </FadeUp>
      </div>

      {/* Description cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {descriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={550 + i * 80}>
            <div className="arch-stage-card h-full">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-accent-light/70">{d.icon}</span>
                <span className="font-mono text-[10px] tracking-wider uppercase text-text-secondary">
                  {d.category}
                </span>
              </div>
              <h3 className="text-[15px] font-semibold leading-snug text-text-primary mb-2">
                {d.title}
              </h3>
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {d.desc}
              </p>
            </div>
          </FadeUp>
        ))}
      </div>
    </div>
  );
}
