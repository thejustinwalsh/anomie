import { runningManSVG } from '../src/logo.js';

const box = (px, opts, caption) =>
  `<figure><div class="chip" style="width:${px}px;height:${px}px">${runningManSVG(
    opts
  )}</div><figcaption>${caption}</figcaption></figure>`;

document.getElementById('sheet').innerHTML =
  box(150, { decay: 0, color: '#000080' }, 'sign-on') +
  box(150, { decay: 0.5, color: '#000080' }, '15 minutes in') +
  box(150, { decay: 1, color: '#000080' }, '30 minutes in') +
  '<div class="rule"></div>' +
  box(64, { decay: 0, color: '#000080', compact: true }, 'compact 64px') +
  box(32, { decay: 0, color: '#000080', compact: true }, '32px') +
  box(16, { decay: 0, color: '#000080', compact: true }, 'favicon 16px');
