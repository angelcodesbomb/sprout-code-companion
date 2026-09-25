import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/landing/NavBar";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { MascotChat } from "@/components/landing/MascotChat";

const navLinks = [{ label: "Features", to: "#features" }, { label: "Workspace", to: "/workspace" }, { label: "Docs", to: "#features" }];
const features = [
  { icon: "map", tone: "coral", title: "Visual File Map", description: "See your whole codebase as a living map. Follow connections without digging through folders." },
  { icon: "explain", tone: "mint", title: "Plain-English Explanations", description: "Select any code and get a clear explanation of what it does and why it matters." },
  { icon: "review", tone: "pink", title: "Smart, Lean Review", description: "Send only the right context to AI. Save tokens while keeping every review useful." },
];

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Sprout — Understand your codebase" },
    { name: "description", content: "Sprout maps your codebase and explains code in plain English." },
    { property: "og:title", content: "Sprout — Understand your codebase" },
    { property: "og:description", content: "A visual AI coding assistant for understanding every corner of your codebase." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ]}),
  component: Index,
});

function Index() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  return (
    <main className="landing-page paper-grain">
      <NavBar links={navLinks} isDark={isDark} onThemeToggle={() => setIsDark((value) => !value)} ctaLabel="Get started"/>
      <HeroSection eyebrow="YOUR CODEBASE, MADE CLEAR" title="Understand the code." italicText="Grow with confidence." description="Sprout turns tangled projects into visual maps and explains every line in language that actually makes sense." ctaLabel="Explore your codebase"/>
      <FeatureGrid heading="From confusing code to a clear path forward." features={features}/>
      <MascotChat name="Pip" greeting="Chat with" buttonLabel="Let's start"/>
    </main>
  );
}
