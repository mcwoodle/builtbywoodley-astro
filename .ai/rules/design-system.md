# Design System

## Visual Identity & Mood:

- Palette: Warm, welcoming, tactile, and earthy. Strictly avoid stark, clinical pure white or brutalist high-contrast dark modes. Use creamy off-whites (like oatmeal or soft beige) for backgrounds, accented by rich, cinematic colors (warm greys, deep wood tones, muted olives, or terracotta).
- Aesthetic: High-end editorial magazine meets modern digital craftsmanship. It should feel human, optimistic, and grounded.
- Typography: Clean, highly legible, modern typography with a structured, grid-based layout that utilizes ample negative space so the content can breathe.

## Typography

- Define a simple type scale:
  - Display / hero text.
  - Section headings.
  - Body text.
  - Small/secondary text.
- Keep text readable:
  - Comfortable line-height.
  - Reasonable max-width for long-form content.

## Layout & Spacing

- Use a **4px or 8px spacing scale**; avoid arbitrary values.
- Constrain main content to a sensible **max-width** on large screens.
- Maintain consistent vertical rhythm between sections so scroll feels continuous.

## Motion & Interaction (Non-Library-Specific)

- Motion should be:
  - **Subtle** (short durations, modest distances).
  - **Purposeful** (communicate focus, hierarchy, or progress).
- Avoid motion that interferes with reading or basic navigation.
- Respect reduced-motion preferences where possible.

## Components & Tokens

- Prefer small, reusable primitives (buttons, cards, section shells).
- Centralize key design tokens:
  - Colors.
  - Font sizes and line-heights.
  - Spacing increments.
  - Border radii and shadows.
- Co-locate component-specific styles with their components, but base them on shared tokens to keep the system cohesive.
