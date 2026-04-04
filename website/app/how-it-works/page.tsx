"use client";

import { ScrollScene } from "@/components/ui/ScrollScene";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { AutoplayToggle } from "@/components/ui/AutoplayToggle";
import { CinematicExplainer } from "@/components/sections/explainer/CinematicExplainer";

export default function HowItWorksPage() {
  return (
    <ScrollScene>
      {/* <ProgressBar /> */}
      <main>
        <CinematicExplainer />
      </main>
      <AutoplayToggle />
    </ScrollScene>
  );
}
