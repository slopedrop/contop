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
      <span className="font-mono text-[10px] text-text-secondary tracking-wider uppercase">
        {label}
      </span>
      <span className="font-mono text-[9px] text-text-muted/50 ml-auto">
        {sub}
      </span>
    </div>
  );
}

/* ================================================
   Row 1: Away Mode
   ================================================ */

/* Card 1 — Away Mode Overview (split view) */
function AwayModeOverviewCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Away Mode" sub="away_mode.rs · Physical Security" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* LEFT — Bystander view: locked laptop */}
        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
          <div className="font-mono text-[9px] text-text-muted mb-2 uppercase tracking-wider">
            Bystander sees
          </div>
          <div className="flex flex-col items-center gap-2 py-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted/60">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div className="font-mono text-[10px] text-text-secondary text-center">
              Dark PIN overlay
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-2 w-2 rounded-full bg-text-muted/30" />
              ))}
            </div>
          </div>
          <div className="mt-2 rounded bg-black/60 border border-white/[0.03] px-2 py-1">
            <span className="font-mono text-[9px] text-accent-light">WDA_EXCLUDEFROMCAPTURE</span>
            <span className="font-mono text-[9px] text-text-muted"> = </span>
            <span className="font-mono text-[9px] text-cyan">0x00000011</span>
          </div>
          <div className="font-mono text-[8px] text-text-muted/50 mt-1">
            Invisible to screen capture
          </div>
        </div>

        {/* RIGHT — Owner view: phone with live feed */}
        <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
          <div className="font-mono text-[9px] text-text-muted mb-2 uppercase tracking-wider">
            Owner sees
          </div>
          <div className="flex flex-col items-center gap-2 py-3">
            <svg width="20" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light/60">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
            <div className="font-mono text-[10px] text-text-secondary text-center">
              Live WebRTC video feed
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="font-mono text-[9px] text-green-400">streaming</span>
            </div>
          </div>
          <div className="mt-2 rounded bg-black/60 border border-white/[0.03] px-2 py-1">
            <span className="font-mono text-[9px] text-text-muted">Desktop automation running</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Card 2 — Away Mode Features */
function AwayModeFeaturesCard() {
  const features = [
    {
      label: "PIN-locked overlay",
      detail: "Fullscreen topmost window · low-level keyboard hook blocks everything except digit keys (0–9), numpad (0–9), backspace, and enter",
    },
    {
      label: "Auto-engage on idle",
      detail: "Activates after 5 minutes of no mouse or keyboard input · polls every 30 seconds via GetLastInputInfo()",
    },
    {
      label: "3 unlock methods",
      detail: "Screen PIN (4–12 digits, bcrypt cost 10) · phone command (away_mode_disengage) · emergency recovery PIN (6–12 digits)",
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Away Mode Features" sub="3 layers" />

      <div className="flex flex-col gap-1.5">
        {features.map((f) => (
          <div key={f.label} className="rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <span className="block font-mono text-[10px] font-semibold text-accent-light">{f.label}</span>
            <span className="block font-mono text-[9px] text-text-secondary leading-relaxed mt-0.5">{f.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================
   Row 2: Classification & Sandbox
   ================================================ */

/* Card 1 — Command Classifier */
function DualToolEvaluatorCard() {
  const steps = [
    { n: "1", rule: "User forced host execution", result: "run on host", color: "text-green-400" },
    { n: "2", rule: "Needs the screen (GUI, browser, observe)", result: "run on host", color: "text-green-400" },
    { n: "3", rule: "Unknown or unrecognized tool", result: "sandbox it", color: "text-amber-400" },
    { n: "4", rule: "Forbidden command (rm -rf /, format C:, mkfs…)", result: "block entirely", color: "text-red-400" },
    { n: "5", rule: "Touches protected path (/root, C:\\Windows…)", result: "sandbox it", color: "text-amber-400" },
    { n: "6", rule: "Destructive (rm, kill, DROP TABLE, taskkill…)", result: "ask user first", color: "text-yellow-300" },
    { n: "7", rule: "Everything else — safe by default", result: "run on host", color: "text-green-400" },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Command Classifier" sub="dual_tool_evaluator.py" />

      <div className="font-mono text-[10px] text-text-secondary leading-relaxed mb-1">
        Every command the agent wants to run goes through this 7-step check — top to bottom, first match wins:
      </div>

      {/* Cascade */}
      <div className="flex flex-col gap-0.5">
        {steps.map((s) => (
          <div key={s.n} className="flex items-start gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-2 py-1.5">
            <span className="shrink-0 flex items-center justify-center h-4 w-4 rounded-full bg-white/[0.06] font-mono text-[8px] text-text-muted mt-0.5">
              {s.n}
            </span>
            <div className="flex-1 min-w-0">
              <span className="block font-mono text-[9px] text-text-secondary leading-relaxed">{s.rule}</span>
              <span className={`font-mono text-[8px] ${s.color}`}>→ {s.result}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Extra protections */}
      <div className="font-mono text-[8px] text-text-muted/60">
        Also blocks encoded PowerShell commands · detects dangerous cmdlets like remove-item, stop-process, invoke-expression
      </div>
    </div>
  );
}

/* Card 2 — Docker Sandbox */
function DockerSandboxCard() {
  const restrictions = [
    { what: "No network access", detail: "Container can't reach the internet" },
    { what: "256 MB memory limit", detail: "Prevents resource exhaustion" },
    { what: "50% CPU cap", detail: "Won't slow down your machine" },
    { what: "100 process limit", detail: "No fork bombs" },
    { what: "Read-only filesystem", detail: "Can't modify the container image" },
    { what: "64 MB temp storage", detail: "Only /tmp is writable, and it's tiny" },
    { what: "No privilege escalation", detail: "Runs as 'nobody' with zero capabilities" },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Docker Sandbox" sub="docker_sandbox.py" />

      <div className="font-mono text-[10px] text-text-secondary leading-relaxed mb-1">
        Risky commands run inside a locked-down Docker container:
      </div>

      {/* Hardening — human-readable */}
      <div className="flex flex-col gap-0.5">
        {restrictions.map((r) => (
          <div key={r.what} className="flex items-start gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-2 py-1.5">
            <span className="block font-mono text-[9px] font-semibold text-accent-light leading-relaxed">{r.what}</span>
            <span className="font-mono text-[8px] text-text-muted/60 ml-auto shrink-0">{r.detail}</span>
          </div>
        ))}
      </div>

      {/* Auto-start */}
      <div className="rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
        <span className="block font-mono text-[10px] font-semibold text-text-primary">Auto-starts Docker Desktop</span>
        <span className="block font-mono text-[9px] text-text-secondary">Detects if Docker is installed but not running and starts it automatically</span>
      </div>
    </div>
  );
}

/* Card 3 — Mobile Confirmation */
function ConfirmationFlowCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Mobile Approval" sub="webrtc_peer.py" />

      <div className="font-mono text-[10px] text-text-secondary leading-relaxed mb-1">
        When the agent wants to do something destructive, it asks your phone for permission first:
      </div>

      {/* Flow sequence */}
      <div className="flex flex-col gap-1">
        {[
          { step: "1", label: "Desktop agent pauses", detail: "\"I want to delete 3 files — approve?\"" },
          { step: "2", label: "Your phone shows a prompt", detail: "Approve or Deny with one tap" },
          { step: "3", label: "Agent gets your answer", detail: "Proceeds only if you approved" },
        ].map((s) => (
          <div key={s.step} className="rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 flex items-center justify-center h-4 w-4 rounded-full bg-accent/20 font-mono text-[8px] text-accent-light">
                {s.step}
              </span>
              <span className="font-mono text-[10px] font-semibold text-text-primary">{s.label}</span>
            </div>
            <span className="block font-mono text-[9px] text-text-secondary mt-0.5 pl-6">{s.detail}</span>
          </div>
        ))}
      </div>

      {/* Message format */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[9px] text-text-muted/60 mb-1">Sent over encrypted WebRTC data channel:</div>
        <div className="font-mono text-[10px] leading-relaxed">
          <div>{"{"}</div>
          <div className="pl-3">
            <span className="text-accent-light">{'"type"'}</span>
            <span className="text-text-muted">: </span>
            <span className="text-cyan">{'"agent_confirmation_response"'}</span>
          </div>
          <div className="pl-3">
            <span className="text-accent-light">{'"payload"'}</span>
            <span className="text-text-muted">{": { "}</span>
            <span className="text-accent-light">{'"approved"'}</span>
            <span className="text-text-muted">: </span>
            <span className="text-cyan">true</span>
            <span className="text-text-muted">{" }"}</span>
          </div>
          <div>{"}"}</div>
        </div>
      </div>
    </div>
  );
}

/* ================================================
   Row 3: Logging, Auth, Config
   ================================================ */

/* Card 1 — Audit Logging */
function AuditLoggingCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Audit Logging" sub="audit_logger.py" />

      {/* Log path */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <span className="text-text-muted">~/.contop/logs/</span>
          <span className="text-accent-light">session-{'{'}</span>
          <span className="text-cyan">YYYY-MM-DD</span>
          <span className="text-accent-light">{'}'}.jsonl</span>
          <span className="terminal-cursor" />
        </div>
      </div>

      {/* Entry schema */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="flex flex-col gap-0.5">
          {[
            { key: "timestamp", val: "UTC ISO 8601" },
            { key: "session_id", val: "str" },
            { key: "user_prompt", val: "str" },
            { key: "classified_command", val: "str" },
            { key: "tool_used", val: "str" },
            { key: "execution_result", val: "str" },
            { key: "voice_message", val: 'str (default "")' },
            { key: "duration_ms", val: "int (default 0)" },
          ].map((f) => (
            <div key={f.key} className="font-mono text-[10px] leading-relaxed">
              <span className="text-accent-light">{f.key}</span>
              <span className="text-text-muted">: </span>
              <span className="text-cyan">{f.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Method signature */}
      <div className="font-mono text-[9px] text-text-secondary">
        async def log(*, session_id, user_prompt, classified_command, tool_used, execution_result, voice_message, duration_ms)
      </div>
      <div className="font-mono text-[8px] text-text-muted/60">
        Fire-and-forget · asyncio.to_thread(self._write_line, path, line)
      </div>
    </div>
  );
}

/* Card 2 — Auth & Encryption */
function AuthEncryptionCard() {
  const tokenFields = [
    "token",
    "dtls_fingerprint",
    "stun_config",
    "created_at",
    "expires_at",
    "device_id",
    'connection_type = "permanent"',
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Auth & Encryption" sub="pairing.py" />

      {/* PairingToken */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <div className="text-text-muted">@dataclass</div>
          <div>
            <span className="text-accent-light">PairingToken</span>
            <span className="text-text-muted">:</span>
          </div>
          {tokenFields.map((f) => (
            <div key={f} className="pl-3">
              <span className="text-text-secondary">{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* TTLs and crypto */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
          <span className="font-mono text-[10px] text-text-secondary">TOKEN_TTL_DAYS</span>
          <span className="font-mono text-[10px] text-cyan">30</span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
          <span className="font-mono text-[10px] text-text-secondary">TEMP_TOKEN_TTL_HOURS</span>
          <span className="font-mono text-[10px] text-cyan">4</span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
          <span className="font-mono text-[10px] text-text-secondary">DTLS fingerprint</span>
          <span className="font-mono text-[10px] text-cyan">SHA-256</span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
          <span className="font-mono text-[10px] text-text-secondary">STUN</span>
          <span className="font-mono text-[9px] text-cyan">stun.l.google.com:19302</span>
        </div>
      </div>

      <div className="font-mono text-[8px] text-text-muted/60">
        ~/.contop/tokens.json · atomic write (.tmp → rename) · validate_token() auto-removes expired
      </div>
    </div>
  );
}

/* ================================================
   Row 4: Device Management
   ================================================ */

/* Card 1 — Device Dashboard */
function DeviceDashboardCard() {
  const devices = [
    {
      id: "dev-1",
      name: "Alex's iPhone",
      connected: true,
      path: "Local Network",
      pathColor: "text-green-400",
      location: null,
      lastSeen: "Just now",
    },
    {
      id: "dev-2",
      name: "Work iPad",
      connected: false,
      path: "Tunnel",
      pathColor: "text-cyan",
      location: "San Francisco, US",
      lastSeen: "2 hours ago",
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Paired Devices" sub="pairing.py · Desktop UI" />

      <div className="font-mono text-[10px] text-text-secondary leading-relaxed mb-1">
        See every device that can access your computer — live status, location, and connection path:
      </div>

      <div className="flex flex-col gap-1.5">
        {devices.map((d) => (
          <div key={d.id} className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`h-2 w-2 rounded-full ${d.connected ? "bg-green-500 motion-safe:animate-pulse" : "bg-text-muted/40"}`} />
              <span className="font-mono text-[10px] font-semibold text-text-primary">{d.name}</span>
              <span className={`ml-auto font-mono text-[8px] ${d.connected ? "text-green-400" : "text-text-muted/50"}`}>
                {d.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              <div className="font-mono text-[9px]">
                <span className="text-text-muted">via </span>
                <span className={d.pathColor}>{d.path}</span>
              </div>
              {d.location && (
                <div className="font-mono text-[9px]">
                  <span className="text-text-muted">from </span>
                  <span className="text-text-secondary">{d.location}</span>
                </div>
              )}
              <div className="font-mono text-[9px] text-text-muted/50">
                {d.lastSeen}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Revoke action */}
      <div className="flex items-center gap-2 rounded-md bg-red-400/[0.06] border border-red-400/10 px-3 py-1.5">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        <span className="font-mono text-[9px] text-red-400">One-click revoke — instantly disconnects and blocks the device</span>
      </div>
    </div>
  );
}

/* Card 2 — Alerts & Compact QR */
function DeviceAlertsCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Alerts & Smart Pairing" sub="geo.py · OS Notifications" />

      {/* OS notification mockup */}
      <div className="font-mono text-[10px] text-text-secondary leading-relaxed mb-1">
        Native OS notifications fire in real time — even when the app is minimized:
      </div>

      <div className="flex flex-col gap-1">
        {[
          { type: "Device Connected", detail: "Alex's iPhone via Local Network", icon: "text-green-400", bg: "bg-green-400/[0.06] border-green-400/10" },
          { type: "Token Replaced", detail: "New pairing replaced existing access", icon: "text-amber-400", bg: "bg-amber-400/[0.06] border-amber-400/10" },
        ].map((n) => (
          <div key={n.type} className={`rounded-md border px-3 py-1.5 ${n.bg}`}>
            <div className="flex items-center gap-1.5">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 ${n.icon}`} aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className={`font-mono text-[9px] font-semibold ${n.icon}`}>{n.type}</span>
            </div>
            <span className="block font-mono text-[8px] text-text-muted/60 mt-0.5 pl-[14px]">{n.detail}</span>
          </div>
        ))}
      </div>

      {/* Geo-location */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[9px] text-text-muted/60 mb-1">Connection path auto-classified:</div>
        <div className="flex flex-col gap-0.5">
          {[
            { path: "Private IP (192.168.x, 10.x)", result: "Local Network", color: "text-green-400" },
            { path: "Tailscale IP (100.64.0.0/10)", result: "Tailscale VPN", color: "text-cyan" },
            { path: "Public IP", result: "Tunnel — geo-located", color: "text-amber-400" },
          ].map((p) => (
            <div key={p.path} className="font-mono text-[9px] leading-relaxed">
              <span className="text-text-muted">{p.path}</span>
              <span className="text-text-muted"> → </span>
              <span className={p.color}>{p.result}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

/* Card 3 — Configurable Rules */
function ConfigurableRulesCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Configurable Rules" sub="settings.py" />

      {/* Settings schema */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="flex flex-col gap-2">
          <div>
            <div className="font-mono text-[10px] text-accent-light mb-0.5">restricted_paths[]</div>
            <div className="font-mono text-[9px] text-text-secondary leading-relaxed">
              /root · /etc/shadow · /etc/passwd · C:\Windows · C:\Windows\System32 · C:\Windows\SysWOW64
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-accent-light mb-0.5">forbidden_commands[]</div>
            <div className="font-mono text-[9px] text-text-secondary leading-relaxed">
              rm -rf / · mkfs · dd if= · format C: · del /f /s /q C:\
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-accent-light mb-0.5">destructive_patterns[]</div>
            <div className="font-mono text-[9px] text-text-secondary leading-relaxed">
              rm · rmdir · del · kill · taskkill · shutdown · DROP TABLE · remove-item · stop-process…
            </div>
          </div>
        </div>
      </div>

      {/* Away mode config */}
      <div className="rounded-lg bg-black/40 border border-white/[0.04] p-3">
        <div className="font-mono text-[10px] leading-relaxed">
          <div className="text-accent-light mb-0.5">away_mode:</div>
          {[
            { key: "enabled", val: "false" },
            { key: "pin_hash", val: '""' },
            { key: "emergency_pin_hash", val: '""' },
            { key: "auto_engage_minutes", val: "5" },
            { key: "idle_timeout_enabled", val: "true" },
          ].map((c) => (
            <div key={c.key} className="pl-3">
              <span className="text-text-secondary">{c.key}</span>
              <span className="text-text-muted">: </span>
              <span className="text-cyan">{c.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="font-mono text-[8px] text-text-muted/60">
        Hot-reload via mtime caching · get_settings() checks _cached_mtime · ~/.contop/settings.json
      </div>
    </div>
  );
}

/* ================================================
   Description card icons
   ================================================ */
function DevicesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="7" height="14" rx="1.5" />
      <rect x="15" y="3" width="7" height="14" rx="1.5" />
      <path d="M9 14h6" />
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

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/* ================================================
   Description cards data
   ================================================ */
const descriptions = [
  {
    icon: <ShieldIcon />,
    category: "PHYSICAL SECURITY",
    title: "Away Mode",
    desc: "Away Mode protects your machine when you're not at the keyboard. PIN overlay, keyboard lock, idle auto-engage, encrypted secrets.",
  },
  {
    icon: <FilterIcon />,
    category: "EXECUTION SAFETY",
    title: "Command Classification",
    desc: "Every command is classified before it runs. Dangerous actions are sandboxed or blocked. You approve what matters.",
  },
  {
    icon: <LockIcon />,
    category: "CONNECTION TRUST",
    title: "End-to-End Encrypted",
    desc: "End-to-end encrypted. Peer-to-peer. No cloud relay. Biometric pairing. Your data never leaves the tunnel.",
  },
  {
    icon: <DevicesIcon />,
    category: "DEVICE VISIBILITY",
    title: "Paired Device Management",
    desc: "See every connected device, where it's connecting from, and revoke access instantly. OS alerts for every connection event.",
  },
];

/* ================================================
   Main section
   ================================================ */
export default function Security() {
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
          Security
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          Every layer verified against the real codebase — from physical machine protection to encrypted peer-to-peer connections.
        </p>
      </FadeUp>

      <div
        role="img"
        aria-label="Security architecture: Row 1 shows Away Mode with PIN overlay and live WebRTC feed. Row 2 shows the DualToolEvaluator classification cascade, Docker sandbox hardening, and mobile confirmation flow. Row 3 shows audit logging, auth and encryption, and configurable security rules. Row 4 shows paired device management with live status dashboard, geo-location, OS alerts, and one-click revocation."
      >
        {/* Row 1: Away Mode — 2 cards (hero) */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <AwayModeOverviewCard />
              <AwayModeFeaturesCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: Classification & Sandbox — 3 cards */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <DualToolEvaluatorCard />
              <DockerSandboxCard />
              <ConfirmationFlowCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 3: Logging, Auth, Config — 3 cards */}
        <FadeUp visible={visible} delay={400} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <AuditLoggingCard />
              <AuthEncryptionCard />
              <ConfigurableRulesCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 4: Device Management — 2 cards (hero) */}
        <FadeUp visible={visible} delay={550} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <DeviceDashboardCard />
              <DeviceAlertsCard />
            </div>
          </div>
        </FadeUp>
      </div>

      {/* Description cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {descriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={700 + i * 80}>
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
