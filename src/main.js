import './style.css';
import { showSignOn } from './ui/signon.js';
import { createBuddyList, dialog } from './ui/buddylist.js';
import { closeAllIMs } from './ui/imwindow.js';
import { applyFavicon, runningManSVG } from './logo.js';
import { mountBackdrop } from './backdrop.js';
import * as sounds from './sounds.js';
import * as store from './store.js';

/**
 * The running man fades over the length of a session. Half an hour in, he is
 * nearly gone. Nobody is told this happens.
 */
const FULL_DECAY_MS = 30 * 60 * 1000;

let buddyList = null;
let decayTimer = null;

function sessionDecay() {
  const elapsed = Date.now() - store.getSignedOnAt();
  return Math.max(0, Math.min(1, elapsed / FULL_DECAY_MS));
}

function tickDecay() {
  const d = sessionDecay();
  applyFavicon(d);
  const headerLogo = document.querySelector('.bl-header .logo');
  if (headerLogo)
    headerLogo.innerHTML = runningManSVG({ decay: d, color: '#000080', compact: true });
}

function signOn(name) {
  store.setScreenName(name);
  sounds.play('dooropen');
  buddyList = createBuddyList({ onSignOff: signOff, onFatal: outOfMemory });
  tickDecay();
  clearInterval(decayTimer);
  decayTimer = setInterval(tickDecay, 15_000);
}

/**
 * The GPU ran out of memory. llm.js has already torn the engine down, so there
 * is nothing to keep the session alive for: slam the door, go back to sign-on,
 * and say what happened over the top of it.
 */
function outOfMemory(buddy) {
  signOff();
  dialog(
    'Anomie Instant Messenger',
    `You have been disconnected.\n\nThis computer ran out of graphics memory ` +
      `while talking to ${buddy.screenName}. Signing on again and starting with ` +
      `a smaller buddy usually works — Sk8rRatt187 is the smallest.`
  );
}

function signOff() {
  sounds.play('doorslam');
  closeAllIMs();
  buddyList?.win.close();
  buddyList = null;
  clearInterval(decayTimer);
  store.signOff();
  applyFavicon(0);
  showSignOn({ onSignOn: signOn });
}

function colophon() {
  const el = document.createElement('div');
  el.id = 'colophon';
  el.innerHTML =
    'ANOMIE &mdash; Justin Walsh<br>' +
    'every buddy is a language model on your machine';
  document.body.appendChild(el);
}

/**
 * Drive the shell height from visualViewport rather than trusting dvh.
 *
 * On iOS the layout viewport does not shrink when the keyboard opens — it slides
 * — so a 100dvh shell keeps its full height and pushes the compose box and the
 * Send button under the keyboard. visualViewport reports the part actually
 * visible, which is the number we want. `interactive-widget=resizes-content` in
 * the viewport meta makes Chrome behave the same way.
 *
 * Written to a custom property so CSS keeps ownership of the layout; the dvh
 * fallback in style.css covers browsers with no visualViewport at all.
 */
function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;

  let raf = 0;
  const apply = () => {
    // The keyboard fires resize and scroll in a burst; coalesce to one write.
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const root = document.documentElement.style;
      root.setProperty('--shell-h', `${Math.round(vv.height)}px`);
      // Height alone is not enough. iOS ignores interactive-widget, so the
      // layout viewport keeps its full height and the visual viewport scrolls
      // down instead — a fixed shell then sits above the visible region with
      // its title bar off screen. offsetTop is exactly that displacement.
      root.setProperty('--shell-top', `${Math.round(vv.offsetTop)}px`);

      // Opening the keyboard should not hide what you were reading.
      document.querySelectorAll('.im-history').forEach((h) => {
        h.scrollTop = h.scrollHeight;
      });
    });
  };

  apply();
  vv.addEventListener('resize', apply);
  // Scrolling the visual viewport is what the keyboard actually does on iOS,
  // and it does not fire resize.
  vv.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);
}

function boot() {
  applyFavicon(0);
  trackViewport();
  mountBackdrop();
  colophon();

  // Autoplay policy: the audio context can only start inside a gesture.
  document.addEventListener('mousedown', () => sounds.unlock(), { once: true });

  const existing = store.getScreenName();
  if (existing) {
    // Returning to a session already in progress — the decay carries over.
    buddyList = createBuddyList({ onSignOff: signOff, onFatal: outOfMemory });
    tickDecay();
    decayTimer = setInterval(tickDecay, 15_000);
  } else {
    showSignOn({ onSignOn: signOn });
  }
}

boot();
