# Agent Note: Remembered theme with a control while reading

Status: implemented

## Problem

The dark theme was a class toggled on `<body>` and nothing else. Every reload returned to light, the reader ignored a system that was set to dark, and the only toggle lived in the top bar, which [the focused reader chrome](2026-08-28-focused-reader-chrome.md) hides while a document is open. A learner who wanted to change theme mid-reading had to go back to the Library, and had to repeat the choice on every visit.

## Decision

An explicit choice is stored in origin-scoped `localStorage` under `ultra-learner.theme` as `dark` or `light`. With no stored choice the reader follows `prefers-color-scheme` as it is when the page loads. A short inline script at the top of `<body>` applies the theme before first paint; the browser entry then only reflects that state on the controls and handles the toggle. The reader's control strip gains a second theme button beside the AI Guide trigger, kept in step with the top bar's.

Both buttons show the icon of the theme they switch to: a moon in the light theme and a sun in the dark one. The browser entry also copies the `--canvas` token into the page's `theme-color` whenever it reflects the theme, and the root element takes the dark `color-scheme` and leaves its background to the body. The reader's theme therefore reaches the parts of the window the page does not paint itself: tinted browser chrome, the root scrollbar, and the area revealed by overscroll.

## Alternatives considered

**Apply the stored theme from the application bundle.** That keeps all the logic in TypeScript, but the bundle is several hundred kilobytes and runs after first paint, so a dark reader would flash light on every load.

**Express the default purely in CSS with a `prefers-color-scheme` media query.** No script would be needed for the default, but the stylesheet keys every dark rule on `body.is-dark`, so an explicit choice opposite to the system setting would need each rule duplicated under the query.

**Declare `theme-color` twice with `prefers-color-scheme` media queries.** That needs no script, but it follows the system setting rather than the stored choice, so the two disagree for exactly the learners who picked a theme.

**Store the choice on the server.** It would survive a change of port, but it is a per-browser preference, and the [provider profiles](2026-08-27-chat-provider-profiles.md) decision already keeps such preferences in the browser.

**Follow the system setting live.** Reacting to a change while the page is open is possible, but a theme that changes under the reader during a sitting is more surprising than one settled at load.

## Consequences

- The theme survives reloads and matches the system on a first visit.
- The storage key appears in the inline script and in `src/lib/theme.ts`; a test asserts the page reads the same key the bundle writes.
- Like saved model profiles, the choice is tied to the origin, so starting the reader on another port starts from the system setting again.
- The reader strip carries one more icon. At the narrowest layout it still fits beside the AI Guide trigger.
- `theme-color` is set by the bundle, so on a dark first load a browser's chrome keeps the light color until the bundle has run.
