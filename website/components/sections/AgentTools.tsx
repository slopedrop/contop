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
   Card header
   ------------------------------------------------ */
function CardHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="h-2 w-2 rounded-full bg-accent-light/60" />
      <span className="font-mono text-[10px] text-text-muted tracking-wider uppercase">
        {label}
      </span>
      <span className="font-mono text-[9px] text-text-muted/50 ml-auto">
        {sub}
      </span>
    </div>
  );
}

/* ------------------------------------------------
   Row 1, Card 1 — Terminal
   ------------------------------------------------ */
function TerminalCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Terminal" sub="Run Any Command" />

      {/* Terminal mockup */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="h-2 w-2 rounded-full bg-red-500/50" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/50" />
          <span className="h-2 w-2 rounded-full bg-green-500/50" />
        </div>
        <div className="font-mono text-[10px] leading-relaxed">
          <span className="text-text-muted">$</span>{" "}
          <span className="text-text-secondary">pip install requests</span>
          <br />
          <span className="text-accent-light">✓ Installed in 1.2s</span>
        </div>
      </div>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Run shell commands on your desktop just like you would in a terminal — install packages, run scripts, manage files.
      </p>

      {/* Safety features */}
      <div className="flex flex-col gap-1.5">
        {[
          { label: "Safety", detail: "Dangerous commands run in a Docker sandbox" },
          { label: "Privacy", detail: "Sensitive env vars like API keys are hidden" },
          { label: "Limits", detail: "Auto-stops stalled commands after 5 seconds" },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="shrink-0 font-mono text-[10px] text-accent-light w-[52px]">{r.label}</span>
            <span className="text-[11px] text-text-secondary">{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1, Card 2 — Screen Control
   ------------------------------------------------ */
function ScreenControlCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Screen Control" sub="See & Interact" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        The agent sees your screen, identifies every button and element, then clicks, types, and scrolls — just like a person would.
      </p>

      {/* How it works */}
      <div className="flex flex-col gap-1">
        {[
          { step: "1", text: "Takes a screenshot of your desktop" },
          { step: "2", text: "AI identifies all clickable elements" },
          { step: "3", text: "Performs the right action at the right spot" },
        ].map((s) => (
          <div key={s.step} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-accent/20 font-mono text-[10px] font-bold text-accent-light">
              {s.step}
            </span>
            <span className="text-[11px] text-text-secondary">{s.text}</span>
          </div>
        ))}
      </div>

      {/* Capabilities grid */}
      <div className="grid grid-cols-3 gap-1">
        {["Click", "Type", "Scroll", "Drag", "Hotkeys", "Select"].map((a) => (
          <div key={a} className="rounded bg-white/[0.02] border border-white/[0.04] px-1.5 py-1 text-center">
            <span className="font-mono text-[9px] text-text-secondary">{a}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">Also supports keyboard-only mode via accessibility tree</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1, Card 3 — Browser
   ------------------------------------------------ */
function BrowserCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Browser" sub="Navigate & Extract" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Controls Chrome directly — no screenshots needed. Navigates pages, fills forms, clicks buttons, and reads content efficiently.
      </p>

      {/* What it can do */}
      <div className="flex flex-col gap-1">
        {[
          { action: "Navigate to any URL", icon: "→" },
          { action: "Click buttons and links", icon: "◉" },
          { action: "Fill in forms and fields", icon: "✎" },
          { action: "Read page text content", icon: "≡" },
          { action: "Take page snapshots", icon: "◻" },
          { action: "Manage multiple tabs", icon: "▣" },
        ].map((r) => (
          <div key={r.action} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="font-mono text-[10px] text-accent-light shrink-0">{r.icon}</span>
            <span className="text-[11px] text-text-secondary">{r.action}</span>
          </div>
        ))}
      </div>

      {/* Efficiency callout */}
      <div className="rounded-md bg-cyan/[0.04] border border-cyan/10 px-3 py-2">
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Reads page text directly instead of taking screenshots — 10x more efficient for the AI.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2, Card 1 — Files & Documents
   ------------------------------------------------ */
function FilesCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Files" sub="Read · Edit · Search" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Works with any file on your machine — text, code, PDFs, images, and Excel spreadsheets.
      </p>

      <div className="flex flex-col gap-1">
        {[
          { type: "Text & Code", detail: "Read and edit with precision" },
          { type: "PDFs", detail: "Extract content as readable text" },
          { type: "Images", detail: "View and analyze screenshots" },
          { type: "Excel", detail: "Read sheets, write cells, merge ranges" },
          { type: "Search", detail: "Find files by name or content" },
        ].map((t) => (
          <div key={t.type} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="shrink-0 font-mono text-[10px] text-accent-light w-[72px]">{t.type}</span>
            <span className="text-[11px] text-text-secondary">{t.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">7 file tools available</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2, Card 2 — Windows & System
   ------------------------------------------------ */
function WindowCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Windows" sub="Cross-Platform" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Manage windows, read the clipboard, monitor processes, and download files — works the same on every platform.
      </p>

      {/* Capabilities */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { name: "Window Focus", detail: "Switch between apps" },
          { name: "Resize", detail: "Arrange your workspace" },
          { name: "Clipboard", detail: "Read and write content" },
          { name: "Downloads", detail: "Fetch files from URLs" },
        ].map((t) => (
          <div key={t.name} className="rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-1.5">
            <span className="block font-mono text-[10px] font-semibold text-text-primary">{t.name}</span>
            <span className="block text-[9px] text-text-muted leading-tight">{t.detail}</span>
          </div>
        ))}
      </div>

      {/* Platform support */}
      <div className="flex flex-col gap-1">
        {[
          { os: "Windows", status: "Native adapters" },
          { os: "macOS", status: "Native adapters" },
          { os: "Linux", status: "Native adapters" },
        ].map((p) => (
          <div key={p.os} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
            <span className="font-mono text-[10px] text-text-primary">{p.os}</span>
            <span className="font-mono text-[9px] text-text-muted ml-auto">{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2, Card 3 — Apps & Skills
   ------------------------------------------------ */
function AppsCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Apps & Skills" sub="Launch · Automate · Extend" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Launch and close apps, handle Save As and Open dialogs, and create reusable skills to automate repetitive workflows.
      </p>

      {/* App control */}
      <div className="flex flex-col gap-1">
        {[
          { action: "Launch any application", detail: "Waits until ready" },
          { action: "Close apps gracefully", detail: "Auto-saves if needed" },
          { action: "Handle file dialogs", detail: "Save As, Open, export" },
        ].map((r) => (
          <div key={r.action} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="text-[11px] text-text-secondary flex-1">{r.action}</span>
            <span className="font-mono text-[9px] text-text-muted">{r.detail}</span>
          </div>
        ))}
      </div>

      {/* Skills */}
      <div className="rounded-lg bg-purple/[0.04] border border-purple/10 p-3">
        <p className="font-mono text-[10px] font-semibold text-text-primary mb-1.5">Custom Skills</p>
        <p className="text-[11px] text-text-secondary leading-relaxed mb-2">
          Teach the agent new abilities by creating reusable skills — chain multiple steps into one command.
        </p>
        <div className="flex items-center gap-1.5">
          {["Prompt", "Workflow", "Python", "Mixed"].map((t) => (
            <span
              key={t}
              className="rounded-full bg-purple/10 border border-purple/20 px-2 py-0.5 font-mono text-[8px] text-purple"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Icons
   ================================================ */
function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PuzzleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  );
}

/* ================================================
   Description cards data
   ================================================ */
const descriptions = [
  {
    icon: <TerminalIcon />,
    category: "EXECUTION",
    title: "Three ways to control your desktop",
    desc: "Run terminal commands, automate GUI interactions by seeing your screen, or control Chrome directly — the agent picks the best approach for each task.",
  },
  {
    icon: <FolderIcon />,
    category: "OPERATIONS",
    title: "Works with any file, any platform",
    desc: "Read and edit code, PDFs, images, and spreadsheets. Manage windows and monitor your system. Same experience on Windows, macOS, and Linux.",
  },
  {
    icon: <PuzzleIcon />,
    category: "EXTENSIBILITY",
    title: "Teach it new tricks",
    desc: "Create custom skills to automate your unique workflows. Chain actions together, save them once, and reuse them forever — no coding required.",
  },
];

/* ================================================
   Main section
   ================================================ */
export default function AgentTools() {
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
          Agent &amp; Automation
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          33 built-in tools that let the agent run commands, control your screen, manage files, and automate entire workflows.
        </p>
      </FadeUp>

      {/* Architecture diagram */}
      <div
        role="img"
        aria-label="Agent automation tools: Row 1 shows terminal command execution, screen control with AI vision, and browser automation. Row 2 shows file and document handling, cross-platform window management, and app launching with custom skills."
      >
        {/* Row 1: Execution tools — 3 cards */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <TerminalCard />
              <ScreenControlCard />
              <BrowserCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: Support tools — 3 cards */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <FilesCard />
              <WindowCard />
              <AppsCard />
            </div>
          </div>
        </FadeUp>
      </div>

      {/* Description cards */}
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
    </div>
  );
}
