"use client";

import { useEffect, useRef, useState } from "react";
import { useGitHubRelease } from "@/hooks/useGitHubRelease";
import { useOSDetection, type OS } from "@/hooks/useOSDetection";

const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

type Platform = OS;

/* ================================================
   Animation helpers (inline per-section convention)
   ================================================ */

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

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return count.toString();
}

/* ================================================
   SVG Icons (inline — no external library)
   ================================================ */

function WindowsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 12.5h8V21l-8-1.15V12.5zm0-1h8V3L3 4.15V11.5zm9 1h9V22l-9-1.29V12.5zm0-1h9V2l-9 1.29V11.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 0 0-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 0 1-.004-.021l-.004-.024a1.807 1.807 0 0 1-.15.706.953.953 0 0 1-.213.335.71.71 0 0 0-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 0 0-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 0 0-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 0 0-.205.334 1.18 1.18 0 0 0-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 0 1-.018-.2v-.02a1.772 1.772 0 0 1 .15-.768 1.08 1.08 0 0 1 .43-.533.985.985 0 0 1 .594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 0 0-.166-.267.248.248 0 0 0-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 0 0-.12.27.944.944 0 0 0-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 0 1-.131.068 2.62 2.62 0 0 1-.275-.402 1.772 1.772 0 0 1-.155-.667 1.759 1.759 0 0 1 .08-.668 1.43 1.43 0 0 1 .283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 0 1 .016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 0 1-.448-.067 3.566 3.566 0 0 1-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 0 0-.402-.533 1.45 1.45 0 0 0-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 0 0 .314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 0 1 .647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 0 1-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 1.23 12.95 1 12 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SmartphoneIcon() {
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
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function MonitorIcon() {
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
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function BookIcon() {
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
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block ml-1"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* ================================================
   Platform card data
   ================================================ */

const RELEASES_URL = "https://github.com/slopedrop/contop/releases/latest";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.contop.mobile";
const APP_STORE_URL =
  "https://apps.apple.com/app/contop-mobile/id000000000";
const DOCS_URL = "https://docs.contop.app";

interface DesktopCard {
  platform: Platform;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  href: string;
}

const desktopCards: DesktopCard[] = [
  {
    platform: "windows",
    icon: <WindowsIcon />,
    name: "Windows",
    subtitle: "NSIS Installer (.exe)",
    href: RELEASES_URL,
  },
  {
    platform: "macos",
    icon: <AppleIcon />,
    name: "macOS",
    subtitle: "Universal Binary (.dmg)",
    href: RELEASES_URL,
  },
  {
    platform: "linux",
    icon: <LinuxIcon />,
    name: "Linux",
    subtitle: "AppImage",
    href: RELEASES_URL,
  },
];

interface MobileCard {
  platform: Platform;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  href: string;
}

const mobileCards: MobileCard[] = [
  {
    platform: "android",
    icon: <AndroidIcon />,
    name: "Android",
    subtitle: "Google Play Store",
    href: PLAY_STORE_URL,
  },
  {
    platform: "ios",
    icon: <AppleIcon />,
    name: "iOS",
    subtitle: "App Store",
    href: APP_STORE_URL,
  },
];

const descriptions = [
  {
    icon: <MonitorIcon />,
    category: "DESKTOP",
    title: "Desktop Agent",
    desc: "Control your computer with AI from anywhere. Windows, macOS, and Linux.",
  },
  {
    icon: <SmartphoneIcon />,
    category: "MOBILE",
    title: "Mobile Commander",
    desc: "Voice and text control from your phone. Android and iOS.",
  },
  {
    icon: <BookIcon />,
    category: "DOCS",
    title: "Documentation",
    desc: "Setup guides, API reference, skill authoring, and configuration.",
  },
];

/* ================================================
   Main section
   ================================================ */

export default function Downloads() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { os: detectedPlatform, isMobile } = useOSDetection();
  const { release } = useGitHubRelease();

  /* IntersectionObserver for scroll-triggered animations */
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

  const isDetected = (p: Platform) => detectedPlatform === p;

  return (
    <div ref={sectionRef} className="mx-auto max-w-5xl">
      {/* Header */}
      <FadeUp visible={visible} delay={0} className="mb-4 text-center">
        <h2 className="text-3xl font-bold tracking-[-0.02em] text-text-primary">
          Download
        </h2>
      </FadeUp>

      <FadeUp visible={visible} delay={50} className="mb-14 text-center">
        <p className="mx-auto max-w-lg text-[15px] leading-relaxed text-text-secondary">
          Get Contop running on your machine in minutes.
        </p>
        {release && (
          <div className="mt-3 flex items-center justify-center gap-4">
            <span className="inline-block rounded-full bg-accent/15 border border-accent/25 px-3 py-0.5 font-mono text-[11px] text-accent-light">
              {release.version}
            </span>
            {release.totalDownloads > 0 && (
              <span className="font-mono text-[11px] text-text-muted">
                {formatCount(release.totalDownloads)} downloads
              </span>
            )}
          </div>
        )}
      </FadeUp>

      <div
        role="img"
        aria-label="Download cards for Windows, macOS, Linux, Android, and iOS platforms with platform detection highlighting the recommended download for your device."
      >
        {/* Desktop Download Cards — 3-column grid */}
        <FadeUp visible={visible} delay={100} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              {desktopCards.map((card) => {
                const detected = isDetected(card.platform);
                const liveAsset =
                  card.platform === "windows" ? release?.assets.windows :
                  card.platform === "macos" ? release?.assets.macos : null;
                const href = liveAsset?.url || card.href;
                return (
                  <div key={card.platform} className="relative p-5 sm:p-6">
                    {detected && (
                      <div className="absolute top-3 right-3">
                        <span className="inline-block rounded-full bg-accent-light/20 border border-accent-light/30 px-2.5 py-0.5 font-mono text-[9px] text-accent-light tracking-wide">
                          Recommended
                        </span>
                      </div>
                    )}

                    <div
                      className={`mb-4 ${detected ? "text-accent-light" : "text-text-secondary"}`}
                    >
                      {card.icon}
                    </div>

                    <h3 className="text-[16px] font-semibold text-text-primary mb-1">
                      {card.name}
                    </h3>
                    <p className="font-mono text-[11px] text-text-muted mb-4">
                      {card.subtitle}
                      {liveAsset && (
                        <span className="ml-2 text-text-muted/60">
                          ({formatBytes(liveAsset.size)})
                        </span>
                      )}
                    </p>

                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        detected
                          ? "inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-1.5 text-xs font-medium tracking-[0.06em] uppercase text-text-primary transition-all duration-200 hover:bg-accent-light hover:shadow-[0_0_20px_rgba(9,91,185,0.3)]"
                          : "inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-5 py-1.5 text-xs font-medium tracking-[0.06em] uppercase text-text-secondary transition-all duration-200 hover:bg-white/[0.08] hover:text-text-primary"
                      }
                    >
                      <DownloadIcon />
                      Download
                    </a>

                    <p className="mt-3 font-mono text-[10px] text-text-muted">
                      Requires: Python 3.12+
                    </p>

                    {card.platform === "linux" && (
                      <p className="mt-1 font-mono text-[9px] text-text-muted/60">
                        .deb also available
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </FadeUp>

        {/* Mobile Download Cards — 2-column grid */}
        <FadeUp visible={visible} delay={250} className="mb-3">
          <div className="arch-container">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.04]">
              {mobileCards.map((card) => {
                const detected = isDetected(card.platform);
                return (
                  <div key={card.platform} className="relative p-5 sm:p-6">
                    {detected && (
                      <div className="absolute top-3 right-3">
                        <span className="inline-block rounded-full bg-accent-light/20 border border-accent-light/30 px-2.5 py-0.5 font-mono text-[9px] text-accent-light tracking-wide">
                          Recommended
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-5">
                      {/* QR Code placeholder — desktop only */}
                      <div className="hidden md:flex flex-col items-center gap-2 shrink-0">
                        <div className="flex items-center justify-center w-[120px] h-[120px] rounded-lg border border-white/[0.06] bg-white/[0.02]">
                          <div className="flex flex-col items-center gap-1.5 text-text-muted">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="7" height="7" />
                              <rect x="14" y="3" width="7" height="7" />
                              <rect x="3" y="14" width="7" height="7" />
                              <rect x="14" y="14" width="3" height="3" />
                              <line x1="21" y1="14" x2="21" y2="14.01" />
                              <line x1="21" y1="21" x2="21" y2="21.01" />
                              <line x1="17" y1="18" x2="17" y2="18.01" />
                            </svg>
                            <span className="font-mono text-[9px] tracking-wide uppercase">
                              Coming Soon
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-[8px] text-text-muted/50">
                          Scan to download
                        </span>
                      </div>

                      {/* Card info + link */}
                      <div className="flex flex-col">
                        <div
                          className={`mb-3 ${detected ? "text-accent-light" : "text-text-secondary"}`}
                        >
                          {card.icon}
                        </div>

                        <h3 className="text-[16px] font-semibold text-text-primary mb-1">
                          {card.name}
                        </h3>
                        <p className="font-mono text-[11px] text-text-muted mb-4">
                          {card.subtitle}
                        </p>

                        {/* Store link — mobile/tablet only */}
                        <a
                          href={card.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`md:hidden ${
                            detected
                              ? "inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-1.5 text-xs font-medium tracking-[0.06em] uppercase text-text-primary transition-all duration-200 hover:bg-accent-light hover:shadow-[0_0_20px_rgba(9,91,185,0.3)] w-fit"
                              : "inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-5 py-1.5 text-xs font-medium tracking-[0.06em] uppercase text-text-secondary transition-all duration-200 hover:bg-white/[0.08] hover:text-text-primary w-fit"
                          }`}
                        >
                          <DownloadIcon />
                          {card.platform === "android"
                            ? "Google Play"
                            : "App Store"}
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </FadeUp>
      </div>

      {/* Docs Gateway Callout */}
      <FadeUp visible={visible} delay={400} className="mb-3">
        <div className="arch-container">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 sm:p-6">
            <div>
              <h3 className="text-[16px] font-semibold text-text-primary mb-1">
                Developer Documentation
              </h3>
              <p className="text-[13px] leading-relaxed text-text-secondary">
                Setup guides, API reference, skill authoring, and
                configuration.
              </p>
            </div>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-5 py-1.5 text-xs font-medium tracking-[0.06em] uppercase text-accent-light transition-all duration-200 hover:bg-accent/20 hover:border-accent/50"
            >
              Read the Docs
              <ArrowRightIcon />
            </a>
          </div>
        </div>
      </FadeUp>

      {/* Description cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {descriptions.map((d, i) => (
          <FadeUp key={i} visible={visible} delay={500 + i * 80}>
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
