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
// paths so the whole thing stays legible when it's twelve pixels tall.
const FIGURE = `
<circle cx="25" cy="6.5" r="3.4"/>
<path d="M23.5 10 L19.5 18.5" stroke-width="4.2"/>
<path d="M23 11 L27.6 13.6 L28.2 9.2"/>
<path d="M23 11 L18.4 12.4 L15.4 9.4"/>
<path d="M19.5 18.5 L24.6 20.6 L26 26"/>
<path d="M19.5 18.5 L15.4 22 L11.5 25.8"/>
`;

// Opacity of each copy, lead first. Stepped, deliberately uneven — a linear ramp
// reads as a gradient, and a gradient reads as modern.
const BASE_STEPS = [1, 0.55, 0.3, 0.14];

// How far behind the lead each ghost sits, in figure-space units.
const OFFSETS = [0, -4, -8, -12];

/**
 * @param {number} decay 0 at sign-on, 1 after a long session.
 * @returns {number[]} per-copy opacity
 */
export function ghostOpacities(decay = 0) {
  const d = Math.max(0, Math.min(1, decay));
  // Everything thins out together, but the lead never vanishes entirely —
  // there has to be someone left to watch leave.
  return BASE_STEPS.map((step, i) => {
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
export function runningManSVG({ decay = 0, color = '#000080', size = null } = {}) {
  const ops = ghostOpacities(decay);
  const copies = OFFSETS.map(
    (dx, i) =>
      `<g opacity="${ops[i]}" transform="translate(${dx} 0)">${FIGURE}</g>`
  )
    // Draw back-to-front so the solid lead sits on top of its own ghosts.
    .reverse()
    .join('');

  const dims = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"${dims} shape-rendering="crispEdges">
<g fill="${color}" stroke="${color}" stroke-width="3.4" stroke-linecap="butt" stroke-linejoin="miter" transform="translate(2.5 2) scale(0.96)">${copies}</g>
</svg>`;
}

/** Swap the browser tab icon to the current decay level. */
export function applyFavicon(decay = 0) {
  const svg = runningManSVG({ decay, color: '#f5c542' });
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
