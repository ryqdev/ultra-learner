# Agent Note: Refined visual system

Status: implemented

## Problem

The interface read as a prototype rather than a finished reading tool. Interface text was set between 7 and 11 pixels, with monospace for labels, metadata, and form fields, so most of the chrome was hard to read. Green, coral, and lime competed as accents, and decorations such as the dashed upload border, its corner brackets, and the hand-drawn underline drew attention away from the upload action. The dark theme was a green-tinted variant rather than a neutral one. The stylesheet had also grown by appending override layers, so one component's final appearance was spread across several blocks and `body.is-dark` exceptions.

## Decision

`public/styles.css` is one token-driven visual system. Colors, shadows, radii, and font stacks are custom properties on `:root`. The dark theme redefines those tokens under the existing `body.is-dark` class, so components rarely need a dark-specific rule. The palette is a cool-neutral, minimalist one modeled after Antigravity: a porcelain off-white sidebar (`#f8f8f9`) frames a rounded pure-white workspace sheet (`#ffffff`) in the light theme, paired with cool obsidian surfaces in the dark theme. Primary actions are monochrome (near-black in light mode, near-white in dark mode) with pill buttons for key calls to action; a crisp blue accent handles focus rings, active page thumbnails, and text selection, while an emerald status dot signals a ready model configuration. Depth comes from hairline borders and whisper-soft shadows instead of heavy outlines or colored gradients.

Interface text uses an 11.5–14.5px scale in the platform's system sans-serif, with a calm centered medium-weight display headline above a subtle translucent emblem on the Library screen. Monospace is limited to Base URL and API key values. Every font is a system font stack (SF Pro and SF Mono on Apple platforms, with Inter and Segoe UI fallbacks elsewhere), so the reader serves no font files and stays fully offline.

The Library upload card adopts a rounded floating composer tray with a subtle top metadata bar and a dashed drop guide that appears only while a file is dragged over it. Recents rows use lightweight document glyphs and reveal their delete control on hover or focus, keeping it visible on devices without hover. In reading mode the control strip is forty-four pixels tall, slightly translucent, and groups page and zoom controls into recessed pill segments instead of separating them with dividers. Thumbnails are shown at their 132-pixel render width, with the page number below. Overlay panels cast their shadow only while open.

Element IDs, class names toggled by browser code, layout breakpoints, and grid mechanics are unchanged. The canvas frame's margin stays within the 28 pixels per side that fit-to-view reserves.

## Alternatives considered

**Tune sizes and colors inside the existing stylesheet.** This would be a smaller diff, but each component's appearance would stay split across its original rule, the later override layers, and dark-theme exceptions. Further visual work would remain error-prone.

**Bundle a web font such as Inter or a serif display face.** This would make the rendering identical across platforms, but it adds binary assets to the npm package and a load-time dependency for every page. The system faces on each platform already read well at these sizes.

**Adopt a CSS framework or component library.** It would bring a ready-made design language, but it contradicts the [architecture's](../../../docs/architecture.md) choice of repository-owned CSS without a UI framework. It would also add a runtime or build dependency.

**Keep a warm cream-and-green editorial palette with a serif accent word.** Warm paper tints and deep-green chrome read like a traditional book app, whereas a cool-neutral porcelain-and-white palette with monochrome primary controls and blue focus rings matches Antigravity's calm, modern workspace aesthetic and keeps the PDF page itself as the sole visual focal point.

**Keep the multi-accent palette and refine it.** The coral and lime accents gave the Library some personality, but three accents competed for attention on a screen with one primary action, and no state needed them.

## Consequences

- Interface text is readable at normal viewing distances, and the controls look settled rather than provisional.
- A visual change is a token edit in one place. A new component should use the existing tokens rather than literal colors, so that both themes keep working.
- Rendering varies a little by platform because the fonts are system fonts. The screenshots used for review come from a Linux container, where Inter/system sans stands in.
- The reader strip is four pixels taller than the [focused reader chrome](2026-08-28-focused-reader-chrome.md) originally specified, so it gives the page that much less height in exchange for comfortable click targets.
- The dashed drop guide and the delete control in Recents depend on hover and drag states, so touch devices keep the delete control visible.
