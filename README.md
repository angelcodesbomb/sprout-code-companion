# Sprout Code Companion

Build a Next.js (App Router, JavaScript — NOT TypeScript, use .jsx/.js files only, no .tsx, no type annotations) frontend-only UI mockup for a developer tool called "Sprout" — an AI coding assistant that shows a visual map of a codebase and explains code in plain English. This is UI/UX only — no real backend logic, use mock/placeholder data and props everywhere so functionality can be wired in later. Structure all components modularly in clearly named folders (components/landing, components/dashboard, components/filemap, components/editor, components/agents) so each piece can be imported independently later.

DESIGN SYSTEM (this is the most important part — follow it precisely, do not default to generic SaaS/shadcn styling):

Color palette:

- Light mode background: warm off-white/beige (#F7F3EC or similar), with a very subtle paper grain texture overlay

- Dark mode: ONLY the background changes, to a warm dark charcoal (#1C1B1A), NOT pure black. All accent colors stay identical and saturated in both modes.

- Accent colors used throughout for buttons, tags, highlights: coral/terracotta orange (#E8795A), mint/teal (#7DD3C0), soft cyan (#8FD8E8), and a muted pink (#F0A8C0). Use these as accents on cards, buttons, status indicators — not as backgrounds.

- Text: near-black ink (#2A2620) in light mode, warm off-white in dark mode.

Typography:

- Large headlines: a bold, elegant serif font (like Fraunces or Playfair Display), sometimes with an italic treatment for emphasis

- Body/UI text: a clean, slightly rounded sans-serif (like General Sans or Inter)

- Small tags, code, and status labels: a monospace font for a technical feel

Borders and shapes — this is critical for the "not vibe-coded" look:

- Do NOT use plain 1px rounded-rectangle borders everywhere. Use thick (2-3px) hand-drawn-feeling borders with slightly organic, imperfect rounded corners on cards, buttons, and panels — like a sketched outline rather than a CSS default.

- Pill-shaped buttons with a small arrow icon, similar to a friendly editorial website

- Decorative small stamp/seal/badge illustration elements in corners of sections (simple circular badge shapes)

- A few sections should have a subtle vintage paper/grain texture, not flat color

Illustration and mascot:

- Include a friendly character avatar (simple flat illustration, circular, like a small persona) in the bottom-right corner as a "chat with your assistant" widget — a rounded card with the character, a name, and a "Let's start" pill button, with a subtle floating/breathing animation (scale 1 to 1.02 loop)

- Use simple line-art decorative illustrations (a subtle abstract tree/network doodle in the hero background, low opacity) rather than stock icons

Animations (use Framer Motion):

- Buttons: scale up slightly + shadow lift on hover, spring transition

- Cards: fade + slide up on scroll into view, staggered

- Page/section transitions: smooth fade

- Dark mode toggle: smooth color transition, not instant, styled as a small pill switch with a sun/moon icon that slides

PAGES/VIEWS TO BUILD:

1. Landing page: Nav bar with logo mark + links + a "Get Started" pill button. Large serif hero headline with subheadline, a primary CTA pill button, decorative background illustration, and the corner mascot chat widget. Below the fold, a 3-column feature section (Visual File Map / Plain-English Code Explanations / Smart Token-Saving Review) each as a hand-bordered card with an icon and short copy.

2. Dashboard shell: A left sidebar showing 6 "agent" avatars/icons in a vertical list (UI, Database, API, Review, Security, Validation) each as a small rounded card with a name, a colored status dot (idle/active pulse animation), and hover tooltip. Main content area is a flexible panel for the views below.

3. File System Map view: A visual tree/node map of a mock file structure (5-6 example files/folders) rendered as connected rounded boxes (use a simple custom layout, not a plain list). On hovering a file node, show an animated tooltip/popup card (styled like a flip-card, hand-bordered) with a one-line plain-English description of what that file does.

4. Code viewer/explainer view: A mock code editor panel (monospace font, line numbers, syntax-highlighted-looking placeholder text) where selecting a block of text triggers a side panel or popup card that says "Here's what this does" with a plain-English mock explanation, styled with the same hand-drawn border and a small animated appearance (slide in from the right).

5. Settings/dark mode: A toggle in the nav bar switching the whole app between light and dark background per the rules above, animated smoothly.

Make sure every component takes props for its content (agent names, file names, descriptions, code text) rather than hardcoding text inline, so I can pass real data in later. Keep the whole build as ONE cohesive response — do not ask clarifying questions, make reasonable design decisions and build the complete set of pages and components now.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/06d57d25-529f-41cb-9514-c95407ad10b8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
