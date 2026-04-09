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
   Provider logos
   ------------------------------------------------ */
function GeminiLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14Z" fill="#8B9CF7" />
    </svg>
  );
}

function OpenAILogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 16 16" fill="#10A37F">
      <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
    </svg>
  );
}

function AnthropicLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#D4A27F">
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

function OpenRouterLogo() {
  return (
    <svg width="28" height="28" viewBox="-10 20 530 460" fill="none">
      <path d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945" stroke="#F97316" strokeWidth="28" fill="none" strokeLinecap="round" />
      <path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" fill="#F97316" />
      <path d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377" stroke="#F97316" strokeWidth="28" fill="none" strokeLinecap="round" />
      <path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" fill="#F97316" />
    </svg>
  );
}

/* ------------------------------------------------
   Card 1 - Providers
   ------------------------------------------------ */
function ProvidersCard() {
  const providers = [
    {
      logo: <GeminiLogo />,
      name: "Google Gemini",
      desc: "Flash, Pro, and Flash Lite models for conversation, execution, screen control, and speech-to-text.",
    },
    {
      logo: <OpenAILogo />,
      name: "OpenAI",
      desc: "GPT and o-series models with multimodal capabilities. Whisper for alternative speech-to-text.",
    },
    {
      logo: <AnthropicLogo />,
      name: "Anthropic",
      desc: "Claude Opus, Sonnet, and Haiku - with optional extended thinking for deeper reasoning.",
    },
    {
      logo: <OpenRouterLogo />,
      name: "OpenRouter",
      desc: "Universal gateway to 300+ models - Grok, Qwen, Mistral, Nemotron, and more via one API key.",
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Providers" sub="Keys or Subscriptions" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Choose from 4 providers and 20+ models. Use any combination for different tasks - switch anytime from your phone.
      </p>

      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <div key={p.name} className="flex items-start gap-3 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
            <span className="shrink-0 mt-0.5">{p.logo}</span>
            <div className="flex-1 min-w-0">
              <span className="block text-[12px] font-semibold text-text-primary">{p.name}</span>
              <span className="block text-[11px] text-text-secondary leading-relaxed mt-0.5">{p.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Card 2 - Three AI Roles
   ------------------------------------------------ */
function RolesCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Three AI Roles" sub="Mix & Match" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        The app uses three independent AI roles - assign any provider to any role, and change them at runtime from mobile settings.
      </p>

      <div className="flex flex-col gap-1.5">
        {[
          {
            role: "Conversation",
            desc: "Understands what you want and classifies your intent",
            color: "bg-accent-light/20",
            textColor: "text-accent-light",
          },
          {
            role: "Execution",
            desc: "Runs tools and carries out tasks on your desktop",
            color: "bg-cyan/20",
            textColor: "text-cyan",
          },
          {
            role: "Vision",
            desc: "Picks how the AI reads your screen - multiple backends available",
            color: "bg-purple/20",
            textColor: "text-purple",
          },
        ].map((r) => (
          <div key={r.role} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2.5">
            <span className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${r.color}`}>
              <span className={`font-mono text-[11px] font-bold ${r.textColor}`}>{r.role[0]}</span>
            </span>
            <div className="flex-1 min-w-0">
              <span className="block text-[12px] font-semibold text-text-primary">{r.role}</span>
              <span className="block text-[11px] text-text-secondary leading-relaxed mt-0.5">{r.desc}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-accent-light/[0.04] border border-accent-light/10 px-3 py-2">
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Any provider can fill any role - use Gemini for conversation and Claude for execution, or any other combination.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Card 3 - Key Distribution
   ------------------------------------------------ */
function KeyDistributionCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Authentication" sub="QR Pairing" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Set up API keys or enable subscription mode on the desktop app. Configuration travels to your phone securely through QR pairing - no manual copying.
      </p>

      {/* Flow steps */}
      <div className="flex flex-col gap-1.5">
        {[
          { step: "1", text: "Configure API keys or enable subscription mode in desktop settings" },
          { step: "2", text: "Scan the QR code with your phone to pair" },
          { step: "3", text: "Auth config is encrypted and stored in your phone's secure enclave" },
        ].map((s) => (
          <div key={s.step} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-accent/20 font-mono text-[10px] font-bold text-accent-light">
              {s.step}
            </span>
            <span className="text-[11px] text-text-secondary">{s.text}</span>
          </div>
        ))}
      </div>

      {/* Provider keys */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { provider: "Gemini", logo: <GeminiLogo /> },
          { provider: "OpenAI", logo: <OpenAILogo /> },
          { provider: "Anthropic", logo: <AnthropicLogo /> },
          { provider: "OpenRouter", logo: <OpenRouterLogo /> },
        ].map((p) => (
          <div key={p.provider} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-1.5">
            <span className="shrink-0 [&>svg]:w-4 [&>svg]:h-4">{p.logo}</span>
            <span className="font-mono text-[10px] text-text-secondary">{p.provider}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">Models configurable per-role at runtime</span>
      </div>
    </div>
  );
}

/* ================================================
   Description card icons
   ================================================ */
function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/* ================================================
   Description cards data
   ================================================ */
const descriptions = [
  {
    icon: <LayersIcon />,
    category: "CHOICE",
    title: "Pick the best model for the job",
    desc: "Different tasks benefit from different models. Use a fast model for quick actions and a powerful one for complex reasoning - all from the same app.",
  },
  {
    icon: <SlidersIcon />,
    category: "CONTROL",
    title: "Configure from your phone",
    desc: "Switch models and providers at any time from mobile settings. Each AI role can be independently assigned to any supported model.",
  },
  {
    icon: <ShieldIcon />,
    category: "SECURITY",
    title: "Your credentials, your control",
    desc: "API keys and subscription preferences never leave your devices. They're configured on your desktop, transferred securely via QR, and stored encrypted on your phone.",
  },
];

/* ================================================
   Main section
   ================================================ */
export default function ModelProviders() {
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
          Model Providers
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          Use API keys or your existing subscriptions - choose from 4 providers and 20+ models, and configure any combination for any task.
        </p>
      </FadeUp>

      {/* Single row: 3 cards */}
      <FadeUp visible={visible} delay={100} className="mb-3">
        <div className="arch-container">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
            <ProvidersCard />
            <RolesCard />
            <KeyDistributionCard />
          </div>
        </div>
      </FadeUp>

      {/* Description cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {descriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={250 + i * 80}>
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
