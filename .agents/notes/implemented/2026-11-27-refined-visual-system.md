# Agent Note: Refined visual system

Status: implemented

## Problem

The interface read as a prototype rather than a finished reading tool. Interface text was set between 7 and 11 pixels, with monospace for labels, metadata, and form fields, so most of the chrome was hard to read. Green, coral, and lime competed as accents, and decorations such as the dashed upload border, its corner brackets, and the hand-drawn underline drew attention away from the upload action. The dark theme was a green-tinted variant rather than a neutral one. The stylesheet had also grown by appending override layers, so one component's final appearance was spread across several blocks and `body.is-dark` exceptions.

## Decision

`public/styles.css` is one token-driven visual system. Colors, shadows, radii, and font stacks are custom properties on `:root`. The dark theme redefines those tokens under the existing `body.is-dark` class, so components rarely need a dark-specific rule. The palette is a warm neutral one with a single deep-green accent, used for focus, active, and ready states. Primary actions and the brand mark use the deep accent green in the light theme and a near-white fill in the dark theme. Depth comes from hairline borders and layered soft shadows instead of colored outlines.

Interface text uses an 11.5–15.5px scale in the platform's system sans-serif. Monospace is limited to Base URL and API key values. The Library headline pairs a display sans with a serif italic accent word. Every font is a system font stack (SF Pro, Iowan Old Style, and SF Mono on Apple platforms, with Inter, Segoe UI, and Georgia-class fallbacks elsewhere), so the reader serves no font files and stays fully offline.

The Library upload card is a solid surface whose dashed drop guide appears only while a file is dragged over it. Recents rows reveal their delete control on hover or focus, and it is always visible on devices without hover. In reading mode the control strip is forty-four pixels tall, slightly translucent, and groups page and zoom controls into recessed segments instead of separating them with dividers. Thumbnails fill a 132-pixel slot, with the page number below, and are drawn at the display's pixel density up to the 2× cap the main page uses, so they are not stretched on a high-density screen. The reading stage, like the side panels, uses thin scrollbars in the theme's colors. Overlay panels cast their shadow only while open.

Markup, element IDs, class names toggled by browser code, layout breakpoints, and grid mechanics are unchanged. The canvas frame's margin stays within the 28 pixels per side that fit-to-view reserves. The stage is a grid whose side tracks are at least 24 pixels wide, so a page zoomed past the stage keeps that gutter at both ends of its scroll range instead of touching the panels.

## Alternatives considered

**Tune sizes and colors inside the existing stylesheet.** This would be a smaller diff, but each component's appearance would stay split across its original rule, the later override layers, and dark-theme exceptions. Further visual work would remain error-prone.

**Bundle a web font such as Inter or a serif display face.** This would make the rendering identical across platforms, but it adds binary assets to the npm package and a load-time dependency for every page. The system faces on each platform already read well at these sizes.

**Adopt a CSS framework or component library.** It would bring a ready-made design language, but it contradicts the [architecture's](../../../docs/architecture.md) choice of repository-owned CSS without a UI framework. It would also add a runtime or build dependency.

**Ink-black primary buttons in the light theme.** Near-black fills read as premium in isolation, but against the warm-neutral page they were the heaviest thing on screen and looked harsher than the rest of the system. The accent green keeps the primary action prominent with less weight, and it is the color the product already uses for its active states.

**Keep the multi-accent palette and refine it.** The coral and lime accents gave the Library some personality, but three accents competed for attention on a screen with one primary action, and no state needed them.

## Consequences

- Interface text is readable at normal viewing distances, and the controls look settled rather than provisional.
- A visual change is a token edit in one place. A new component should use the existing tokens rather than literal colors, so that both themes keep working.
- A thumbnail canvas holds up to four times the pixels it did at one device pixel per CSS pixel. Thumbnails are still drawn only near the visible part of the rail.
- Rendering varies a little by platform because the fonts are system fonts. The screenshots used for review come from a Linux container, where Inter and Liberation Serif stand in.
- The reader strip is four pixels taller than the [focused reader chrome](2026-08-28-focused-reader-chrome.md) originally specified, so it gives the page that much less height in exchange for comfortable click targets.
- The dashed drop guide and the delete control in Recents depend on hover and drag states, so touch devices keep the delete control visible.
