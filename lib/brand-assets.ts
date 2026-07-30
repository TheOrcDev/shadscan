/**
 * Copyable brand assets.
 *
 * These are plain strings rather than serialized React elements so that what
 * lands on the clipboard is exactly what is reviewed here — a standalone SVG
 * that opens in a browser, pastes into Figma, and needs no build step.
 *
 * `currentColor` is deliberate: the mark is pure stroke, so it inherits the
 * surrounding text colour when embedded in a page and falls back to black on
 * its own, which is how a single-colour mark is meant to travel.
 */

/** Keep in sync with `components/shadscan-mark.tsx`. */
const LOGOMARK_PATHS = `  <path d="M23 11H11v12" />
  <path d="M41 11h12v12" />
  <path d="M11 41v12h12" />
  <path d="M53 41v12H41" />
  <g transform="translate(3.4 3.4) scale(.864)">
    <path d="m22 41 19-19" />
    <path d="m35 43 8-8" />
  </g>`;

const SVG_STROKE_ATTRIBUTES = `fill="none" stroke="currentColor" stroke-linecap="square" stroke-linejoin="miter" stroke-width="6"`;

const LOGOMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" ${SVG_STROKE_ATTRIBUTES} role="img" aria-label="shadscan">
${LOGOMARK_PATHS}
</svg>
`;

/**
 * The lockup sets the wordmark in the site's heading face with a system
 * fallback chain, because shadscan has no outlined wordmark asset yet. The
 * copied file therefore renders correctly wherever Nunito Sans resolves and
 * degrades to a comparable sans elsewhere; swapping in outlined paths later is
 * a change to this constant alone.
 */
const LOGOTYPE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="272" height="64" viewBox="0 0 272 64" fill="none" role="img" aria-label="shadscan">
  <g ${SVG_STROKE_ATTRIBUTES}>
${LOGOMARK_PATHS}
  </g>
  <text x="84" y="45" fill="currentColor" font-family="'Nunito Sans', 'Segoe UI', Helvetica, Arial, sans-serif" font-size="42" font-weight="700" letter-spacing="-1.2">shadscan</text>
</svg>
`;

export { LOGOMARK_SVG, LOGOTYPE_SVG };
