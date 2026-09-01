/**
 * The desktop wallpaper: rolling hills under a wide sky, in the spirit of the
 * XP default — deliberately not the photograph.
 *
 * This is drawn, not shot. Flat vector hills in layered greens, a gradient sky,
 * a few hard-edged clouds. That keeps it consistent with the rest of the
 * project, where every pixel of chrome is hand-built CSS, and a stylized read
 * is a better joke than a photo would be anyway.
 *
 * The era mismatch is on purpose. The wallpaper is 2001 and the windows on top
 * of it are 1995, and the caption is aimed at both of them.
 */

/** WordArt extrusion: N offset copies behind the face, darkest at the back. */
function extrude(depth, render) {
  let out = '';
  for (let i = depth; i >= 1; i--) out += render(i * 1.6, i * 1.6);
  return out;
}

const CAPTION = 'go touch grass';

// A shallow upward arc for the text to sit on. Arched WordArt is the single
// most period-correct thing that can be done to a piece of text.
const ARC = 'M 210 232 Q 600 118 990 232';

// The unfurl card puts a large buddy list down the left, so the caption moves
// right to clear it. Same drawing, different placement.
const ARC_OG = 'M 500 240 Q 830 128 1160 240';

/**
 * @param {object} [opts]
 * @param {boolean} [opts.og]  compose for the 1200x630 unfurl card
 */
export function backdropSVG({ og = false } = {}) {
  const arc = og ? ARC_OG : ARC;
  const fontSize = og ? 78 : 96;
  return render(arc, fontSize);
}

function render(ARC, FONT_SIZE) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"
    preserveAspectRatio="xMidYMid slice" class="backdrop-svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#1a5fb4"/>
      <stop offset="45%"  stop-color="#4b93dd"/>
      <stop offset="80%"  stop-color="#9fd0f0"/>
      <stop offset="100%" stop-color="#d3ecfa"/>
    </linearGradient>
    <!-- Atmospheric perspective: the far ridge is paler and bluer, which is
         what separates three overlapping green shapes into a landscape. -->
    <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b6d79a"/><stop offset="100%" stop-color="#8dba68"/>
    </linearGradient>
    <linearGradient id="hillMid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#77b23f"/><stop offset="100%" stop-color="#4f8a28"/>
    </linearGradient>
    <linearGradient id="hillNear" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5da12a"/><stop offset="100%" stop-color="#2f6b14"/>
    </linearGradient>
    <linearGradient id="wordFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#fffbc9"/>
      <stop offset="45%" stop-color="#ffd83d"/>
      <stop offset="55%" stop-color="#f7b500"/>
      <stop offset="100%" stop-color="#ffe680"/>
    </linearGradient>
    <path id="arc" d="${ARC}"/>
  </defs>

  <rect width="1200" height="630" fill="url(#sky)"/>

  <!-- Clouds. Hard-edged ellipse clusters; nothing here is blurred. -->
  <g fill="#ffffff">
    <g opacity="0.95">
      <ellipse cx="205" cy="96"  rx="66" ry="25"/>
      <ellipse cx="258" cy="84"  rx="46" ry="30"/>
      <ellipse cx="150" cy="104" rx="42" ry="19"/>
    </g>
    <g opacity="0.8">
      <ellipse cx="915" cy="128" rx="78" ry="27"/>
      <ellipse cx="963" cy="114" rx="50" ry="32"/>
      <ellipse cx="855" cy="136" rx="45" ry="20"/>
    </g>
    <g opacity="0.62">
      <ellipse cx="620" cy="62"  rx="54" ry="18"/>
      <ellipse cx="668" cy="55"  rx="34" ry="22"/>
    </g>
    <g opacity="0.5">
      <ellipse cx="1105" cy="238" rx="70" ry="18"/>
      <ellipse cx="1060" cy="245" rx="44" ry="13"/>
    </g>
    <!-- Low, flat clouds in the band between the caption and the ridgeline;
         without them that stretch of sky reads as a blank gap. -->
    <g opacity="0.55">
      <ellipse cx="345" cy="292" rx="86" ry="16"/>
      <ellipse cx="392" cy="284" rx="52" ry="21"/>
      <ellipse cx="282" cy="297" rx="48" ry="12"/>
    </g>
    <g opacity="0.4">
      <ellipse cx="760" cy="312" rx="74" ry="14"/>
      <ellipse cx="800" cy="305" rx="44" ry="18"/>
    </g>
  </g>

  <!-- Hills, far to near. -->
  <path d="M0 392 C 190 344 372 358 556 384 C 754 412 978 366 1200 388 L1200 630 L0 630 Z"
        fill="url(#hillFar)"/>
  <path d="M0 452 C 250 378 430 412 706 448 C 902 472 1058 436 1200 452 L1200 630 L0 630 Z"
        fill="url(#hillMid)"/>
  <path d="M0 566 C 128 470 306 412 524 434 C 762 458 982 546 1200 566 L1200 630 L0 630 Z"
        fill="url(#hillNear)"/>

  <!-- WordArt. Extruded down-right, gradient face, hard black outline. -->
  <g font-family="Impact, Haettenschweiler, 'Arial Black', sans-serif"
     font-size="${FONT_SIZE}" letter-spacing="1" text-anchor="middle">
    ${extrude(
      9,
      (dx, dy) =>
        `<text fill="#7a5200" dx="${dx}" dy="${dy}">` +
        `<textPath href="#arc" startOffset="50%">${CAPTION}</textPath></text>`
    )}
    <text fill="url(#wordFace)" stroke="#000000" stroke-width="3"
          paint-order="stroke fill" stroke-linejoin="round">
      <textPath href="#arc" startOffset="50%">${CAPTION}</textPath>
    </text>
  </g>
</svg>`;
}

/** Mount the wallpaper behind every window. */
export function mountBackdrop(opts) {
  const el = document.createElement('div');
  el.id = 'backdrop';
  el.innerHTML = backdropSVG(opts);
  document.body.prepend(el);
  return el;
}
