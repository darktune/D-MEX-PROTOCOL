# Design System: Tactical Intelligence & Agentic Flow

## 1. Overview & Creative North Star
The "Creative North Star" for this design system is **The Arbiter’s Terminal**. 

This system is not a standard web dashboard; it is a high-stakes command center for the GameFi/DeFi frontier. We are moving away from the "friendly SaaS" look toward a signature aesthetic defined by **Kinetic Depth** and **Asymmetric Authority**. By utilizing deep blacks and a high-contrast neon palette, we create an environment that feels both agentic and secure. The UI should feel like a piece of advanced hardware—precise, heavy, and intentional.

We break the "template" look by avoiding rigid, centered grids. Instead, we favor a functional asymmetry where data visualizations and real-time logs dictate the layout's flow, creating a sense of live, breathing intelligence.

---

## 2. Colors
Our palette is rooted in the void. We use the extreme contrast between absolute blacks and vibrant neon signals to guide the user’s eye toward critical decision-making nodes.

- **Primary (`#9fff88`)**: Used exclusively for "Active," "Safe," and "Success" states. It is the color of progress.
- **Tertiary/Error (`#ff7162`)**: Reserved for risk, rejection, and high-alert signals. Use sparingly to maintain its psychological impact.
- **The "No-Line" Rule**: To achieve a premium, high-tech feel, **1px solid borders are prohibited** for sectioning. Structural boundaries must be defined solely through background color shifts. For example, a `surface-container-low` component should sit directly on a `surface` background. The change in tonal depth is the divider.
- **Surface Hierarchy & Nesting**: Treat the UI as layers of physical obsidian. 
    - Base: `surface` (#0e0e0e)
    - Primary Containers: `surface-container` (#191919)
    - Interactive Nodes: `surface-container-highest` (#262626)
- **The "Glass & Gradient" Rule**: Floating modals and overlays must utilize Glassmorphism. Use semi-transparent surface colors with a `20px` to `40px` backdrop-blur. 
- **Signature Textures**: For primary CTAs, use a subtle linear gradient from `primary` to `primary-container`. This adds a "weighted" feel to buttons, making them feel like physical illuminated toggles rather than flat digital boxes.

---

## 3. Typography
Typography is our primary tool for authority. We pair a high-character display face with technical, high-legibility body and mono fonts.

- **Display & Headline (Space Grotesk)**: This font’s aggressive, geometric ink traps convey a "gaming edge" without losing professional credibility. Use `display-lg` (3.5rem) for high-impact stats like Protocol Safety Ratios.
- **Title & Body (Manrope)**: A clean, modern sans-serif that balances the intensity of the display face. Manrope provides the "Secure" and "Professional" vibe required for DeFi operations.
- **Labels & Logs (Inter & Monospace)**: Use `label-sm` (Inter) for metadata. All real-time transaction logs and system outputs must use a monospace font to reinforce the "terminal" aesthetic.

---

## 4. Elevation & Depth
In this system, elevation is not about "up"; it’s about "glow" and "layering."

- **The Layering Principle**: Depth is achieved by stacking. Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a soft, natural "recessed" look, common in high-end automotive interfaces.
- **Ambient Shadows**: Shadows are strictly prohibited on flat containers. When an element is truly "floating" (like a Guardian AI Setting popup), use an extra-diffused shadow: `0px 24px 48px rgba(0, 0, 0, 0.8)`.
- **The "Ghost Border" Fallback**: If a container needs more definition against a complex background (like a chart), use a "Ghost Border": the `outline-variant` token at **15% opacity**.
- **Glow as Status**: Instead of traditional shadows, use outer glows for active states. A `primary` element should have a subtle, color-matched ambient glow to indicate it is "online."

---

## 5. Components

### Buttons & Inputs
- **Primary Button**: Solid `primary` background with `on-primary` text. Use `xl` (0.75rem) roundedness for a modern, tactile feel.
- **Secondary/Ghost Button**: No background. `outline-variant` ghost border (20% opacity). On hover, transition to a semi-transparent `surface-bright`.
- **Input Fields**: Must use `surface-container-highest`. No borders. Use a `2px` bottom-accent of `primary` only when the field is focused.

### Technical Data Viz
- **Gauges & Progress**: Use the `primary` neon green for "Safe" ranges and `tertiary` for "Risk." Use a heavy stroke weight (8px+) to ensure the color feels impactful.
- **Line Charts**: Use a `primary-dim` stroke with a subtle glow. The area under the line should have a vertical gradient fading from `primary` (10% opacity) to `transparent`.

### Cards & Lists
- **Prohibit Dividers**: Use `spacing-lg` or a shift from `surface-container` to `surface-container-low` to separate items in a list.
- **Glassmorphic Cards**: Used for "Guardian AI" or "Portfolio" overlays. `Backdrop-blur: 12px` and a `surface-variant` fill at 60% opacity.

### Additional Components: The "Live Log"
- A dedicated right-aligned or bottom-aligned panel using Monospace text. 
- Prefix every line with a `>` character. 
- Successes in `primary`, warnings in `tertiary`, and standard telemetry in `on-surface-variant`.

---

## 6. Do's and Don'ts

### Do
- **DO** use asymmetry. Position your "Arbiter Guardian" panel to one side to create a sophisticated, non-template layout.
- **DO** use "Primary" sparingly. If everything glows green, nothing is important.
- **DO** leverage the `surface-container` tiers to create "wells" for data—making information feel nested and protected.

### Don't
- **DON'T** use 100% white (#FFFFFF) for body text. Use `on-surface-variant` (#ababab) to reduce eye strain in dark mode, reserving pure white for `headline` levels.
- **DON'T** use standard 1px borders. They break the "Liquid Obsidian" feel of the interface.
- **DON'T** use generic "drop shadows." If an element needs to stand out, use tonal shifts or backdrop blurs.