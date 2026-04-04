"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useGitHubStars } from "@/hooks/useGitHubStars";

const NAV_LINKS = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Agent & Tools", href: "#agent-tools" },
  { label: "Skills", href: "#skills" },
  { label: "Security", href: "#security" },
  { label: "Use Cases", href: "#use-cases" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileVisible, setMobileVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const stars = useGitHubStars();

  // Animate mobile menu open/close
  useEffect(() => {
    if (mobileOpen) {
      setMobileVisible(true);
    } else if (mobileVisible) {
      // Delay unmount to allow exit animation
      const timer = setTimeout(() => setMobileVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [mobileOpen, mobileVisible]);

  // Close mobile menu on Escape
  useEffect(() => {
    if (!mobileOpen) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Focus trap in mobile menu
  useEffect(() => {
    if (!mobileOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const focusableEls = menu.querySelectorAll<HTMLElement>(
      'a[href], button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableEls.length === 0) return;

    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];
    firstEl.focus();

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [mobileOpen]);

  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      setMobileOpen(false);
      // F9: If hash link and not on homepage, navigate to homepage + hash
      if (href.startsWith("#")) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth" });
        }
        // If target not found (e.g. on /how-it-works), let default <a> navigate to /#section
      }
    },
    []
  );

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-glass-bg backdrop-blur-[16px]"
        style={{ WebkitBackdropFilter: "blur(16px)" }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-1.5 text-xl font-bold text-text-primary tracking-tight">
            <svg viewBox="0 0 512 512" className="h-8 w-8 text-accent" fill="none" aria-hidden="true">
              <rect x="106" y="106" width="150" height="300" rx="14" stroke="currentColor" strokeWidth="36" fill="#000"/>
              <rect x="166" y="256" width="240" height="150" rx="12" stroke="currentColor" strokeWidth="36" fill="#000"/>
              <polyline points="226,298 270,331 226,364" stroke="currentColor" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <line x1="288" y1="364" x2="356" y2="364" stroke="currentColor" strokeWidth="28" strokeLinecap="round"/>
            </svg>
            Contop
          </Link>

          {/* Desktop nav links */}
          <div className="hidden items-center gap-2 lg:gap-5 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href.startsWith("#") ? `/${link.href}` : link.href}
                onClick={(e) => handleNavClick(e, link.href)}
                className="text-[9px] lg:text-[11px] tracking-[0.08em] uppercase text-text-secondary transition-colors duration-200 hover:text-text-primary whitespace-nowrap"
              >
                {link.label}
              </a>
            ))}
            <a
              href="https://docs.contop.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] lg:text-[11px] tracking-[0.08em] uppercase text-text-secondary transition-colors duration-200 hover:text-text-primary whitespace-nowrap"
            >
              Docs
            </a>
          </div>

          {/* Right side: GitHub + Download + Hamburger */}
          <div className="flex items-center gap-4">
            {/* GitHub star badge */}
            <a
              href="https://github.com/slopedrop/contop"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-text-secondary transition-colors duration-200 hover:text-text-primary"
            >
              <svg
                viewBox="0 0 16 16"
                width="18"
                height="18"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              {stars && (
                <span className="text-[11px] font-medium tracking-wide">{stars}</span>
              )}
            </a>

            {/* Download CTA */}
            <a
              href="#download"
              className="rounded-full bg-accent px-5 py-1.5 text-xs font-medium tracking-[0.06em] uppercase text-text-primary transition-all duration-200 hover:bg-accent-light hover:shadow-[0_0_20px_rgba(9,91,185,0.3)]"
            >
              Download
            </a>

            {/* Hamburger button (mobile only) */}
            <button
              type="button"
              className="flex items-center justify-center md:hidden"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                // Close icon (X)
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-primary">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              ) : (
                // Hamburger icon
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-primary">
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      {mobileVisible && (
        <div ref={menuRef} className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop */}
          <div
            className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${mobileOpen ? "opacity-100" : "opacity-0"}`}
            onClick={() => setMobileOpen(false)}
          />

          {/* Menu panel */}
          <div
            className={`absolute top-16 left-0 right-0 border-b border-white/[0.06] bg-glass-bg backdrop-blur-[16px] transition-all duration-200 ${mobileOpen ? "animate-slide-down" : "opacity-0 -translate-y-2"}`}
            style={{ WebkitBackdropFilter: "blur(16px)" }}
          >
            <div className="flex flex-col gap-1 px-4 py-4">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href.startsWith("#") ? `/${link.href}` : link.href}
                  onClick={(e) => handleNavClick(e, link.href)}
                  className="rounded-radius-md px-3 py-3 text-base text-text-secondary transition-colors hover:bg-white/[0.04] hover:text-text-primary"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="https://docs.contop.app"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-radius-md px-3 py-3 text-base text-text-secondary transition-colors hover:bg-white/[0.04] hover:text-text-primary"
              >
                Docs
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
