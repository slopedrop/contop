import { Footer } from "@/components/layout/Footer";
import AgentTools from "@/components/sections/AgentTools";
import ModelProviders from "@/components/sections/ModelProviders";
import Security from "@/components/sections/Security";
import Skills from "@/components/sections/Skills";
import UseCases from "@/components/sections/UseCases";
import { ConnectionMethods } from "@/components/sections/ConnectionMethods";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import Downloads from "@/components/sections/Downloads";
import { WavyBackground } from "@/components/ui/wavy-background";

export default function Home() {
  return (
    <>
      <main className="min-h-screen pt-16">
        {/* Atmosphere — wavy canvas background */}
        <WavyBackground
          containerClassName="!fixed !inset-0 !h-auto !w-full !-z-10 !pointer-events-none !items-start !justify-start"
          backgroundFill="#000000"
          blur={6}
          speed="slow"
          waveOpacity={0.15}
          waveWidth={15}
          colors={["#095BB9", "#1d4ed8", "#06B6D4", "#7C3AED", "#095BB9"]}
        />

        {/* Hero */}
        <section className="relative flex min-h-[90vh] items-center px-6 pt-16 sm:px-8 sm:pt-20">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <div>
              {/* Status chip */}
              <div className="hero-animate hero-animate-delay-1 mb-8 inline-flex items-center gap-2.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-1.5">
                <span className="status-dot inline-block h-1.5 w-1.5 rounded-full bg-accent-light" />
                <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-text-muted">
                  Open Source &middot; Remote Compute Agent
                </span>
              </div>

              {/* Headline */}
              <h1 className="hero-animate hero-animate-delay-2">
                <span className="block text-[clamp(2rem,5vw,3.5rem)] font-medium leading-[1.1] tracking-[-0.01em] text-text-secondary">
                  Your Desktop,
                </span>
                <span className="block text-[clamp(2.5rem,6.5vw,5rem)] font-extrabold leading-[1] tracking-[-0.03em] text-text-primary">
                  From Anywhere
                </span>
              </h1>

              {/* Accent line */}
              <div className="hero-animate hero-animate-delay-3 mx-auto mt-8 h-px w-16 bg-accent" />

              {/* Subtitle */}
              <p className="hero-animate hero-animate-delay-3 mx-auto mt-6 max-w-md text-[15px] leading-relaxed text-text-secondary">
                A remote compute agent that gives you full AI desktop
                control from your phone — real-time screen streaming,
                text or voice input, and autonomous task execution.
              </p>

              {/* CTA buttons */}
              <div className="hero-animate hero-animate-delay-4 mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
                <a
                  href="#download"
                  className="cta-primary rounded-full bg-accent px-7 py-2.5 text-center text-[13px] font-semibold tracking-[0.06em] uppercase text-text-primary transition-all duration-300 hover:bg-accent-light"
                >
                  Get Started
                </a>
                <a
                  href="https://github.com/slopedrop/contop"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl px-7 py-2.5 text-center text-[13px] font-semibold tracking-[0.06em] uppercase text-text-secondary transition-all duration-300 hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-text-primary"
                  style={{ WebkitBackdropFilter: "blur(24px)" }}
                >
                  View on GitHub
                </a>
              </div>
            </div>

          </div>
        </section>

        {/* Scroll target sections */}
        <section id="how-it-works" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="How It Works">
          <HowItWorks />
        </section>

        <section id="connectivity" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Connectivity">
          <ConnectionMethods />
        </section>

        <section id="features" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Features">
          <Features />
        </section>

        <section id="agent-tools" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Agent and automation tools">
          <AgentTools />
        </section>

        <section id="model-providers" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Model Providers">
          <ModelProviders />
        </section>

        <section id="skills" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Skills">
          <Skills />
        </section>

        <section id="security" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Security">
          <Security />
        </section>

        <section id="use-cases" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Use Cases">
          <UseCases />
        </section>

        <section id="download" className="min-h-[50vh] py-24 px-6 sm:px-8" aria-label="Download">
          <Downloads />
        </section>
      </main>

      <Footer />
    </>
  );
}
