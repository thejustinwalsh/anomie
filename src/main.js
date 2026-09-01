import './style.css';
import { showSignOn } from './ui/signon.js';
import { createBuddyList } from './ui/buddylist.js';
import { closeAllIMs } from './ui/imwindow.js';
import { applyFavicon, runningManSVG } from './logo.js';
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
  if (headerLogo) headerLogo.innerHTML = runningManSVG({ decay: d, color: '#000080' });
}

function signOn(name) {
  store.setScreenName(name);
  sounds.play('dooropen');
  buddyList = createBuddyList({ onSignOff: signOff });
  tickDecay();
  clearInterval(decayTimer);
  decayTimer = setInterval(tickDecay, 15_000);
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

function boot() {
  applyFavicon(0);
  colophon();

  // Autoplay policy: the audio context can only start inside a gesture.
  document.addEventListener('mousedown', () => sounds.unlock(), { once: true });

  const existing = store.getScreenName();
  if (existing) {
    // Returning to a session already in progress — the decay carries over.
    buddyList = createBuddyList({ onSignOff: signOff });
    tickDecay();
    decayTimer = setInterval(tickDecay, 15_000);
  } else {
    showSignOn({ onSignOn: signOn });
  }
}

boot();
