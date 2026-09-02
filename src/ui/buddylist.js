/**
 * The buddy list.
 *
 * Grouped Buddies / Family / Offline with plus-minus expanders, online counts
 * in the group headers, italic away messages beside the names, and the bottom
 * tab strip. Double-click a name to open an IM.
 *
 * The Family group is the piece's argument in one control: three real people,
 * permanently offline, twenty minutes away.
 */
import { createWindow, createMenuBar, isCompactLayout } from './window.js';
import { BUDDIES, FAMILY } from '../buddies.js';
import { runningManSVG } from '../logo.js';
import * as store from '../store.js';
import * as sounds from '../sounds.js';
import * as llm from '../llm.js';
import { openIM } from './imwindow.js';

const BL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges"><rect x="2" y="1" width="12" height="14" fill="#fff" stroke="#000"/><rect x="4" y="4" width="8" height="1" fill="#000080"/><rect x="4" y="7" width="8" height="1" fill="#000080"/><rect x="4" y="10" width="6" height="1" fill="#808080"/></svg>`;

// At 12px the four-copy trail turns to mush, so the list icons use the compact
// lead-plus-two variant.
const buddyIcon = (color) =>
  `<span class="buddy-icon">${runningManSVG({ decay: 0, color, compact: true })}</span>`;

export function createBuddyList({ onSignOff, onFatal }) {
  const me = store.getScreenName();

  /** Live per-buddy UI state, keyed by screen name. */
  const state = new Map();
  BUDDIES.forEach((b) =>
    state.set(b.screenName, {
      online: b.online,
      away: null,
      cached: false,
      blocked: false,
    })
  );

  const win = createWindow({
    title: 'Buddy List',
    icon: BL_ICON,
    className: '',
    width: 208,
    height: 428,
    x: 28,
    y: 28,
    maximize: false,
    close: false,
    minimize: false,
  });
  win.el.id = 'buddy-window';

  win.body.appendChild(
    createMenuBar([
      {
        label: 'My AIM',
        rows: [
          { label: 'Edit Profile...', disabled: true },
          { label: 'Away Message...', disabled: true },
          '-',
          { label: 'Sign Off', onClick: () => onSignOff() },
        ],
      },
      {
        label: 'People',
        rows: [
          { label: 'Send Instant Message...', onClick: () => openSelected() },
          { label: 'Get Buddy Info', onClick: () => infoSelected() },
          '-',
          { label: 'Add Buddy...', disabled: true },
        ],
      },
      {
        label: 'Help',
        rows: [
          {
            label: 'About Anomie',
            onClick: () =>
              dialog(
                'About Anomie Instant Messenger',
                'Anomie Instant Messenger.\n\nEvery buddy in this list is a language model running ' +
                  'on your own graphics card. Nothing you type leaves this machine.\n\n' +
                  'Not affiliated with, endorsed by, or derived from AOL or AIM.'
              ),
          },
          {
            label: 'Sound',
            onClick: () => {
              sounds.setMuted(!sounds.isMuted());
              dialog('Sound', sounds.isMuted() ? 'Sounds are off.' : 'Sounds are on.');
            },
          },
        ],
      },
    ])
  );

  // --- header -------------------------------------------------------------
  const header = document.createElement('div');
  header.className = 'bl-header';
  const logoWrap = document.createElement('span');
  logoWrap.className = 'logo';
  logoWrap.innerHTML = runningManSVG({ decay: 0, color: '#000080', compact: true });
  const whoWrap = document.createElement('div');
  whoWrap.style.minWidth = '0';
  whoWrap.innerHTML = `<div class="who">${me}</div><div class="sub">Anomie Instant Messenger</div>`;
  header.append(logoWrap, whoWrap);
  win.body.appendChild(header);

  // --- tree ---------------------------------------------------------------
  const tree = document.createElement('div');
  tree.className = 'well bl-tree';
  win.body.appendChild(tree);

  let selected = null;

  function render() {
    const online = BUDDIES.filter((b) => state.get(b.screenName).online && !state.get(b.screenName).blocked);
    const offlineBuddies = BUDDIES.filter(
      (b) => !state.get(b.screenName).online || state.get(b.screenName).blocked
    );

    tree.innerHTML = '';

    group('Buddies', `${online.length}/${BUDDIES.length}`, () =>
      online.flatMap((b) => buddyRow(b))
    );

    group('Family', `0/${FAMILY.length}`, () => []);

    group('Offline', String(offlineBuddies.length + FAMILY.length), () => [
      ...offlineBuddies.flatMap((b) => buddyRow(b, true)),
      ...FAMILY.flatMap((f) => familyRow(f)),
    ]);
  }

  /**
   * The touch affordance for a selected row.
   *
   * A buddy is not a link — opening one commits to a several-hundred-megabyte
   * download and a model swap. On a desktop the double-click is the confirming
   * gesture, exactly as it was in AIM. A touchscreen has no double-click, so
   * the second half of the gesture becomes this: tap to select, then say what
   * you actually meant.
   */
  function actionRow(buttons) {
    const row = document.createElement('div');
    row.className = 'buddy-actions';
    buttons.forEach(([label, fn, cls]) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      row.appendChild(b);
    });
    return row;
  }

  function blockBuddy(screenName) {
    const st = state.get(screenName);
    if (!st) return;
    st.blocked = true;
    st.online = false;
    sounds.play('doorslam');
    selected = null;
    render();
  }

  function group(name, count, childrenFn) {
    const collapsed = store.isCollapsed(name);
    const row = document.createElement('div');
    row.className = 'group-row' + (collapsed ? ' collapsed' : '');
    row.innerHTML = `<span class="expander"></span><span>${name} (${count})</span>`;
    row.addEventListener('click', () => {
      store.setCollapsed(name, !collapsed);
      render();
    });
    tree.appendChild(row);
    if (!collapsed) childrenFn().forEach((el) => tree.appendChild(el));
  }

  function buddyRow(buddy, isOffline = false) {
    const st = state.get(buddy.screenName);
    const row = document.createElement('div');
    const away = st.away;
    row.className =
      'buddy-row' +
      (isOffline ? ' offline' : '') +
      (away ? ' away' : '') +
      (selected === buddy.screenName ? ' selected' : '');
    row.innerHTML =
      buddyIcon(isOffline ? '#909090' : '#c8a000') +
      `<span class="name">${buddy.screenName}</span>` +
      (away ? `<span class="away-note">${away}</span>` : '') +
      (!away && !isOffline && !st.cached ? `<span class="away-note">(not downloaded)</span>` : '');

    const activate = () => {
      if (isOffline) {
        sounds.play('error');
        dialog(
          'Anomie Instant Messenger',
          `${buddy.screenName} is not currently signed on.`
        );
        return;
      }
      openBuddy(buddy);
    };

    row.addEventListener('click', () => {
      selected = buddy.screenName;
      render();
    });
    row.addEventListener('dblclick', activate);

    if (!isCompactLayout() || selected !== buddy.screenName) return [row];
    return [
      row,
      actionRow([
        ['Send IM', activate, 'default'],
        ['Info', () => infoFor(buddy)],
        ['Block', () => blockBuddy(buddy.screenName)],
      ]),
    ];
  }

  function familyRow(person) {
    const row = document.createElement('div');
    row.className = 'buddy-row offline' + (selected === person.screenName ? ' selected' : '');
    row.innerHTML =
      buddyIcon('#909090') + `<span class="name">${person.screenName}</span>`;
    const activate = () => {
      sounds.play('error');
      dialog(
        'Anomie Instant Messenger',
        `${person.screenName} is not currently signed on.\n\nThey are ${person.note}.`
      );
    };

    row.addEventListener('click', () => {
      selected = person.screenName;
      render();
    });
    row.addEventListener('dblclick', activate);

    if (!isCompactLayout() || selected !== person.screenName) return [row];
    // No Block. You cannot block your family, which is the joke.
    return [
      row,
      actionRow([
        ['Send IM', activate, 'default'],
        ['Info', activate],
      ]),
    ];
  }

  function openBuddy(buddy) {
    openIM(buddy, {
      onStateChange: (screenName, patch) => {
        const st = state.get(screenName);
        if (!st) return;
        Object.assign(st, patch);
        if (patch.away === null) st.cached = true;
        render();
      },
      onBlocked: (screenName) => {
        const st = state.get(screenName);
        if (st) {
          st.blocked = true;
          st.online = false;
        }
        render();
      },
      onFatal: (b, err) => onFatal?.(b, err),
    });
  }

  function openSelected() {
    const b = BUDDIES.find((x) => x.screenName === selected);
    if (b && state.get(b.screenName).online) openBuddy(b);
    else sounds.play('error');
  }

  function infoFor(buddy) {
    dialog(
      `${buddy.screenName} — Buddy Info`,
      `${buddy.profile}\n\nRunning: ${buddy.model}\nApproximate download: ${buddy.vram} MB`
    );
  }

  function infoSelected() {
    const b = BUDDIES.find((x) => x.screenName === selected);
    if (!b) return sounds.play('error');
    infoFor(b);
  }

  // --- bottom tabs --------------------------------------------------------
  const tabs = document.createElement('div');
  tabs.className = 'bl-tabs';
  [
    ['IM', () => openSelected()],
    ['Info', () => infoSelected()],
    ['Setup', () => dialog('Setup', 'Not available in this build.')],
  ].forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    tabs.appendChild(b);
  });
  win.body.appendChild(tabs);

  // --- status -------------------------------------------------------------
  const status = document.createElement('div');
  status.className = 'status-bar';
  const statusPanel = document.createElement('div');
  statusPanel.className = 'status-panel';
  statusPanel.textContent = 'Online';
  status.appendChild(statusPanel);
  win.body.appendChild(status);

  render();

  // Crossing the breakpoint changes whether the action row exists at all, so
  // rotating a phone has to rebuild the tree or the row is left stranded.
  window
    .matchMedia('(max-width: 767px)')
    .addEventListener('change', () => render());

  // Ask the Cache API which buddies are already downloaded, so the list can say
  // so before you commit to a several-hundred-megabyte conversation.
  (async () => {
    for (const b of BUDDIES) {
      const cached = await llm.isCached(b.model);
      state.get(b.screenName).cached = cached;
    }
    render();
  })();

  // DialUpDave signs on partway through the evening, with the door.
  BUDDIES.filter((b) => !b.online && b.signsOnAfterMs).forEach((b) => {
    setTimeout(() => {
      const st = state.get(b.screenName);
      if (st.blocked) return;
      st.online = true;
      sounds.play('dooropen');
      statusPanel.textContent = `${b.screenName} has signed on.`;
      render();
    }, b.signsOnAfterMs);
  });

  return {
    win,
    setStatus: (t) => {
      statusPanel.textContent = t;
    },
  };
}

/** A Win95 message box. Sharp corners, one OK button, no ceremony. */
export function dialog(title, message) {
  const win = createWindow({
    title,
    className: 'dialog',
    width: 320,
    x: Math.round(window.innerWidth / 2 - 160),
    y: Math.round(window.innerHeight / 2 - 90),
    minimize: false,
    maximize: false,
  });
  const body = document.createElement('div');
  body.style.cssText = 'padding:14px 14px 6px;white-space:pre-wrap;line-height:1.5;user-select:text';
  body.textContent = message;
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:center;padding:8px 0 12px';
  const ok = document.createElement('button');
  ok.className = 'default';
  ok.textContent = 'OK';
  ok.addEventListener('click', () => win.close());
  actions.appendChild(ok);
  win.body.append(body, actions);
  ok.focus();
  return win;
}
