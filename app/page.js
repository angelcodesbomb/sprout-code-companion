"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { NavBar } from "@/components/landing/NavBar";
import { HeroSection } from "@/components/landing/HeroSection";
import { TokenCostCallout } from "@/components/landing/TokenCostCallout";
import { StatsStrip } from "@/components/landing/StatsStrip";
import { WhySection } from "@/components/landing/WhySection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { TokenMath } from "@/components/landing/TokenMath";
import { QASection } from "@/components/landing/QASection";
import { LandingFooter } from "@/components/landing/LandingFooter";

// Dynamically import the Three.js blob — avoids SSR and defers WebGL bundle
// until after the page paints, keeping FCP fast.
const OnboardingBlobButton = dynamic(
  () =>
    import("@/components/landing/OnboardingBlobButton").then(
      (m) => m.OnboardingBlobButton
    ),
  { ssr: false, loading: () => null }
);

const navLinks = [
  { label: "Why it exists", to: "#why" },
  { label: "How it works",  to: "#how-it-works" },
  { label: "Token math",    to: "#token-math" },
  { label: "Workspace",     to: "/workspace" },
];

export default function LandingPage() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return (
    <main className="landing-page paper-grain">
      <NavBar
        links={navLinks}
        isDark={isDark}
        onThemeToggle={() => setIsDark((v) => !v)}
        ctaLabel="Get started"
      />

      {/* ── Hero — eyebrow now has typewriter ───────────────────────── */}
      <HeroSection
        title="Understand the code."
        italicText="Grow with confidence."
        description="Sprout turns tangled projects into visual maps and explains every line in language that actually makes sense."
        ctaLabel="Explore your codebase"
      />

      {/* ── Token cost callout (replaces FeatureGrid) ───────────────── */}
      <TokenCostCallout />

      {/* ── Stats strip ─────────────────────────────────────────────── */}
      <StatsStrip />

      {/* ── Why it exists ───────────────────────────────────────────── */}
      <WhySection />

      {/* ── How it works (timeline) ─────────────────────────────────── */}
      <HowItWorks />

      {/* ── Token math (with calculator) ────────────────────────────── */}
      <TokenMath />

      {/* ── Q&A ─────────────────────────────────────────────────────── */}
      <QASection />

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <LandingFooter />

      <OnboardingBlobButton />
    </main>
  );
}
