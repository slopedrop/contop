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
   Row 1, Card 1 — Advanced Workflows (Python)
   ------------------------------------------------ */
function AdvancedWorkflowsCard() {
  const tools = [
    { name: "fill_form", args: "fields" },
    { name: "extract_text", args: "region, element_name" },
    { name: "copy_between_apps", args: "source, target" },
    { name: "set_env_var", args: 'name, value, scope' },
    { name: "change_setting", args: "setting_path, value" },
    { name: "app_menu", args: "app_name, menu_path" },
    { name: "install_app", args: "name, method" },
    { name: "find_and_replace_in_files", args: "path, pattern, old, new" },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Advanced Workflows" sub="v1.0.0 · python" />

      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="flex flex-col gap-0.5">
          {tools.map((t) => (
            <div key={t.name} className="font-mono text-[10px] leading-relaxed">
              <span className="text-text-muted">async def </span>
              <span className="text-accent-light">{t.name}</span>
              <span className="text-text-muted">(</span>
              <span className="text-text-secondary">{t.args}</span>
              <span className="text-text-muted">)</span>
              <span className="text-cyan"> → dict</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-muted">8 Python tools</span>
        <span className="rounded-full bg-accent-light/10 border border-accent-light/20 px-2 py-0.5 font-mono text-[8px] text-accent-light">
          python
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1, Card 2 — IDE Chat (Workflow)
   ------------------------------------------------ */
function IdeChatCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="IDE Chat" sub="v2.0.0 · workflow" />

      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <div className="text-text-muted mb-1"># vscode-claude-send</div>
          <div>
            <span className="text-text-muted">- </span>
            <span className="text-accent-light">action</span>
            <span className="text-text-muted">: </span>
            <span className="text-cyan">hotkey</span>
          </div>
          <div className="pl-3">
            <span className="text-accent-light">keys</span>
            <span className="text-text-muted">: </span>
            <span className="text-text-secondary">[ctrl, shift, p]</span>
          </div>
          <div>
            <span className="text-text-muted">- </span>
            <span className="text-accent-light">action</span>
            <span className="text-text-muted">: </span>
            <span className="text-cyan">type_text</span>
          </div>
          <div className="pl-3">
            <span className="text-accent-light">text</span>
            <span className="text-text-muted">: </span>
            <span className="text-text-secondary">{'"Claude: {prompt}"'}</span>
          </div>
          <div>
            <span className="text-text-muted">- </span>
            <span className="text-accent-light">action</span>
            <span className="text-text-muted">: </span>
            <span className="text-cyan">press_key</span>
          </div>
          <div className="pl-3">
            <span className="text-accent-light">key</span>
            <span className="text-text-muted">: </span>
            <span className="text-text-secondary">enter</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {["VS Code Claude", "VS Code Copilot", "Cursor"].map((ide) => (
          <div key={ide} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
            <span className="font-mono text-[10px] text-text-secondary">{ide}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-muted">24 deterministic workflows</span>
        <span className="rounded-full bg-cyan/10 border border-cyan/20 px-2 py-0.5 font-mono text-[8px] text-cyan">
          workflow
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1, Card 3 — Prompt Skills
   ------------------------------------------------ */
function PromptSkillsCard() {
  const skills = [
    { name: "skill-authoring", ver: "1.0.0", desc: "Guide for creating and editing custom skills" },
    { name: "web-research", ver: "1.0.0", desc: "Browser automation + Electron + CDP strategy" },
    { name: "cli-command-patterns", ver: "1.1.0", desc: "Cross-platform bash/PowerShell patterns" },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Prompt Skills" sub="SKILL.md Standard" />

      {/* SKILL.md frontmatter example */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <div className="text-text-muted">---</div>
          <div>
            <span className="text-accent-light">name</span>
            <span className="text-text-muted">: </span>
            <span className="text-text-secondary">skill-authoring</span>
          </div>
          <div>
            <span className="text-accent-light">description</span>
            <span className="text-text-muted">: </span>
            <span className="text-text-secondary">Guide for creating...</span>
          </div>
          <div>
            <span className="text-accent-light">version</span>
            <span className="text-text-muted">: </span>
            <span className="text-cyan">{'"1.0.0"'}</span>
          </div>
          <div className="text-text-muted">---</div>
          <div className="text-text-muted mt-1"># Skill Instructions</div>
          <div className="text-text-secondary">Markdown body with agent...</div>
        </div>
      </div>

      {/* Skill list */}
      <div className="flex flex-col gap-1">
        {skills.map((s) => (
          <div key={s.name} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <div className="flex-1 min-w-0">
              <span className="block font-mono text-[10px] font-semibold text-text-primary">{s.name}</span>
              <span className="block text-[9px] text-text-muted leading-tight">{s.desc}</span>
            </div>
            <span className="font-mono text-[8px] text-text-muted shrink-0">v{s.ver}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-muted">Agent instructions loaded on demand</span>
        <span className="rounded-full bg-purple/10 border border-purple/20 px-2 py-0.5 font-mono text-[8px] text-purple">
          prompt
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2, Card 1 — Skill Types
   ------------------------------------------------ */
function SkillTypesCard() {
  const types = [
    { type: "prompt", exec: "Agent instructions loaded on demand", color: "text-purple" },
    { type: "workflow", exec: "Executed deterministically by workflow engine", color: "text-cyan" },
    { type: "python", exec: "Async Python functions registered as agent tools", color: "text-accent-light" },
    { type: "mixed", exec: "All mechanisms available", color: "text-yellow-400" },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Skill Types" sub="4 Execution Models" />

      {/* Types list */}
      <div className="flex flex-col gap-1.5">
        {types.map((t) => (
          <div key={t.type} className="flex items-start gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <span className={`shrink-0 font-mono text-[11px] font-bold ${t.color} w-[68px]`}>{t.type}</span>
            <span className="text-[11px] text-text-secondary leading-relaxed">{t.exec}</span>
          </div>
        ))}
      </div>

      {/* Directory structure */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <div className="text-text-muted">~/.contop/skills/{"{skill-name}"}/<span className="terminal-cursor" /></div>
          <div>
            <span className="text-text-muted">├── </span>
            <span className="text-accent-light">SKILL.md</span>
            <span className="text-text-muted">        </span>
            <span className="text-text-muted/60"># YAML frontmatter + markdown</span>
          </div>
          <div>
            <span className="text-text-muted">└── </span>
            <span className="text-cyan">scripts/</span>
            <span className="text-text-muted/60">       # Optional</span>
          </div>
          <div className="pl-4">
            <span className="text-text-muted">├── </span>
            <span className="text-text-secondary">*.yaml</span>
          </div>
          <div className="pl-4">
            <span className="text-text-muted">└── </span>
            <span className="text-text-secondary">*.py</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2, Card 2 — Skill Lifecycle
   ------------------------------------------------ */
function SkillLifecycleCard() {
  const stages = [
    { n: "1", label: "Discovery", detail: "discover_skills() scans ~/.contop/skills/", color: "bg-accent/20 text-accent-light" },
    { n: "2", label: "Registration", detail: "enabled_skills in settings.json", color: "bg-cyan/20 text-cyan" },
    { n: "3", label: "Disclosure", detail: "Metadata at startup, full on load_skill", color: "bg-purple/20 text-purple" },
    { n: "4", label: "Conflicts", detail: "Tool name check against 33 CORE_TOOL_NAMES", color: "bg-yellow-400/20 text-yellow-400" },
    { n: "5", label: "Agent Tools", detail: "execute · load · create · edit", color: "bg-green-500/20 text-green-400" },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Skill Lifecycle" sub="5-Stage Pipeline" />

      {/* Stages */}
      <div className="flex flex-col gap-1">
        {stages.map((s) => (
          <div key={s.n} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <span className={`shrink-0 flex items-center justify-center h-5 w-5 rounded-full ${s.color} font-mono text-[10px] font-bold`}>
              {s.n}
            </span>
            <div className="flex-1 min-w-0">
              <span className="block font-mono text-[10px] font-semibold text-text-primary">{s.label}</span>
              <span className="block text-[9px] text-text-muted leading-tight">{s.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {/* XML output format */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <div className="text-text-muted/60">{'<!-- build_skills_prompt_section() -->'}</div>
          <div>
            <span className="text-text-muted">{'<'}</span>
            <span className="text-accent-light">skills</span>
            <span className="text-text-muted">{'>'}</span>
          </div>
          <div className="pl-2">
            <span className="text-text-muted">{'<'}</span>
            <span className="text-accent-light">skill</span>
            <span className="text-cyan"> name</span>
            <span className="text-text-muted">={'"ide-chat"'} </span>
            <span className="text-cyan">type</span>
            <span className="text-text-muted">={'"workflow"'}</span>
            <span className="text-text-muted">{'>'}</span>
          </div>
          <div className="pl-4 text-text-secondary">Control AI coding IDE...</div>
          <div className="pl-2">
            <span className="text-text-muted">{'</'}</span>
            <span className="text-accent-light">skill</span>
            <span className="text-text-muted">{'>'}</span>
          </div>
          <div>
            <span className="text-text-muted">{'</'}</span>
            <span className="text-accent-light">skills</span>
            <span className="text-text-muted">{'>'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Description card icons
   ================================================ */
function PuzzleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

/* ================================================
   Description cards data
   ================================================ */
const descriptions = [
  {
    icon: <PuzzleIcon />,
    category: "EXTENSIBILITY",
    title: "Extensible Agent",
    desc: "Add new capabilities by dropping a SKILL.md file into the skills directory. The agent discovers and loads it automatically — no code changes needed.",
  },
  {
    icon: <RepeatIcon />,
    category: "AUTOMATION",
    title: "Deterministic Workflows",
    desc: "Define YAML step sequences for repetitive tasks — keyboard shortcuts, menu navigation, form filling. Runs the same way every time, no AI guesswork.",
  },
  {
    icon: <WrenchIcon />,
    category: "CUSTOMIZATION",
    title: "Create Your Own",
    desc: "Build custom skills as prompt instructions, YAML workflows, Python tools, or any combination. Manage them from the desktop GUI — discover, enable, edit.",
  },
];

/* ================================================
   Main section
   ================================================ */
export default function Skills() {
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
          Skills
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          Extensible agent capabilities via the SKILL.md standard — built-in skills included, custom skills easy to create.
        </p>
      </FadeUp>

      <div
        role="img"
        aria-label="Skills system architecture: Row 1 shows built-in skills — Advanced Workflows with Python tools, IDE Chat with YAML workflows, and Prompt Skills with SKILL.md format. Row 2 shows skill types and the 5-stage lifecycle pipeline."
      >
        {/* Row 1: Built-in Skills — 3 cards */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <AdvancedWorkflowsCard />
              <IdeChatCard />
              <PromptSkillsCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: Types + Lifecycle — 2 cards */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <SkillTypesCard />
              <SkillLifecycleCard />
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
