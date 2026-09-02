/**
 * The IM window: formatting toolbar over a split history/compose pane, with
 * Warn and Block sitting next to Send exactly where they used to, because half
 * the reason those buttons are memorable is that they were right there.
 */
import { createWindow, createMenuBar } from './window.js';
import { primeMessages } from '../buddies.js';
import * as sounds from '../sounds.js';
import * as store from '../store.js';
import * as llm from '../llm.js';

const FONTS = [
  'Arial',
  'Times New Roman',
  'Courier New',
  'Comic Sans MS',
  'Verdana',
  'MS Sans Serif',
];

const SIZES = [10, 12, 14, 16, 18, 24];

const COLORS = [
  ['#000000', 'Black'],
  ['#c00000', 'Red'],
  ['#0000c0', 'Blue'],
  ['#008000', 'Green'],
  ['#800080', 'Purple'],
  ['#c06000', 'Orange'],
  ['#008080', 'Teal'],
  ['#808080', 'Gray'],
];

const SMILEYS = [
  ':-)',
  ':-(',
  ';-)',
  ':-P',
  ':-D',
  ':-O',
  ':-/',
  ":'(",
  '8-)',
  ':-X',
  '>:-(',
  '<3',
];

const IM_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges"><rect x="1" y="3" width="14" height="9" fill="#fff" stroke="#000"/><path d="M1.5 3.5 8 8.5 14.5 3.5" fill="none" stroke="#000"/></svg>`;

/** How many past turns the model sees. Small models get lost past this. */
const CONTEXT_TURNS = 12;

const open = new Map(); // screenName -> controller

/**
 * Small models produce markdown, stage directions, role labels and essays. An
 * instant message is none of those things, so everything gets scrubbed on the
 * way out.
 */
export function cleanReply(raw, screenName) {
  let t = (raw || '').trim();

  // Role labels the model helpfully prepended.
  t = t.replace(new RegExp(`^\\s*${screenName}\\s*[:>]\\s*`, 'i'), '');
  t = t.replace(/^\s*(assistant|ai|bot|user|me)\s*[:>]\s*/i, '');

  // Markdown scaffolding.
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^\s*[-*+]\s+/gm, '');
  t = t.replace(/^\s*\d+[.)]\s+/gm, '');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1$2');
  t = t.replace(/`{1,3}/g, '');

  // Stage directions: *smiles*, (laughs).
  t = t.replace(/\*[^*]{0,40}\*/g, '');

  // Emoji had not been invented yet.
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu,
    ''
  );

  t = t.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // Surrounding quotes the model added around the whole line.
  if (/^["'].*["']$/.test(t)) t = t.slice(1, -1).trim();

  // The one thing that would break the piece outright.
  if (/\b(as an? (ai|language model|assistant)|i'?m an? (ai|language model))\b/i.test(t)) {
    return 'hang on someone picked up the phone';
  }

  // Two sentences, max. Nobody sent paragraphs.
  const sentences = t.match(/[^.!?]+[.!?]*/g);
  if (sentences && sentences.length > 2) t = sentences.slice(0, 2).join('').trim();

  if (t.length > 240) t = t.slice(0, 237).trimEnd() + '...';

  return t || '...';
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Character ranges given as codepoint pairs and compiled at runtime, rather
 * than pasted into a regex literal. Written literally, half of these are
 * invisible in an editor and the C0 range makes the source file itself stop
 * being text; written as escapes, they are unreadable. As numbers they can be
 * read, grepped and commented.
 */
function charClass(ranges) {
  const body = ranges
    .map(([lo, hi]) =>
      lo === hi
        ? String.fromCharCode(lo)
        : String.fromCharCode(lo) + '-' + String.fromCharCode(hi)
    )
    .join('');
  return new RegExp('[' + body + ']', 'g');
}

/** Invisible in the compose box, but real to a tokenizer. */
const INVISIBLE = charClass([
  [0x0000, 0x0008], // C0 controls, keeping tab (09) and newline (0a)
  [0x000b, 0x001f], // the rest of C0, keeping nothing else
  [0x007f, 0x009f], // DEL and the C1 block
  [0x200b, 0x200f], // zero-width space through right-to-left mark
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner through the invisible operators
  [0xfeff, 0xfeff], // BOM, a.k.a. zero-width no-break space
]);

/** Spaces that a paste drags in, which a 1998 chat window would just call a space. */
const ODD_SPACE = charClass([
  [0x00a0, 0x00a0], // non-breaking space
  [0x1680, 0x1680], // ogham space mark
  [0x2000, 0x200a], // en quad through hair space
  [0x202f, 0x202f], // narrow no-break space
  [0x205f, 0x205f], // medium mathematical space
  [0x3000, 0x3000], // ideographic space
]);

/**
 * Whatever came out of the contenteditable, made fit to send.
 *
 * A contenteditable accepts anything the platform will put in it. None of that
 * should reach the model: partly hygiene, since the smallest buddy has a 1k
 * context and an invisible character still costs a token, and partly that the
 * transcript is fed back in as prompt on every turn — so text hiding inside a
 * message gets a second chance to be read as instruction.
 */
export function sanitizeOutgoing(raw) {
  let t = String(raw ?? '');

  t = t.replace(INVISIBLE, '');
  t = t.replace(ODD_SPACE, ' ');

  // Shift+Enter is allowed while composing, but an instant message went over
  // the wire as one line and that is still the right shape for it.
  t = t.replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ');

  t = t.replace(/[ \t]{2,}/g, ' ').trim();

  // Nobody typed a novel into an IM box.
  if (t.length > 400) t = t.slice(0, 400).trimEnd();

  return t;
}

/**
 * @param {object} buddy   entry from BUDDIES
 * @param {object} deps    { onStateChange(screenName, state) } — lets the buddy
 *                         list show download progress as an away message
 */
export function openIM(buddy, deps = {}) {
  const existing = open.get(buddy.screenName);
  if (existing) {
    existing.win.show();
    existing.focusCompose();
    return existing;
  }

  const me = store.getScreenName();
  const count = open.size;

  const win = createWindow({
    title: `Instant Message with ${buddy.screenName}`,
    icon: IM_ICON,
    className: 'im-window',
    width: 428,
    height: 372,
    x: 240 + ((count * 26) % 180),
    y: 40 + ((count * 24) % 160),
    onClose: () => open.delete(buddy.screenName),
  });

  // --- format state -------------------------------------------------------
  const fmt = { bold: false, italic: false, underline: false, font: 'Arial', size: 12, color: '#000000' };

  // --- menus --------------------------------------------------------------
  win.body.appendChild(
    createMenuBar([
      {
        label: 'File',
        rows: [
          { label: 'Save Conversation...', onClick: () => saveTranscript() },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        rows: [
          { label: 'Cut', disabled: true },
          { label: 'Copy', disabled: true },
          { label: 'Paste', disabled: true },
          '-',
          { label: 'Clear Conversation', onClick: () => clearLog() },
        ],
      },
      {
        label: 'Insert',
        rows: [
          { label: 'Smiley', onClick: () => insert(' :-) ') },
          { label: 'Hyperlink...', disabled: true },
        ],
      },
      {
        label: 'People',
        rows: [
          { label: `Get Info on ${buddy.screenName}`, onClick: () => showInfo() },
          '-',
          { label: 'Warn', onClick: () => doWarn() },
          { label: 'Block', onClick: () => doBlock() },
        ],
      },
    ])
  );

  // --- toolbar ------------------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  const mkToggle = (label, key, style) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = style;
    b.title = key[0].toUpperCase() + key.slice(1);
    b.addEventListener('click', () => {
      fmt[key] = !fmt[key];
      b.classList.toggle('on', fmt[key]);
      applyFormat();
      compose.focus();
    });
    return b;
  };

  toolbar.append(
    mkToggle('B', 'bold', 'font-weight:bold'),
    mkToggle('I', 'italic', 'font-family:Times New Roman,serif;font-style:italic'),
    mkToggle('U', 'underline', 'text-decoration:underline')
  );

  const sep1 = document.createElement('div');
  sep1.className = 'sep';
  toolbar.appendChild(sep1);

  const fontSel = document.createElement('select');
  fontSel.style.width = '104px';
  FONTS.forEach((f) => fontSel.add(new Option(f, f)));
  fontSel.value = fmt.font;
  fontSel.addEventListener('change', () => {
    fmt.font = fontSel.value;
    applyFormat();
  });

  const sizeSel = document.createElement('select');
  sizeSel.style.width = '48px';
  SIZES.forEach((s) => sizeSel.add(new Option(String(s), String(s))));
  sizeSel.value = String(fmt.size);
  sizeSel.addEventListener('change', () => {
    fmt.size = +sizeSel.value;
    applyFormat();
  });

  toolbar.append(fontSel, sizeSel);

  const sep2 = document.createElement('div');
  sep2.className = 'sep';
  toolbar.appendChild(sep2);

  // Color picker: a swatch button that opens the eight-color palette.
  const colorBtn = document.createElement('button');
  colorBtn.className = 'tool';
  colorBtn.type = 'button';
  colorBtn.title = 'Text color';
  const swatch = document.createElement('span');
  swatch.style.cssText =
    'width:12px;height:12px;display:block;background:#000;box-shadow:inset 0 0 0 1px #808080';
  colorBtn.appendChild(swatch);
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup(colorBtn, COLORS, ([hex, name]) => {
      const b = document.createElement('button');
      b.title = name;
      b.innerHTML = `<span style="width:14px;height:14px;display:block;background:${hex};box-shadow:inset 0 0 0 1px #808080"></span>`;
      b.addEventListener('click', () => {
        fmt.color = hex;
        swatch.style.background = hex;
        applyFormat();
      });
      return b;
    });
  });

  const smileyBtn = document.createElement('button');
  smileyBtn.className = 'tool';
  smileyBtn.type = 'button';
  smileyBtn.title = 'Insert a smiley';
  smileyBtn.textContent = ':-)';
  smileyBtn.style.fontSize = '10px';
  smileyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup(smileyBtn, SMILEYS, (s) => {
      const b = document.createElement('button');
      b.textContent = s;
      b.style.fontSize = '10px';
      b.addEventListener('click', () => insert(' ' + s + ' '));
      return b;
    });
  });

  toolbar.append(colorBtn, smileyBtn);
  win.body.appendChild(toolbar);

  function popup(anchor, items, render) {
    document.querySelector('.smiley-popup')?.remove();
    const p = document.createElement('div');
    p.className = 'smiley-popup';
    items.forEach((item) => {
      const b = render(item);
      b.addEventListener('click', () => p.remove());
      p.appendChild(b);
    });
    const r = anchor.getBoundingClientRect();
    p.style.left = r.left + 'px';
    p.style.top = r.bottom + 2 + 'px';
    document.body.appendChild(p);
    setTimeout(() => {
      document.addEventListener('mousedown', function off(ev) {
        if (!p.contains(ev.target)) {
          p.remove();
          document.removeEventListener('mousedown', off);
        }
      });
    }, 0);
  }

  // --- panes --------------------------------------------------------------
  const history = document.createElement('div');
  history.className = 'well im-history';

  const splitter = document.createElement('div');
  splitter.className = 'im-split';

  const compose = document.createElement('div');
  compose.className = 'well im-compose';
  compose.contentEditable = 'true';
  compose.spellcheck = false;
  compose.setAttribute('role', 'textbox');
  compose.setAttribute('aria-multiline', 'true');
  compose.setAttribute('aria-label', `Message to ${buddy.screenName}`);
  compose.dataset.placeholder = `Send an Instant Message to ${buddy.screenName}`;

  // A contenteditable is never really empty once you have typed and deleted:
  // the browser leaves a <br> behind, `:empty` stops matching, and the
  // placeholder never comes back. Clear it outright the moment it holds only
  // whitespace — safe to discard innerHTML here precisely because there is
  // nothing in it worth keeping.
  const normalizeEmpty = () => {
    if (!compose.textContent.trim()) compose.innerHTML = '';
  };
  compose.addEventListener('input', normalizeEmpty);
  compose.addEventListener('blur', normalizeEmpty);

  // Paste and drop hand over full HTML by default, which would drag a
  // stylesheet and a font stack into a 1998 chat window. Take the text only.
  const insertPlain = (e, data) => {
    e.preventDefault();
    const text = sanitizeOutgoing(data);
    if (text) document.execCommand('insertText', false, text);
  };
  compose.addEventListener('paste', (e) =>
    insertPlain(e, (e.clipboardData || window.clipboardData)?.getData('text/plain') || '')
  );
  compose.addEventListener('drop', (e) =>
    insertPlain(e, e.dataTransfer?.getData('text/plain') || '')
  );

  win.body.append(history, splitter, compose);

  function applyFormat() {
    compose.style.fontWeight = fmt.bold ? 'bold' : 'normal';
    compose.style.fontStyle = fmt.italic ? 'italic' : 'normal';
    compose.style.textDecoration = fmt.underline ? 'underline' : 'none';
    compose.style.fontFamily = fmt.font;
    compose.style.fontSize = fmt.size + 'px';
    compose.style.color = fmt.color;
  }
  applyFormat();

  // Drag the splitter to trade history height for compose height.
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = compose.offsetHeight;
    const move = (ev) => {
      const h = Math.max(38, Math.min(220, startH - (ev.clientY - startY)));
      compose.style.flexBasis = h + 'px';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // --- actions ------------------------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'im-actions';

  const warnBtn = document.createElement('button');
  warnBtn.textContent = 'Warn';
  warnBtn.addEventListener('click', doWarn);

  const blockBtn = document.createElement('button');
  blockBtn.textContent = 'Block';
  blockBtn.addEventListener('click', doBlock);

  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  const sendBtn = document.createElement('button');
  sendBtn.className = 'default send';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', send);

  actions.append(warnBtn, blockBtn, spacer, sendBtn);
  win.body.appendChild(actions);

  // --- status bar ---------------------------------------------------------
  const status = document.createElement('div');
  status.className = 'status-bar';
  const statusLeft = document.createElement('div');
  statusLeft.className = 'status-panel';
  const statusRight = document.createElement('div');
  statusRight.className = 'status-panel fixed';
  statusRight.textContent = buddy.model.replace(/-MLC.*$/, '');
  statusRight.title = buddy.model;
  status.append(statusLeft, statusRight);
  win.body.appendChild(status);

  function setStatus(text, typing = false) {
    statusLeft.textContent = text;
    statusLeft.classList.toggle('typing', typing);
  }
  setStatus('');

  // --- transcript ---------------------------------------------------------
  function addLine(from, text, style) {
    const line = document.createElement('div');
    line.className = 'line';
    if (from === 'sys') {
      line.innerHTML = `<span class="sys">${escapeHTML(text)}</span>`;
    } else {
      const who = from === 'me' ? me : buddy.screenName;
      const css = style
        ? `font-family:${style.font};font-size:${style.size}px;color:${style.color};` +
          `font-weight:${style.bold ? 'bold' : 'normal'};font-style:${style.italic ? 'italic' : 'normal'};` +
          `text-decoration:${style.underline ? 'underline' : 'none'}`
        : '';
      line.innerHTML =
        `<span class="sn ${from}">${escapeHTML(who)}:</span> ` +
        `<span class="msg" style="${css}">${escapeHTML(text)}</span>`;
    }
    history.appendChild(line);
    history.scrollTop = history.scrollHeight;
    return line;
  }

  // Replay whatever this conversation already was.
  store.getHistory(buddy.screenName).forEach((m) => addLine(m.from, m.text, m.style));
  if (!store.getHistory(buddy.screenName).length) {
    addLine('sys', `${buddy.screenName} is online.`);
  }

  function insert(text) {
    compose.focus();
    document.execCommand('insertText', false, text);
  }

  function clearLog() {
    store.clearHistory(buddy.screenName);
    history.innerHTML = '';
    addLine('sys', 'Conversation cleared.');
  }

  function saveTranscript() {
    const lines = store
      .getHistory(buddy.screenName)
      .map((m) => `${m.from === 'me' ? me : buddy.screenName}: ${m.text}`)
      .join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${buddy.screenName}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showInfo() {
    addLine('sys', `Profile for ${buddy.screenName} — ${buddy.profile}`);
  }

  let warnLevel = 0;
  function doWarn() {
    warnLevel = Math.min(100, warnLevel + 20);
    addLine('sys', `You have warned ${buddy.screenName}. Warning level: ${warnLevel}%`);
    sounds.play('error');
    if (warnLevel >= 100) {
      addLine('sys', `${buddy.screenName} has signed off.`);
      sounds.play('doorslam');
      deps.onBlocked?.(buddy.screenName);
      sendBtn.disabled = true;
    }
  }

  function doBlock() {
    addLine('sys', `${buddy.screenName} has been blocked.`);
    sounds.play('doorslam');
    deps.onBlocked?.(buddy.screenName);
    setTimeout(() => win.close(), 700);
  }

  // --- sending ------------------------------------------------------------
  let busy = false;

  async function send() {
    if (busy) return;
    const text = sanitizeOutgoing(compose.innerText);
    if (!text) return;

    const style = { ...fmt };
    compose.innerHTML = '';
    addLine('me', text, style);
    store.appendMessage(buddy.screenName, { from: 'me', text, style, at: Date.now() });
    sounds.play('imsend');

    busy = true;
    sendBtn.disabled = true;

    // Weights may not be downloaded yet. Report progress here and in the list.
    const cached = await llm.isCached(buddy.model);
    if (!cached) {
      setStatus(`Downloading ${buddy.screenName}...`);
      deps.onStateChange?.(buddy.screenName, { away: 'downloading... 0%' });
    }
    const stopProgress = llm.onProgress(buddy.model, ({ progress }) => {
      const pct = Math.round((progress || 0) * 100);
      setStatus(`Downloading ${buddy.screenName}... ${pct}%`);
      deps.onStateChange?.(buddy.screenName, { away: `downloading... ${pct}%` });
    });

    const messages = [
      ...primeMessages(buddy),
      ...store
        .getHistory(buddy.screenName)
        .slice(-CONTEXT_TURNS)
        .map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })),
    ];

    let line = null;
    let placeholder = null;

    try {
      const reply = await llm.chat(buddy.model, messages, (full) => {
        if (!line) {
          stopProgress();
          deps.onStateChange?.(buddy.screenName, { away: null });
          setStatus(`${buddy.screenName} is typing...`, true);
          placeholder = { from: 'them', text: '', at: Date.now() };
          store.appendMessage(buddy.screenName, placeholder);
          line = addLine('them', '');
        }
        const partial = cleanReply(full, buddy.screenName);
        line.querySelector('.msg').textContent = partial;
        history.scrollTop = history.scrollHeight;
      }, buddy.gen);

      const clean = cleanReply(reply, buddy.screenName);
      if (line) {
        line.querySelector('.msg').textContent = clean;
        store.replaceLastMessage(buddy.screenName, clean);
      } else {
        addLine('them', clean);
        store.appendMessage(buddy.screenName, { from: 'them', text: clean, at: Date.now() });
      }
      sounds.play('imrcv');
      setStatus('');
    } catch (err) {
      console.error(err);
      stopProgress();
      deps.onStateChange?.(buddy.screenName, { away: null });

      // Out of memory is not a connection problem and cannot be retried — the
      // GPU has already been released by the time this throws. Hand it upward
      // and let the session end; anything else leaves a window that can only
      // fail again.
      if (err instanceof llm.OutOfMemoryError) {
        addLine('sys', `${buddy.screenName} has signed off.`);
        setStatus('Out of memory.');
        deps.onFatal?.(buddy, err);
        return;
      }

      addLine('sys', `Could not reach ${buddy.screenName}. (${err?.message || err})`);
      sounds.play('error');
      setStatus('Connection problem.');
    } finally {
      stopProgress();
      busy = false;
      sendBtn.disabled = false;
      compose.focus();
    }
  }

  // Enter sends, Shift+Enter makes a new line. This is the correct behavior and
  // arguing about it was a whole thing in 1998 too.
  compose.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  const controller = {
    win,
    buddy,
    focusCompose: () => compose.focus(),
    addSystemLine: (t) => addLine('sys', t),
  };
  open.set(buddy.screenName, controller);
  compose.focus();
  return controller;
}

export function closeAllIMs() {
  [...open.values()].forEach((c) => c.win.close());
  open.clear();
}

export function getOpenIM(screenName) {
  return open.get(screenName) || null;
}
