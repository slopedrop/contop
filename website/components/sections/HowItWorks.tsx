"use client";

import { useEffect, useRef, useState } from "react";

const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

/* ------------------------------------------------
   Transition helper
   ------------------------------------------------ */
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

/* ------------------------------------------------
   Card 1 - Speak or Type
   ------------------------------------------------ */
function InputCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Your Phone" sub="Voice or Text" />

      <div className="flex flex-col gap-2.5">
        {/* Voice waveform */}
        <div className="flex items-center gap-2 self-start">
          <div className="flex items-end gap-[2px]">
            {[1, 1.5, 2.5, 2, 3, 1.5, 2, 1].map((h, i) => (
              <span
                key={i}
                className="inline-block w-[3px] rounded-full bg-accent-light"
                style={{
                  height: `${h * 5}px`,
                  opacity: 0.4 + (h / 3) * 0.6,
                  animation: "pulse 1.5s ease-in-out infinite",
                  animationDelay: `${i * 100}ms`,
                }}
              />
            ))}
          </div>
          <span className="font-mono text-[9px] text-text-muted">Voice Input</span>
        </div>

        {/* Example commands */}
        <ChatBubble text="Open Chrome and search for flights to Tokyo" variant="user" />
        <ChatBubble text="Take a screenshot and summarize what you see" variant="alt" />
      </div>

      <p className="text-[10px] text-text-muted leading-relaxed">
        Speak naturally or type - your phone understands what you want to do on your desktop.
      </p>
    </div>
  );
}

/* ------------------------------------------------
   Card 2 - AI Understands Your Intent
   ------------------------------------------------ */
function IntentCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="On-Device AI" sub="Understands Intent" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        An AI model running on your phone interprets what you said and figures out if it&apos;s a simple question or a task that needs your desktop.
      </p>

      {/* Decision flow */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
          <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-accent/20 font-mono text-[10px] font-bold text-accent-light">1</span>
          <span className="text-[11px] text-text-secondary">Transcribes your voice to text</span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
          <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-accent/20 font-mono text-[10px] font-bold text-accent-light">2</span>
          <span className="text-[11px] text-text-secondary">Classifies: chat reply or desktop action?</span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
          <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-accent/20 font-mono text-[10px] font-bold text-accent-light">3</span>
          <span className="text-[11px] text-text-secondary">Sends command to your desktop</span>
          <AnimDots />
        </div>
      </div>

      <p className="text-[10px] text-text-muted leading-relaxed">
        Simple questions are answered instantly on the phone - only desktop tasks get sent over.
      </p>
    </div>
  );
}

/* ------------------------------------------------
   Card 3 - Encrypted Connection
   ------------------------------------------------ */
function TunnelCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Encrypted Tunnel" sub="Phone → Desktop" />

      {/* Connection status */}
      <div className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2">
          <LockIcon />
          <span className="text-[11px] text-text-secondary">End-to-end encrypted</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500/80" />
          <span className="font-mono text-[9px] text-green-500/80">Connected</span>
        </div>
      </div>

      {/* Connection paths */}
      <div className="flex flex-col gap-1">
        {[
          { path: "Same Wi-Fi", desc: "Fastest, direct connection", active: true },
          { path: "Tailscale VPN", desc: "Secure mesh, any network", active: false },
          { path: "Cloud Tunnel", desc: "Works from anywhere", active: false },
        ].map((r) => (
          <div key={r.path} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${r.active ? "bg-green-500/70" : "bg-white/10"}`} />
            <span className={`text-[11px] flex-1 ${r.active ? "text-text-primary" : "text-text-muted"}`}>{r.path}</span>
            <span className="text-[10px] text-text-muted">{r.desc}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-text-muted leading-relaxed">
        Automatically picks the fastest available path. Your data never passes through third-party servers.
      </p>
    </div>
  );
}

/* ------------------------------------------------
   Card 4 - Safety Check
   ------------------------------------------------ */
function SecurityCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Safety Check" sub="Every Action Reviewed" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Before any action runs on your desktop, it&apos;s automatically evaluated for safety.
      </p>

      {/* Classification examples */}
      <div className="flex flex-col gap-1">
        {[
          { action: "Open VS Code", route: "safe", color: "green" },
          { action: "Run npm test", route: "safe", color: "green" },
          { action: "Delete system files", route: "blocked", color: "red" },
          { action: "Run unknown script", route: "sandboxed", color: "amber" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="text-[11px] text-text-secondary flex-1">{r.action}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${r.color === "green" ? "bg-green-500/10 text-green-400/80" :
                r.color === "red" ? "bg-red-500/10 text-red-400/80" :
                  "bg-amber-500/10 text-amber-400/80"
              }`}>
              {r.route}
            </span>
          </div>
        ))}
      </div>

      {/* Sandbox note */}
      <div className="rounded-lg bg-amber-500/[0.04] border border-amber-500/10 p-3">
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Risky commands run in an isolated sandbox - no access to your files, network, or system.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Card 5 - AI Agent Executes
   ------------------------------------------------ */
function AgentCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="AI Agent" sub="Autonomous Execution" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        An AI agent on your desktop breaks down your request into steps and executes them autonomously.
      </p>

      {/* Execution trace */}
      <div className="flex flex-col gap-1">
        {[
          { step: "Opens Chrome", s: "done" as const },
          { step: "Searches \"flights to Tokyo\"", s: "done" as const },
          { step: "Reads the screen to find results", s: "done" as const },
          { step: "Clicks on the best option", s: "running" as const },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${step.s === "running" ? "bg-accent-light animate-pulse" : "bg-green-500/70"}`} />
            <span className="text-[11px] text-text-secondary">{step.step}</span>
          </div>
        ))}
      </div>

      {/* Progress update */}
      <div className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
        <AnimDots />
        <span className="text-[11px] text-text-secondary">
          Sending progress updates to your phone
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Card 6 - Your Desktop
   ------------------------------------------------ */
function HostCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Your Desktop" sub="Windows · macOS · Linux" />

      {/* Capabilities grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { name: "Terminal", detail: "Run any command" },
          { name: "GUI Control", detail: "Click, type, scroll" },
          { name: "Browser", detail: "Navigate & interact" },
          { name: "Accessibility", detail: "Native UI controls" },
          { name: "File System", detail: "Read, edit, find" },
          { name: "Sandbox", detail: "Isolated environment" },
        ].map((t) => (
          <div key={t.name} className="rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-1.5">
            <span className="block font-mono text-[10px] font-semibold text-text-primary">{t.name}</span>
            <span className="block text-[9px] text-text-muted leading-tight">{t.detail}</span>
          </div>
        ))}
      </div>

      {/* Terminal mockup */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="h-2 w-2 rounded-full bg-red-500/50" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/50" />
          <span className="h-2 w-2 rounded-full bg-green-500/50" />
        </div>
        <div className="font-mono text-[10px] leading-relaxed">
          <span className="text-text-muted">$</span>{" "}
          <span className="text-text-secondary">Opening Chrome...</span>
          <br />
          <span className="text-text-muted">$</span>{" "}
          <span className="text-text-secondary">Searching &quot;flights to Tokyo&quot;</span>
          <br />
          <span className="text-text-muted">$</span>{" "}
          <span className="text-accent-light">Reading screen... 14 elements found</span>
          <span className="terminal-cursor">▌</span>
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Description cards
   ================================================ */
const descriptions = [
  {
    icon: <PhoneIcon />,
    category: "Your Phone",
    title: "Speak naturally, AI understands",
    desc: "Speak or type naturally on your phone. The on-device AI figures out what you need and whether it requires your desktop.",
  },
  {
    icon: <LockIcon />,
    category: "The Bridge",
    title: "Encrypted, direct, no cloud",
    desc: "Your commands travel directly from phone to desktop through an encrypted tunnel. Nothing is stored or routed through third-party servers.",
  },
  {
    icon: <CpuIcon />,
    category: "Your Desktop",
    title: "AI does the work for you",
    desc: "An autonomous agent takes over your desktop - opening apps, clicking buttons, running commands - while keeping you updated every step of the way.",
  },
];

/* ================================================
   Main section
   ================================================ */
export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
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
    <div
      ref={containerRef}
      className="mx-auto max-w-5xl"
    >
      {/* Header */}
      <FadeUp visible={visible} delay={0} className="mb-4 text-center">
        <h2 className="text-3xl font-bold tracking-[-0.02em] text-text-primary">
          How It Works
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          You speak, your phone understands, your desktop executes - all in one seamless flow.
        </p>
      </FadeUp>

      {/* Architecture diagram - role="img" scoped to visual-only content */}
      <div
        role="img"
        aria-label="How Contop works: Your phone captures voice or text input, AI classifies your intent, an encrypted tunnel sends commands to your desktop, a safety check reviews every action, an AI agent executes tasks autonomously, and your desktop carries out the work."
      >
        {/* Row 1: Phone side - 3 cards */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <InputCard />
              <IntentCard />
              <TunnelCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: Desktop side - 3 cards */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <SecurityCard />
              <AgentCard />
              <HostCard />
            </div>
          </div>
        </FadeUp>
      </div>

      {/* Description cards - outside role="img" so text is screen-reader accessible */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {descriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={400 + i * 80}>
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

      {/* Link to full explainer page */}
      <FadeUp visible={visible} delay={650} className="mt-8 text-center">
        <a
          href="/how-it-works"
          className="inline-flex items-center gap-2 text-sm text-text-secondary transition-colors duration-200 hover:text-accent-light"
        >
          See the animated explainer
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </a>
      </FadeUp>
    </div>
  );
}

/* ================================================
   Shared primitives
   ================================================ */

function CardHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="h-2 w-2 rounded-full bg-accent-light/60" />
      <span className="font-mono text-[10px] text-text-muted tracking-wider uppercase">{label}</span>
      <span className="font-mono text-[9px] text-text-muted/50 ml-auto">{sub}</span>
    </div>
  );
}

function ChatBubble({ text, variant }: { text: string; variant: "user" | "alt" }) {
  const cls =
    variant === "user"
      ? "bg-accent/20 border border-accent/20"
      : "bg-white/[0.03] border border-white/[0.06]";
  return (
    <div className={`self-end rounded-xl rounded-br-sm px-3.5 py-2 max-w-[90%] ${cls}`}>
      <p className="text-[11px] text-text-primary leading-relaxed">{text}</p>
    </div>
  );
}

function AnimDots() {
  return (
    <div className="flex items-center gap-[3px] shrink-0">
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className="inline-block h-1 w-1 rounded-full bg-accent-light animate-pulse"
          style={{ animationDelay: `${d * 200}ms` }}
        />
      ))}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <line x1="12" y1="18" x2="12" y2="18.01" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M12 3a4 4 0 0 0-4 4v4h8V7a4 4 0 0 0-4-4z" />
    </svg>
  );
}

function CpuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="1" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="23" />
    </svg>
  );
}
