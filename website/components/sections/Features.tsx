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
   Shared primitives
   ------------------------------------------------ */

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

/* ------------------------------------------------
   Phone mockup shells
   ------------------------------------------------ */

function PhonePortrait({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-[120px] rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      {/* Status bar */}
      <div className="h-3 border-b border-white/[0.06] flex items-center justify-center">
        <div className="w-8 h-[2px] rounded-full bg-white/[0.12]" />
      </div>
      {/* Screen content */}
      <div className="h-[180px] flex flex-col">{children}</div>
    </div>
  );
}

function PhoneLandscape({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[220px] rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="h-[100px] flex flex-row">{children}</div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1 Card 1 — Split View
   ------------------------------------------------ */
function SplitViewCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Split View" sub="Default Mode" />

      <PhonePortrait>
        {/* Video region */}
        <div
          className="bg-accent/10 flex items-center justify-center"
          style={{ flex: "0 0 45%" }}
        >
          <span className="font-mono text-[9px] text-accent-light/60">
            Screen
          </span>
        </div>
        {/* Separator */}
        <div className="flex items-center justify-center h-[6px] bg-white/[0.02]">
          <div className="w-[40px] h-[4px] rounded-full bg-accent-light/40" />
        </div>
        {/* Thread region */}
        <div className="flex-1 bg-white/[0.03] flex items-center justify-center">
          <span className="font-mono text-[9px] text-text-muted/60">
            Chat
          </span>
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        See your desktop screen and conversation side by side. Drag the separator to resize — anywhere from 30% to 70%.
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for monitoring tasks as they run
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1 Card 2 — Video Focus
   ------------------------------------------------ */
function VideoFocusCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Video Focus" sub="Watch Mode" />

      <PhonePortrait>
        {/* Full-screen video */}
        <div className="flex-1 bg-accent/10 flex items-center justify-center relative">
          <span className="font-mono text-[9px] text-accent-light/60">
            Full Screen
          </span>
          {/* Floating chat overlay */}
          <div className="absolute bottom-2 right-2 left-2 h-[30px] rounded-md border border-white/[0.08] bg-white/[0.04] flex items-center justify-center">
            <span className="font-mono text-[7px] text-text-muted/60">
              chat overlay
            </span>
          </div>
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Maximize your desktop view. The chat floats on top as a transparent overlay — tap through it to keep watching.
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for watching the agent work
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1 Card 3 — Thread Focus
   ------------------------------------------------ */
function ThreadFocusCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Thread Focus" sub="Read Mode" />

      <PhonePortrait>
        {/* Mini video card at top */}
        <div className="h-[40px] bg-accent/10 border-b border-accent-light/30 flex items-center justify-center shrink-0">
          <span className="font-mono text-[7px] text-accent-light/60">
            mini screen
          </span>
        </div>
        {/* Full thread */}
        <div className="flex-1 bg-white/[0.03] flex items-center justify-center">
          <span className="font-mono text-[9px] text-text-muted/60">
            Full Chat
          </span>
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Focus on the conversation. A small video preview stays pinned at the top so you never lose sight of your desktop.
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for reading detailed results
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2 Card 1 — Side-by-Side
   ------------------------------------------------ */
function SideBySideCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Side-by-Side" sub="Landscape Mode" />

      <PhoneLandscape>
        {/* Video */}
        <div
          className="bg-accent/10 flex items-center justify-center"
          style={{ flex: "0 0 55%" }}
        >
          <span className="font-mono text-[8px] text-accent-light/60">
            Screen
          </span>
        </div>
        {/* Vertical separator */}
        <div className="flex items-center justify-center w-[6px] bg-white/[0.02]">
          <div className="w-[4px] h-[40px] rounded-full bg-accent-light/40" />
        </div>
        {/* Thread */}
        <div className="flex-1 bg-white/[0.03] flex items-center justify-center">
          <span className="font-mono text-[8px] text-text-muted/60">
            Chat
          </span>
        </div>
      </PhoneLandscape>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Rotate your phone and get a widescreen view. Desktop screen on the left, conversation on the right — plus a fullscreen video option for dedicated monitoring.
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for extended work sessions
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2 Card 2 — Fullscreen Video
   ------------------------------------------------ */
function FullscreenVideoCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Fullscreen Video" sub="Landscape Mode" />

      <PhoneLandscape>
        {/* Full-screen video */}
        <div className="flex-1 bg-accent/10 flex items-center justify-center relative">
          <span className="font-mono text-[8px] text-accent-light/60">
            Full Screen
          </span>
          {/* Floating controls */}
          <div className="absolute bottom-1.5 right-2 flex items-center gap-1">
            <div className="h-[14px] w-[14px] rounded-sm border border-white/[0.08] bg-white/[0.04]" />
            <div className="h-[14px] w-[14px] rounded-sm border border-white/[0.08] bg-white/[0.04]" />
          </div>
        </div>
      </PhoneLandscape>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Dedicate your entire screen to watching your desktop. Minimal floating controls stay out of the way. Perfect for long-running tasks where you just need to keep an eye on things.
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for dedicated desktop monitoring
        </span>
      </div>
    </div>
  );
}

/* ================================================
   Description cards
   ================================================ */
const descriptions = [
  {
    icon: <LayoutIcon />,
    category: "LAYOUTS",
    title: "5 Modes for Every Use Case",
    desc: "Split View for balanced monitoring, Video Focus for watching the agent work, Thread Focus for reading results, Side-by-Side for landscape multitasking, and Fullscreen Video for dedicated desktop viewing.",
  },
  {
    icon: <RotateIcon />,
    category: "ORIENTATION",
    title: "Smart Rotation",
    desc: "Rotate your phone and the layout adapts instantly. Set your preferred mode for portrait and landscape — Contop remembers your choices across sessions.",
  },
  {
    icon: <GestureIcon />,
    category: "INTERACTION",
    title: "Drag to Resize",
    desc: "Resize the screen and chat panels by dragging the separator. Works horizontally in portrait and vertically in landscape. Constrained so neither panel gets too small.",
  },
];

/* ================================================
   Story 3.2 — Model & Backend Selection cards
   ================================================ */

function RolePicker({
  label,
  desc,
  value,
  active,
}: {
  label: string;
  desc: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="px-2 py-1.5">
      <div className="font-mono text-[7px] text-text-muted/70 mb-0.5">
        {label}
      </div>
      <div className="font-mono text-[6px] text-text-muted/40 mb-0.5 leading-tight">
        {desc}
      </div>
      <div
        className={`flex items-center justify-between rounded px-1.5 py-1 text-[7px] font-mono border ${
          active
            ? "bg-accent/10 border-accent-light/30 text-accent-light/80"
            : "bg-white/[0.03] border-white/[0.08] text-text-secondary/70"
        }`}
      >
        <span>{value}</span>
        <span className="text-[6px] text-text-muted/50">▾</span>
      </div>
    </div>
  );
}

function AIRolesCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="AI ROLES" sub="Independent · Per-Task" />

      {/* Phone settings mockup */}
      <div className="mx-auto w-[120px] rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        {/* Status bar */}
        <div className="h-3 border-b border-white/[0.06] flex items-center justify-center">
          <div className="w-8 h-[2px] rounded-full bg-white/[0.12]" />
        </div>
        {/* Screen */}
        <div className="py-1">
          <RolePicker label="Conversation" desc="Powers chat and voice" value="Flash" active />
          <RolePicker label="Execution" desc="Drives agent decisions" value="Flash" />
          <RolePicker label="Screen Interaction" desc="Sees and controls screen" value="Local" />
        </div>
      </div>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Configure each AI role independently from your phone — no server
        restart needed
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for tailoring AI behavior to your specific workflow
        </span>
      </div>
    </div>
  );
}

function BackendTile({
  name,
  tag,
  desc,
}: {
  name: string;
  tag: string;
  desc: string;
}) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="font-mono text-[10px] font-medium text-text-primary/90">
          {name}
        </span>
        <span className="font-mono text-[8px] text-accent-light/50">
          {tag}
        </span>
      </div>
      <p className="font-mono text-[9px] text-text-muted/70 leading-snug">
        {desc}
      </p>
    </div>
  );
}

function ComputerUseBackendsCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="SCREEN INTERACTION" sub="9 Backends · Your Choice" />

      <div className="flex flex-col gap-1.5">
        <BackendTile
          name="Local Vision"
          tag="OmniParser"
          desc="Runs on your machine · Works offline"
        />
        <BackendTile
          name="Cloud Vision"
          tag="UI-TARS + 5 more"
          desc="Kimi · Qwen · Phi · Molmo · Holotron"
        />
        <BackendTile
          name="Native AI Vision"
          tag="Gemini CU"
          desc="Google's built-in · Autonomous multi-step"
        />
        <BackendTile
          name="Keyboard First"
          tag="Accessibility"
          desc="Text-based · No screenshots needed"
        />
      </div>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Nine vision backends from local to cloud — choose by privacy,
        speed, or model preference
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for matching your privacy and performance priorities
        </span>
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  models,
  highlight,
}: {
  provider: string;
  models: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md px-3 py-2 border ${
        highlight
          ? "bg-accent/10 border-accent-light/30"
          : "bg-white/[0.03] border-white/[0.08]"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="font-mono text-[10px] font-medium text-text-primary/90">
          {provider}
        </span>
        {highlight && (
          <span className="font-mono text-[7px] text-accent-light/60 bg-accent/20 px-1 rounded">
            DEFAULT
          </span>
        )}
      </div>
      <p className="font-mono text-[9px] text-text-muted/70 leading-snug">
        {models}
      </p>
    </div>
  );
}

function ModelSelectionCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="MODELS" sub="Multi-Provider · Your Keys" />

      <div className="flex flex-col gap-1.5">
        <ProviderRow
          provider="Gemini"
          models="3.1 Pro · 3 Flash · 2.5 Pro · 2.5 Flash"
        />
        <ProviderRow
          provider="OpenAI"
          models="GPT-5.4 · GPT-4.1 · o3 · o4 Mini"
        />
        <ProviderRow
          provider="Anthropic"
          models="Claude Opus 4.6 · Sonnet 4.6 · Haiku 4.5"
        />
        <ProviderRow
          provider="OpenRouter"
          models="Grok · Devstral · Qwen · Nemotron · 300+"
        />
      </div>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Bring your own API keys — use any provider for conversation or execution
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for choosing the right model per task and budget
        </span>
      </div>
    </div>
  );
}

/* ================================================
   Story 3.3 — Chat UI, Sessions & Device Control cards
   ================================================ */

function LiveExecutionThreadCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="LIVE THREAD" sub="Real-Time Updates" />

      <PhonePortrait>
        <div className="flex-1 flex flex-col gap-1 p-2 overflow-hidden">
          {/* User message */}
          <div className="rounded-md bg-accent/15 px-2 py-1.5 self-end max-w-[90%]">
            <span className="font-mono text-[8px] text-accent-light leading-tight">
              Check if the API server is running
            </span>
          </div>
          {/* AI response */}
          <div className="px-1">
            <span className="font-mono text-[7px] text-text-secondary/90 leading-tight">
              I&apos;ll check the process list...
            </span>
          </div>
          {/* Tool progress card */}
          <div className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5">
            <div className="flex items-center gap-1 mb-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
              <span className="font-mono text-[7px] text-green-400">
                Running command...
              </span>
            </div>
            <span className="font-mono text-[7px] text-text-muted/70">
              ps aux | grep server
            </span>
          </div>
          {/* Result */}
          <div className="px-1">
            <span className="font-mono text-[7px] text-text-secondary/90 leading-tight">
              Server is running on port 3000
            </span>
          </div>
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        See every step the agent takes in real time — messages, tool calls, and
        results stream into a live thread
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for following the agent&apos;s reasoning step by step
        </span>
      </div>
    </div>
  );
}

function SessionHistoryCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="SESSIONS" sub="Auto-Saved · Resumable" />

      <PhonePortrait>
        <div className="flex-1 flex flex-col p-2 overflow-hidden">
          {/* Filter chips */}
          <div className="flex gap-0.5 mb-1">
            <span className="rounded-full bg-accent/15 px-1.5 py-[2px] font-mono text-[6px] text-accent-light leading-none">All</span>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-[2px] font-mono text-[6px] text-text-muted/70 leading-none">Today</span>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-[2px] font-mono text-[6px] text-text-muted/70 leading-none">This Week</span>
          </div>
          {/* Session rows */}
          {[
            {
              name: "Deploy fix for API",
              date: "Mar 15",
              count: "12",
              active: true,
            },
            {
              name: "Debug login timeout",
              date: "Mar 14",
              count: "8",
              active: false,
            },
            {
              name: "Setup CI pipeline",
              date: "Mar 12",
              count: "23",
              active: false,
            },
          ].map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 py-1 border-b border-white/[0.04] last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[7px] text-text-primary/90 truncate">
                  {s.name}
                </div>
                <div className="font-mono text-[6px] text-text-muted/70">
                  {s.date}
                </div>
              </div>
              <span className="font-mono text-[6px] text-text-muted/60 bg-white/[0.04] rounded px-1">
                {s.count}
              </span>
              {s.active && (
                <span className="font-mono text-[6px] text-accent-light bg-accent/15 rounded-full px-1.5 py-0.5">
                  Continue
                </span>
              )}
            </div>
          ))}
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Pick up where you left off — sessions persist across app restarts with
        full conversation history
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for resuming complex multi-step tasks
        </span>
      </div>
    </div>
  );
}

function CustomInstructionsCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="CUSTOM PROMPT" sub="Your Rules · Your Way" />

      <PhonePortrait>
        <div className="flex-1 flex flex-col p-2 overflow-hidden">
          {/* Text area mockup */}
          <div className="flex-1 rounded-md border border-white/[0.08] bg-white/[0.03] p-1.5">
            <div className="font-mono text-[7px] text-text-secondary/80 leading-relaxed space-y-1">
              <div>Always use PowerShell</div>
              <div>My project is at C:\Dev\myapp</div>
              <div>Respond in Spanish</div>
              <div className="terminal-cursor" />
            </div>
          </div>
          {/* Clear button */}
          <div className="mt-1.5 flex justify-end">
            <span className="font-mono text-[7px] text-text-muted/70 border border-white/[0.08] rounded-full px-2 py-0.5">
              Clear
            </span>
          </div>
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Tell the agent how you want it to behave — set language, project paths,
        or preferred tools
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for personalizing the agent to your workflow
        </span>
      </div>
    </div>
  );
}

function DeviceControlCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="DEVICE CONTROL" sub="Remote · Instant" />

      <div className="flex flex-col gap-2">
        {/* Keep awake toggle */}
        <div className="flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <span className="font-mono text-[10px] text-text-primary/90">
            Keep Screen Awake
          </span>
          <div className="w-7 h-4 rounded-full bg-green-500/40 flex items-center justify-end px-0.5">
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
        </div>
        {/* Lock button */}
        <div className="flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2">
          <span className="font-mono text-[10px] text-text-primary/90">
            Lock Desktop
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-red-400/80"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        {/* Info text */}
        <p className="font-mono text-[9px] text-text-muted/70 text-center">
          Control your desktop state from anywhere
        </p>
      </div>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Lock your screen or keep it awake during long tasks — all from your
        phone
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for hands-free desktop management
        </span>
      </div>
    </div>
  );
}

function VoiceInputCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="VOICE INPUT" sub="Speak · Send · Execute" />

      <PhonePortrait>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-2">
          {/* Waveform lines */}
          <svg
            width="80"
            height="32"
            viewBox="0 0 80 32"
            fill="none"
            className="mx-auto"
          >
            <path
              d="M5 16 Q15 4 25 16 Q35 28 45 16 Q55 4 65 16 Q70 22 75 16"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.7"
            />
            <path
              d="M5 16 Q15 8 25 16 Q35 24 45 16 Q55 8 65 16 Q70 20 75 16"
              stroke="#06b6d4"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.6"
            />
            <path
              d="M5 16 Q15 10 25 16 Q35 22 45 16 Q55 10 65 16 Q70 18 75 16"
              stroke="#8b5cf6"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.5"
            />
            <path
              d="M5 16 Q15 12 25 16 Q35 20 45 16 Q55 12 65 16 Q70 17 75 16"
              stroke="#ec4899"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.4"
            />
          </svg>
          {/* Duration */}
          <span className="font-mono text-[11px] text-text-primary/90">
            0:12
          </span>
          {/* Buttons */}
          <div className="flex gap-2">
            <span className="font-mono text-[8px] text-text-muted/80 border border-white/[0.08] rounded-full px-2 py-0.5">
              Cancel
            </span>
            <span className="font-mono text-[8px] text-white bg-accent/40 rounded-full px-2.5 py-0.5">
              Send
            </span>
          </div>
        </div>
      </PhonePortrait>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Speak or type — your intent becomes the command. Record voice, review,
        and send, or type directly for quick instructions
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for quick commands while multitasking
        </span>
      </div>
    </div>
  );
}

function ManualControlCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="MANUAL CONTROL" sub="Joystick · Hybrid Mode" />

      <PhoneLandscape>
        {/* Desktop stream background */}
        <div className="flex-1 bg-accent/10 relative overflow-hidden">
          {/* Desktop pointer cursor */}
          <svg className="absolute top-[34%] left-[46%]" width="10" height="14" viewBox="0 0 12 18" fill="none">
            <path d="M1 1L1 13L4.5 9.5L8 16L10 15L6.5 8.5L11 8L1 1Z" fill="rgba(255,255,255,0.85)" stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
          </svg>

          {/* Joystick — bottom left */}
          <div className="absolute bottom-1.5 left-2">
            <div className="w-[28px] h-[28px] rounded-full border border-white/[0.20] bg-black/[0.30] flex items-center justify-center">
              <div className="w-[12px] h-[12px] rounded-full bg-white/[0.25] border border-white/[0.35]" />
            </div>
          </div>

          {/* L / R buttons + scroll — bottom right */}
          <div className="absolute bottom-1.5 right-2 flex gap-[3px]">
            <div className="flex flex-col gap-[2px]">
              <div className="w-[22px] h-[13px] rounded-[3px] bg-black/[0.40] border border-white/[0.15] flex items-center justify-center">
                <span className="font-mono text-[6px] text-white/[0.90] font-bold">L</span>
              </div>
              <div className="w-[22px] h-[13px] rounded-[3px] bg-black/[0.40] border border-white/[0.15] flex items-center justify-center">
                <span className="font-mono text-[6px] text-white/[0.90] font-bold">R</span>
              </div>
            </div>
            <div className="flex flex-col gap-[2px]">
              <div className="w-[13px] h-[13px] rounded-[3px] bg-black/[0.35] border border-white/[0.12] flex items-center justify-center">
                <svg width="6" height="6" viewBox="0 0 10 10" fill="none">
                  <path d="M5 2L8 7H2L5 2Z" fill="rgba(255,255,255,0.7)" />
                </svg>
              </div>
              <div className="w-[13px] h-[13px] rounded-[3px] bg-black/[0.35] border border-white/[0.12] flex items-center justify-center">
                <svg width="6" height="6" viewBox="0 0 10 10" fill="none">
                  <path d="M5 8L2 3H8L5 8Z" fill="rgba(255,255,255,0.7)" />
                </svg>
              </div>
            </div>
          </div>

          {/* Key shortcut pills — center strip */}
          <div className="absolute bottom-1 left-[40px] right-[48px] flex gap-[2px] justify-center">
            {["Esc", "Tab", "Del", "Ctrl"].map((k) => (
              <span
                key={k}
                className="px-[3px] py-[1px] rounded-[3px] bg-black/[0.35] border border-white/[0.12] font-mono text-[6px] text-white/[0.70] leading-none"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      </PhoneLandscape>

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Take direct control — move the cursor with a joystick, click, scroll,
        and send key combos from your phone
      </p>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">
          Best for precision tasks the agent can&apos;t handle alone
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Story 3.2 — Description cards data
   ------------------------------------------------ */
const modelDescriptions = [
  {
    icon: <SlidersIcon />,
    category: "CONFIGURATION",
    title: "Per-Role Model Selection",
    desc: "Three independent AI roles — conversation, execution, and screen interaction — each configurable with 25+ models from Gemini, OpenAI, Anthropic, or OpenRouter. Change from your phone anytime.",
  },
  {
    icon: <GridSwitchIcon />,
    category: "BACKENDS",
    title: "Nine Screen Strategies",
    desc: "Nine ways for the agent to see your screen — from local OmniParser to six cloud vision models, Google's native vision, or keyboard-first with no screenshots.",
  },
  {
    icon: <ZapIcon />,
    category: "RUNTIME",
    title: "Switch Without Restarting",
    desc: "Change models and backends on the fly from mobile settings. The desktop agent picks up your new configuration on the next command — zero downtime.",
  },
];

/* ------------------------------------------------
   Story 3.3 — Description cards data
   ------------------------------------------------ */
const experienceDescriptions = [
  {
    icon: <ThreadIcon />,
    category: "EXECUTION",
    title: "See Every Step in Real Time",
    desc: "Watch the agent work through your request step by step. User messages, AI responses, tool calls, and results stream into a live thread — with progress indicators and expandable details.",
  },
  {
    icon: <HistoryIcon />,
    category: "SESSIONS",
    title: "Pick Up Where You Left Off",
    desc: "Every session is saved automatically with full conversation history. Browse by date, filter by tool or result, rename sessions, and continue any past session with one tap.",
  },
  {
    icon: <ControlIcon />,
    category: "CONTROL",
    title: "Your Desktop, Your Rules",
    desc: "Lock your screen, keep it awake, set custom instructions, use voice input, or take direct control with a joystick overlay for cursor, clicks, and keyboard shortcuts. Switch between AI and manual mode seamlessly.",
  },
];

/* ================================================
   Main section
   ================================================ */
export function Features() {
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
    <div ref={containerRef} className="mx-auto max-w-5xl">
      {/* Section header */}
      <FadeUp visible={visible} delay={0} className="mb-4 text-center">
        <h2 className="text-3xl font-bold tracking-[-0.02em] text-text-primary">
          Features
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-2xl text-[15px] leading-relaxed text-text-secondary">
          A powerful mobile interface designed for every workflow
        </p>
      </FadeUp>

      {/* Sub-heading for layout showcase (extensible — 3.2/3.3 add below) */}
      <FadeUp visible={visible} delay={75} className="mb-6">
        <h3 className="text-xl font-semibold tracking-[-0.01em] text-text-primary">
          Adaptive Layouts
        </h3>
      </FadeUp>

      {/* Diagram rows — role="img" scoped to visual-only content */}
      <div
        role="img"
        aria-label="Layout modes: Row 1 shows three portrait modes (Split View, Video Focus, Thread Focus) with phone mockups. Row 2 shows two landscape modes (Side-by-Side and Fullscreen Video)."
      >
        {/* Row 1: Portrait Modes — 3 cards */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <SplitViewCard />
              <VideoFocusCard />
              <ThreadFocusCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: Landscape + Orientation — 2 cards */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <SideBySideCard />
              <FullscreenVideoCard />
            </div>
          </div>
        </FadeUp>
      </div>

      {/* Description cards — outside role="img" for screen reader access */}
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

      {/* ── Model & Backend Selection (Story 3.2) ── */}

      {/* Sub-heading */}
      <FadeUp visible={visible} delay={600} className="mt-16 mb-6">
        <h3 className="text-xl font-semibold tracking-[-0.01em] text-text-primary">
          Intelligent Model Configuration
        </h3>
      </FadeUp>

      {/* Illustration row — 3-col grid */}
      <FadeUp visible={visible} delay={700}>
        <div
          role="img"
          aria-label="Model configuration: Three AI roles with independent model pickers, four screen interaction strategies, and multi-provider model selection across Gemini, OpenAI, Anthropic, and OpenRouter."
          className="arch-container mb-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
            <AIRolesCard />
            <ComputerUseBackendsCard />
            <ModelSelectionCard />
          </div>
        </div>
      </FadeUp>

      {/* Description cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {modelDescriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={900 + i * 80}>
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

      {/* ── Everyday Experience (Story 3.3) ── */}

      {/* Sub-heading */}
      <FadeUp visible={visible} delay={1200} className="mt-16 mb-6">
        <h3 className="text-xl font-semibold tracking-[-0.01em] text-text-primary">
          Everyday Experience
        </h3>
      </FadeUp>

      {/* Illustration rows — role="img" scoped to visual-only content */}
      <div
        role="img"
        aria-label="Everyday experience: Row 1 shows Live Execution Thread with chat bubbles and progress indicators, Session History with resumable past sessions, and Custom Instructions for personalizing the agent. Row 2 shows Device Control toggles for lock and keep-awake, Voice Input with waveform visualization, and Manual Control with a joystick overlay for direct cursor, click, scroll, and keyboard control."
      >
        {/* Row 1: 3-col grid */}
        <FadeUp visible={visible} delay={1300} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <LiveExecutionThreadCard />
              <SessionHistoryCard />
              <CustomInstructionsCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: 3-col grid */}
        <FadeUp visible={visible} delay={1450} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <DeviceControlCard />
              <VoiceInputCard />
              <ManualControlCard />
            </div>
          </div>
        </FadeUp>
      </div>

      {/* Description cards — outside role="img" for screen reader access */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {experienceDescriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={1600 + i * 80}>
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

/* ================================================
   Icons
   ================================================ */

function LayoutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="3" x2="12" y2="12" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function GestureIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/* Story 3.2 icons */

function SlidersIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function GridSwitchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/* Story 3.3 icons */

function ThreadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="13" y2="12" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ControlIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function GamepadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="6" width="20" height="12" rx="3" />
      <circle cx="8.5" cy="12" r="2" />
      <path d="M15 10h4" />
      <path d="M17 8v4" />
    </svg>
  );
}
