"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { NavBar } from "@/components/landing/NavBar";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureGrid } from "@/components/landing/FeatureGrid";

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
  { label: "Features", to: "#features" },
  { label: "Workspace", to: "/workspace" },
  { label: "Docs", to: "#features" },
];

const features = [
  {
    icon: "map",
    tone: "coral",
    title: "Visual File Map",
    description:
      "See your whole codebase as a living map. Follow connections without digging through folders.",
  },
  {
    icon: "explain",
    tone: "mint",
    title: "Plain-English Explanations",
    description:
      "Select any code and get a clear explanation of what it does and why it matters.",
  },
  {
    icon: "review",
    tone: "pink",
    title: "Smart, Lean Review",
    description:
      "Send only the right context to AI. Save tokens while keeping every review useful.",
  },
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
      <HeroSection
        eyebrow="YOUR CODEBASE, MADE CLEAR"
        title="Understand the code."
        italicText="Grow with confidence."
        description="Sprout turns tangled projects into visual maps and explains every line in language that actually makes sense."
        ctaLabel="Explore your codebase"
      />
      <FeatureGrid
        heading="From confusing code to a clear path forward."
        features={features}
      />
      <OnboardingBlobButton />
    </main>
  );
}
