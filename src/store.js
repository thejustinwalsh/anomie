/**
 * localStorage only. No server, no account, no telemetry — the whole piece runs
 * on your machine and the transcripts never leave it.
 */

const KEY = 'anomie.v1';

const EMPTY = {
  screenName: '',
  signedOnAt: 0,
  history: {}, // screenName -> [{ from: 'me'|'them', text, at }]
  collapsed: {}, // group name -> true
  seenIntro: false,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota blown by a very long night. Drop the oldest transcript and retry once.
    const names = Object.keys(state.history);
    if (names.length) {
      delete state.history[names[0]];
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* give up quietly; the UI keeps working from memory */
      }
    }
  }
}

export function getScreenName() {
  return state.screenName;
}

export function setScreenName(name) {
  state.screenName = name;
  state.signedOnAt = Date.now();
  save();
}

export function getSignedOnAt() {
  return state.signedOnAt || Date.now();
}

export function getHistory(buddy) {
  return state.history[buddy] || [];
}

export function appendMessage(buddy, msg) {
  if (!state.history[buddy]) state.history[buddy] = [];
  state.history[buddy].push(msg);
  // Keep transcripts bounded; the model only sees a window of this anyway.
  if (state.history[buddy].length > 200) {
    state.history[buddy] = state.history[buddy].slice(-200);
  }
  save();
}

/** Replace the last message from a buddy — used while a reply streams in. */
export function replaceLastMessage(buddy, text) {
  const log = state.history[buddy];
  if (!log || !log.length) return;
  log[log.length - 1].text = text;
  save();
}

export function clearHistory(buddy) {
  delete state.history[buddy];
  save();
}

export function isCollapsed(group) {
  return !!state.collapsed[group];
}

export function setCollapsed(group, value) {
  state.collapsed[group] = !!value;
  save();
}

export function signOff() {
  state.screenName = '';
  state.signedOnAt = 0;
  save();
}

/** Wipe everything, including transcripts. */
export function reset() {
  state = structuredClone(EMPTY);
  localStorage.removeItem(KEY);
}
