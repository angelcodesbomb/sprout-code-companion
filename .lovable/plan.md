# Sprout UI mockup

## Build
- Replace the blank home screen with a cohesive Sprout landing page using the specified warm paper aesthetic, serif editorial typography, hand-drawn borders, accent palette, network doodles, feature cards, dark-mode switch, and animated assistant widget.
- Add a dashboard workspace with a six-agent sidebar and switchable File Map and Code Explainer views, all powered by mock props and local UI state only.
- Build the file map as connected organic nodes with animated explanation popovers, and the code viewer with selectable mock blocks plus a sliding plain-English explanation panel.
- Organize reusable pieces under `components/landing`, `components/dashboard`, `components/filemap`, `components/editor`, and `components/agents`.

## Interaction and polish
- Use Motion for spring button interactions, staggered scroll reveals, view fades, pulsing agent status, tooltip transitions, and the mascot’s subtle breathing loop.
- Apply smooth global light/dark transitions where only the warm page background and readable text/surfaces adapt; coral, mint, cyan, and pink accents remain unchanged.
- Verify the landing page and dashboard at desktop and mobile sizes, including navigation, view switching, node popovers, code explanations, and dark mode.

## Technical note
- This workspace uses TanStack Start rather than Next.js, so the same React UI and modular architecture will be implemented in the supported stack. Existing framework bootstrap files remain TypeScript where required; all newly created Sprout components will use JavaScript/JSX without type annotations.
