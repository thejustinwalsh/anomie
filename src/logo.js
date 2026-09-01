/**
 * The Anomie running man.
 *
 * A reference to the AIM running man, not a reproduction: same idea (a figure
 * mid-stride, seen in profile), redrawn from scratch, and then dissolved. Three
 * ghost copies trail behind him at stepped opacity — discrete jumps, not a
 * gradient mask, which is how 90s sprite work faked motion blur and which is the
 * only way this survives being scaled down to a 16px favicon.
 *
 * He runs, but he is leaving.
 */

// One figure, in its own coordinate space. Limbs are strokes rather than filled
// paths so the whole thing stays legible when it's twelve pixels tall. Stroke
// widths vary per limb — a uniform weight turns the whole figure into one blob
// at small sizes, and the head has to stay clear of the leading hand or the two
// merge into a lump with no neck.
const FIGURE = `
<circle cx="24.6" cy="5.3" r="2.7"/>
<path d="M23.4 8.6 L19.3 18.8" stroke-width="4"/>
<path d="M22.9 10.2 L27.5 12.9 L29.3 9.5" stroke-width="2.7"/>
<path d="M22.9 10.2 L18.5 11.7 L15.4 8.5" stroke-width="2.7"/>
<path d="M19.3 18.8 L24.5 20.5 L25.9 26.4" stroke-width="3.2"/>
<path d="M19.3 18.8 L15.3 21.9 L11.1 25.9" stroke-width="3.2"/>
`;

// Opacity of each copy, lead first. Stepped, deliberately uneven — a linear ramp
// reads as a gradient, and a gradient reads as modern.
const BASE_STEPS = [1, 0.55, 0.3, 0.14];

// How far behind the lead each ghost sits, in figure-space units.
const OFFSETS = [0, -4.4, -8.8, -13.2];

// At favicon size four overlapping copies turn to mush, so the small variant
// drops to a lead plus two ghosts and spreads them further apart.
const COMPACT_OFFSETS = [0, -5.6, -11.2];
const COMPACT_STEPS = [1, 0.5, 0.22];

/**
 * @param {number} decay 0 at sign-on, 1 after a long session.
 * @returns {number[]} per-copy opacity
 */
export function ghostOpacities(decay = 0, compact = false) {
  const d = Math.max(0, Math.min(1, decay));
  // Everything thins out together, but the lead never vanishes entirely —
  // there has to be someone left to watch leave.
  return (compact ? COMPACT_STEPS : BASE_STEPS).map((step, i) => {
    const floor = i === 0 ? 0.38 : 0.0;
    return +(floor + (step - floor) * (1 - d * 0.92)).toFixed(3);
  });
}

/**
 * @param {object} [opts]
 * @param {number} [opts.decay]  0..1 session decay
 * @param {string} [opts.color]  fill/stroke color
 * @param {number} [opts.size]   width/height attribute; omit for a fluid SVG
 * @returns {string} standalone SVG markup
 */
export function runningManSVG({
  decay = 0,
  color = '#000080',
  size = null,
  compact = false,
} = {}) {
  const ops = ghostOpacities(decay, compact);
  const offsets = compact ? COMPACT_OFFSETS : OFFSETS;
  const copies = offsets
    .map(
      (dx, i) => `<g opacity="${ops[i]}" transform="translate(${dx} 0)">${FIGURE}</g>`
    )
    // Draw back-to-front so the solid lead sits on top of its own ghosts.
    .reverse()
    .join('');

  // Fit the whole trail into the 32-unit box: the compact variant is narrower,
  // so it gets to be drawn bigger.
  const transform = compact
    ? 'translate(2.6 0.6) scale(1.02)'
    : 'translate(2.9 2) scale(0.94)';

  const dims = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"${dims}>
<g fill="${color}" stroke="${color}" stroke-linecap="butt" stroke-linejoin="miter" transform="${transform}">${copies}</g>
</svg>`;
}

/** Swap the browser tab icon to the current decay level. */
export function applyFavicon(decay = 0) {
  const svg = runningManSVG({ decay, color: '#f5c542', compact: true });
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
