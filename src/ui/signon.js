/**
 * Sign-on. Screen name, an inert password field that exists purely because the
 * real one did, and the WebGPU check.
 */
import { createWindow } from './window.js';
import { runningManSVG } from '../logo.js';
import { hasWebGPU } from '../llm.js';

const SUGGESTIONS = [
  'CtrlAltDefeat',
  'BlueScreenBaby',
  'notyourbuddy_99',
  'AwayMessage4Ever',
  'lurkr2000',
];

export function showSignOn({ onSignOn }) {
  const win = createWindow({
    title: 'Sign On',
    width: 340,
    x: Math.round(window.innerWidth / 2 - 170),
    y: Math.round(window.innerHeight / 2 - 170),
    minimize: false,
    maximize: false,
    close: false,
  });
  win.el.id = 'signon-window';

  const banner = document.createElement('div');
  banner.className = 'signon-banner';
  const logo = document.createElement('span');
  logo.className = 'logo';
  logo.innerHTML = runningManSVG({ decay: 0, color: '#000080' });
  const words = document.createElement('div');
  words.innerHTML =
    '<h1>Anomie Instant Messenger</h1>' +
    '<p>Everyone on your buddy list is a language model<br>running on this computer.</p>';
  banner.append(logo, words);

  const nameRow = document.createElement('div');
  nameRow.className = 'field-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.value = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
  nameRow.innerHTML = '<label>Screen Name</label>';
  nameRow.appendChild(nameInput);

  const pwRow = document.createElement('div');
  pwRow.className = 'field-row';
  const pwInput = document.createElement('input');
  pwInput.type = 'password';
  // Inert on purpose: there is no account, nothing is checked, nothing is kept.
  pwInput.value = 'hunter2';
  pwInput.readOnly = true;
  pwInput.tabIndex = -1;
  pwRow.innerHTML = '<label>Password</label>';
  pwRow.appendChild(pwInput);

  const note = document.createElement('div');
  note.className = 'signon-note';

  const gpu = hasWebGPU();
  note.innerHTML = gpu
    ? 'There is no account and no password. Nothing you type is sent anywhere.<br><br>' +
      'The first message to each buddy downloads their model from Hugging Face ' +
      '(376&nbsp;MB&ndash;1.8&nbsp;GB) and caches it in this browser.'
    : '<span class="warn"><b>WebGPU is not available in this browser.</b></span><br><br>' +
      'The buddies cannot run without it. Try Chrome or Edge 113+, or Safari 18+. ' +
      'You can still sign on and look around.';

  const actions = document.createElement('div');
  actions.className = 'signon-actions';
  const helpBtn = document.createElement('button');
  helpBtn.textContent = 'Help';
  helpBtn.addEventListener('click', () => {
    window.open('https://github.com/thejustinwalsh/anomie#readme', '_blank', 'noopener');
  });
  const signOnBtn = document.createElement('button');
  signOnBtn.className = 'default';
  signOnBtn.textContent = 'Sign On';

  const submit = () => {
    const name = nameInput.value.trim() || 'ScreenName';
    win.close();
    onSignOn(name);
  };
  signOnBtn.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  actions.append(helpBtn, signOnBtn);
  win.body.append(banner, nameRow, pwRow, note, actions);

  nameInput.focus();
  nameInput.select();
  return win;
}
