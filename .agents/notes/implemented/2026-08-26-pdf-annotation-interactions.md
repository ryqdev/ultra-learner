# Agent Note: Preserve PDF annotation interactions

Status: implemented

## Problem

The reader rendered each page as a canvas with selectable text, but it omitted the PDF annotation layer. Authored table-of-contents destinations, cross-page links, external URLs, form controls, attachments, and other interactive annotations therefore looked present on the canvas without having browser interaction targets.

## Decision

Each current page renders PDF.js's `AnnotationLayer` above its canvas and text layer using the same viewport and document annotation storage. A small reader-owned link service resolves named and explicit PDF destinations through `PDFDocumentProxy`, changes the current page, and applies supported destination coordinates after rendering. Common PDF page actions map to the reader's existing navigation controls. External URLs open in a separate tab with referrer isolation, while embedded attachments stay browser-local and open or download through blob URLs.

The repository serves PDF.js's annotation stylesheet and image resources from the installed dependency. JavaScript actions remain disabled because running document-provided scripts would cross the local-file trust boundary; unsupported named actions produce an explicit message rather than silently doing nothing. Box-selection mode disables annotation hit targets until text mode is restored.

## Alternatives considered

**Infer links from visible text.** Autolinking URL-shaped strings would not restore authored table-of-contents destinations, arbitrary link rectangles, form widgets, attachments, or named actions.

**Replace the reader with PDF.js's complete viewer.** The full viewer supports the interaction set, but it would replace the product's one-page reader layout, AI selection contract, thumbnails, and controls instead of extending the existing rendering stack.

**Enable PDF JavaScript actions.** This would more closely emulate some desktop viewers, but it requires a scripting sandbox and a larger security boundary for untrusted local documents. Static annotations and form values provide the useful interaction surface without executing embedded code.

## Consequences

- Authored contents links and ordinary internal or external PDF links are clickable in the web reader.
- Common annotations and form widgets share PDF.js behavior and remain local to the tab.
- Destination zoom modes preserve the reader's configured scale; supported destination coordinates are applied within that scale.
- PDF.js viewer CSS and image files become browser-served runtime assets that must stay aligned with the installed PDF.js version.
- Document JavaScript, browser history actions, printing actions, and full scripting-dependent form behavior remain intentionally unsupported and are surfaced when invoked.
