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
      <span className="font-mono text-[10px] text-text-muted tracking-wider uppercase">{label}</span>
      <span className="font-mono text-[9px] text-text-muted/50 ml-auto">{sub}</span>
    </div>
  );
}

/* ------------------------------------------------
   Row 1 Card 1 — LAN Connection
   ------------------------------------------------ */
function LANCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="LAN" sub="Fastest · Tried First" />

      <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
        <WifiIcon />
        <div>
          <p className="font-mono text-[11px] text-text-primary font-medium">Same Wi-Fi Network</p>
          <p className="font-mono text-[10px] text-text-muted mt-0.5">Direct connection, lowest latency</p>
        </div>
      </div>

      {/* How it works */}
      <div className="flex flex-col gap-1.5">
        {[
          { label: "Discovery", detail: "Auto-detects desktop on your network" },
          { label: "Speed", detail: "Connects in under 1.5 seconds" },
          { label: "Privacy", detail: "Traffic never leaves your router" },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="shrink-0 font-mono text-[10px] text-accent-light w-[70px]">{r.label}</span>
            <span className="font-mono text-[10px] text-text-secondary">{r.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">Best for home &amp; office use</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1 Card 2 — Tailscale VPN Mesh
   ------------------------------------------------ */
function TailscaleCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Tailscale" sub="Secure · 2nd Path" />

      <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
        <ShieldIcon />
        <div>
          <p className="font-mono text-[11px] text-text-primary font-medium">Zero-Trust VPN Mesh</p>
          <p className="font-mono text-[10px] text-text-muted mt-0.5">WireGuard-based encrypted tunnel</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {[
          { label: "Reach", detail: "Works from anywhere, both devices need Tailscale" },
          { label: "Speed", detail: "Connects in under 3 seconds" },
          { label: "Setup", detail: "Auto-detected if installed" },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="shrink-0 font-mono text-[10px] text-accent-light w-[70px]">{r.label}</span>
            <span className="font-mono text-[10px] text-text-secondary">{r.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">Best for remote access</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 1 Card 3 — Cloudflare Tunnel
   ------------------------------------------------ */
function CloudflareCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Cloudflare Tunnel" sub="Universal · 3rd Path" />

      <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
        <GlobeIcon />
        <div>
          <p className="font-mono text-[11px] text-text-primary font-medium">Public Internet Tunnel</p>
          <p className="font-mono text-[10px] text-text-muted mt-0.5">No port forwarding, no firewall config</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {[
          { label: "Reach", detail: "Works from anywhere in the world" },
          { label: "Speed", detail: "Connects in under 5 seconds" },
          { label: "Security", detail: "No open ports on your machine" },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-2 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="shrink-0 font-mono text-[10px] text-accent-light w-[70px]">{r.label}</span>
            <span className="font-mono text-[10px] text-text-secondary">{r.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500/70" />
        <span className="font-mono text-[10px] text-text-muted">Best for quick sessions anywhere</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2 Card 1 — Peer-to-Peer Connection
   ------------------------------------------------ */
function P2PCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Peer-to-Peer" sub="Direct · Encrypted" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Once a signaling path is found, a direct WebRTC connection is established between your phone and desktop.
      </p>

      {/* Connection flow — user-friendly */}
      <div className="flex flex-col gap-1">
        {[
          { step: "Scan QR code", icon: "1" },
          { step: "Verify with Face ID / fingerprint", icon: "2" },
          { step: "Establish encrypted channel", icon: "3" },
          { step: "Start sending commands", icon: "4" },
        ].map((r) => (
          <div key={r.icon} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
            <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-accent/20 font-mono text-[10px] font-bold text-accent-light">{r.icon}</span>
            <span className="text-[12px] text-text-secondary">{r.step}</span>
          </div>
        ))}
      </div>

      {/* Key properties */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-2 text-center">
          <span className="block font-mono text-[11px] font-bold text-text-primary">30s</span>
          <span className="block font-mono text-[9px] text-text-muted mt-0.5">Keepalive interval</span>
        </div>
        <div className="rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-2 text-center">
          <span className="block font-mono text-[11px] font-bold text-text-primary">5x</span>
          <span className="block font-mono text-[9px] text-text-muted mt-0.5">Auto-reconnect attempts</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------
   Row 2 Card 2 — Pairing & Security
   ------------------------------------------------ */
function PairingCard() {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <CardHeader label="Pairing" sub="QR Code · Biometric" />

      <p className="text-[12px] text-text-secondary leading-relaxed">
        Two pairing modes to fit your workflow — quick one-time sessions or persistent always-on setups.
      </p>

      {/* Temp vs Permanent */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-amber-400/60" />
            <span className="font-mono text-[10px] font-bold text-amber-400/80 uppercase">Quick Session</span>
          </div>
          <p className="text-[11px] text-text-secondary leading-relaxed">Expires after 4 hours or when you disconnect</p>
          <p className="text-[10px] text-text-muted mt-1.5">No data persisted on device</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-green-400/60" />
            <span className="font-mono text-[10px] font-bold text-green-400/80 uppercase">Persistent</span>
          </div>
          <p className="text-[11px] text-text-secondary leading-relaxed">Stays active for 30 days with auto-reconnect</p>
          <p className="text-[10px] text-text-muted mt-1.5">Reconnects automatically</p>
        </div>
      </div>

      {/* Security highlights */}
      <div className="flex flex-col gap-1.5">
        {[
          { icon: <LockIcon />, text: "End-to-end encrypted with DTLS" },
          { icon: <FingerprintIcon />, text: "Biometric verification on every pair" },
          { icon: <RefreshIcon />, text: "Old tokens auto-revoked on re-pair" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
            <span className="text-accent-light/60 shrink-0">{r.icon}</span>
            <span className="text-[11px] text-text-secondary">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================
   Description cards
   ================================================ */
const descriptions = [
  {
    icon: <SignalIcon />,
    category: "CONNECTIVITY",
    title: "Automatic Path Discovery",
    desc: "Contop tries the fastest path first and falls back automatically. If your connection drops, it reconnects with smart backoff — no manual intervention needed.",
  },
  {
    icon: <ShieldIcon />,
    category: "ENCRYPTION",
    title: "End-to-End Encrypted",
    desc: "All data flows directly between your phone and desktop — encrypted with DTLS and verified with certificate fingerprints. Nothing passes through third-party servers.",
  },
  {
    icon: <KeyIcon />,
    category: "AUTHENTICATION",
    title: "Flexible Pairing",
    desc: "Quick sessions for one-time use, persistent connections for your daily setup. Each device gets one active token — re-pairing automatically revokes the old one.",
  },
];

/* ================================================
   Main section
   ================================================ */
export function ConnectionMethods() {
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
          Connectivity
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-2xl text-[15px] leading-relaxed text-text-secondary">
          Three connection paths, one seamless experience — your phone always finds the fastest route to your desktop.
        </p>
      </FadeUp>

      {/* Diagram rows — role="img" scoped to visual-only content */}
      <div
        role="img"
        aria-label="Connection methods: Row 1 shows three connection paths (LAN, Tailscale, Cloudflare Tunnel) with increasing reach. Row 2 shows the peer-to-peer connection flow and pairing options."
      >
        {/* Row 1: Connection Paths — 3 cards */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <LANCard />
              <TailscaleCard />
              <CloudflareCard />
            </div>
          </div>
        </FadeUp>

        {/* Row 2: P2P + Pairing — 2 cards */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              <P2PCard />
              <PairingCard />
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
    </div>
  );
}

/* ================================================
   Icons
   ================================================ */

function WifiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light/70">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" />
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

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light/70">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M12 3a4 4 0 0 0-4 4v4h8V7a4 4 0 0 0-4-4z" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
      <path d="M5 19.5C5.5 18 6 15 6 12c0-3.5 2.5-6 6-6 3 0 5.5 2 6 5" />
      <path d="M12 12c0 4-1 8-3.5 10.5" />
      <path d="M20 21c-1-2-2-5-2-9" />
      <path d="M12 12c0 3 .5 6 1.5 9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}
