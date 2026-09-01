/**
 * A minimal Windows 95 window manager: bevelled frame, gradient title bar,
 * drag by the caption, click-to-raise, and the three caption buttons.
 *
 * Only one window is "active" at a time and its title bar is blue; every other
 * one goes gray. That single detail does more for the period feel than any
 * amount of pixel-fiddling on the borders.
 */

let zTop = 100;
const windows = new Set();

function setActive(win) {
  windows.forEach((w) => w.el.classList.add('inactive'));
  win.el.classList.remove('inactive');
  win.el.style.zIndex = ++zTop;
}

function svgIcon(markup) {
  const span = document.createElement('span');
  span.className = 'title-bar-icon';
  span.innerHTML = markup;
  return span;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.icon]        inline SVG markup for the caption icon
 * @param {string} [opts.className]
 * @param {number} [opts.x] @param {number} [opts.y]
 * @param {number} [opts.width] @param {number} [opts.height]
 * @param {boolean} [opts.minimize] @param {boolean} [opts.maximize] @param {boolean} [opts.close]
 * @param {() => void} [opts.onClose]
 */
export function createWindow(opts) {
  const el = document.createElement('div');
  el.className = `window ${opts.className || ''}`.trim();
  if (opts.width) el.style.width = opts.width + 'px';
  if (opts.height) el.style.height = opts.height + 'px';
  el.style.left = (opts.x ?? 40) + 'px';
  el.style.top = (opts.y ?? 40) + 'px';

  const bar = document.createElement('div');
  bar.className = 'title-bar';

  if (opts.icon) bar.appendChild(svgIcon(opts.icon));

  const text = document.createElement('div');
  text.className = 'title-bar-text';
  text.textContent = opts.title;
  bar.appendChild(text);

  const controls = document.createElement('div');
  controls.className = 'title-bar-controls';
  bar.appendChild(controls);

  const body = document.createElement('div');
  body.className = 'window-body';

  el.append(bar, body);
  document.body.appendChild(el);

  const win = {
    el,
    body,
    titleEl: text,
    setTitle(t) {
      text.textContent = t;
    },
    focus() {
      setActive(win);
    },
    close() {
      windows.delete(win);
      el.remove();
      opts.onClose?.();
    },
    hide() {
      el.style.display = 'none';
    },
    show() {
      el.style.display = '';
      setActive(win);
    },
    get hidden() {
      return el.style.display === 'none';
    },
  };
  windows.add(win);

  const mkBtn = (cls, label, handler, disabled) => {
    const b = document.createElement('button');
    b.className = `title-btn ${cls}`;
    b.setAttribute('aria-label', label);
    b.tabIndex = -1;
    if (disabled) b.disabled = true;
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    controls.appendChild(b);
    return b;
  };

  if (opts.minimize !== false) mkBtn('min', 'Minimize', () => win.hide());

  if (opts.maximize !== false) {
    let restore = null;
    mkBtn('max', 'Maximize', () => {
      if (restore) {
        Object.assign(el.style, restore);
        restore = null;
      } else {
        restore = {
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          height: el.style.height,
        };
        Object.assign(el.style, {
          left: '0px',
          top: '0px',
          width: window.innerWidth + 'px',
          height: window.innerHeight + 'px',
        });
      }
    });
  }

  if (opts.close !== false) mkBtn('close', 'Close', () => win.close());

  // --- drag ---------------------------------------------------------------
  let drag = null;
  bar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    setActive(win);
    drag = {
      dx: e.clientX - el.offsetLeft,
      dy: e.clientY - el.offsetTop,
    };
    el.classList.add('dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    // Clamp so a window can never be dragged fully off-screen and lost.
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 22;
    el.style.left = Math.max(-(el.offsetWidth - 60), Math.min(maxX, e.clientX - drag.dx)) + 'px';
    el.style.top = Math.max(0, Math.min(maxY, e.clientY - drag.dy)) + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
  });

  el.addEventListener('mousedown', () => setActive(win), true);
  setActive(win);

  return win;
}

/** A menu bar with click-to-open popups. Items are {label, rows:[{label, onClick, disabled}|'-']}. */
export function createMenuBar(items) {
  const bar = document.createElement('div');
  bar.className = 'menu-bar';
  let openPopup = null;
  let openItem = null;

  const closeMenu = () => {
    openPopup?.remove();
    openItem?.classList.remove('open');
    openPopup = null;
    openItem = null;
  };
  document.addEventListener('mousedown', (e) => {
    if (openPopup && !openPopup.contains(e.target)) closeMenu();
  });

  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'menu-item';
    // First letter underlined, the way every 95 menu was.
    el.innerHTML = `<u>${item.label[0]}</u>${item.label.slice(1)}`;
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (openItem === el) return closeMenu();
      closeMenu();
      const popup = document.createElement('div');
      popup.className = 'menu-popup';
      item.rows.forEach((row) => {
        if (row === '-') {
          const sep = document.createElement('div');
          sep.className = 'sep';
          popup.appendChild(sep);
          return;
        }
        const r = document.createElement('div');
        r.className = 'row' + (row.disabled ? ' disabled' : '');
        r.textContent = row.label;
        if (!row.disabled) {
          r.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
            closeMenu();
            row.onClick?.();
          });
        }
        popup.appendChild(r);
      });
      const rect = el.getBoundingClientRect();
      popup.style.left = rect.left + 'px';
      popup.style.top = rect.bottom + 'px';
      document.body.appendChild(popup);
      el.classList.add('open');
      openPopup = popup;
      openItem = el;
    });
    bar.appendChild(el);
  });

  return bar;
}
