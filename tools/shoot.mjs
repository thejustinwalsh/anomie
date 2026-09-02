/**
 * Screenshot harness.
 *
 * Drives headless Chrome over the DevTools Protocol so every capture is a real
 * render of the real app at an exact pixel size — the OG image included, which
 * means the unfurl card can never drift away from what the site actually looks
 * like.
 *
 *   node tools/shoot.mjs [baseUrl]
 *
 * Writes PNGs into screenshots/ (and the committed public/og.png).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5183/anomie/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** A real transcript, captured from a live SunshineGrrl82 (Llama-3.2-1B) session. */
const SEED = {
  screenName: 'notyourbuddy_99',
  signedOnAt: Date.now() - 11 * 60 * 1000, // mid-session, so the runner has faded
  history: {
    SunshineGrrl82: [
      { from: 'me', text: 'hey', at: 1 },
      { from: 'them', text: 'HI!!! omg hi!! :-) u have the BEST screen name i swear', at: 2 },
      { from: 'me', text: 'cant sleep', at: 3 },
      { from: 'them', text: 'wut u mean u cant sleep?? i cant sleep either lol wanna stay up??', at: 4 },
      { from: 'me', text: 'do you ever talk to anyone who isnt online', at: 5 },
      {
        from: 'them',
        text: "omg what a QUESTION!! ur so deep!! :-) anyway everyone at work is boring and ur not!!",
        at: 6,
      },
    ],
  },
  collapsed: {},
  seenIntro: true,
};

// --- minimal CDP client ----------------------------------------------------

let ws;
let nextId = 1;
const pending = new Map();
const waiters = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** Resolve once a given CDP event fires. */
function once(method, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout);
    waiters.push({ method, resolve: (p) => { clearTimeout(t); resolve(p); } });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a boolean expression in the page until it is true. */
async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(`(() => { try { return !!(${expression}); } catch { return false; } })()`))
        return;
    } catch {
      /* mid-navigation; try again */
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for: ${expression}`);
}

async function evaluate(expression, awaitPromise = true) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      'page error: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text)
    );
  }
  return res.result?.value;
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        ws.addEventListener('message', (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
          } else if (msg.method) {
            for (let j = waiters.length - 1; j >= 0; j--) {
              if (waiters[j].method === msg.method) waiters.splice(j, 1)[0].resolve(msg.params);
            }
          }
        });
        return;
      }
    } catch {
      /* Chrome not up yet */
    }
    await sleep(250);
  }
  throw new Error('could not attach to Chrome');
}

/**
 * @param {object} shot
 * @param {string} shot.file      output filename
 * @param {number} shot.width @param {number} shot.height   CSS pixels
 * @param {number} [shot.scale]   deviceScaleFactor
 * @param {boolean} [shot.mobile]
 * @param {string} [shot.url]     defaults to BASE
 * @param {boolean} [shot.seed]   seed localStorage and reload before shooting
 * @param {string} [shot.script]  JS to run once the app has booted
 * @param {number} [shot.settle]  extra ms before the capture
 */
async function shoot(shot) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.scale ?? 2,
    mobile: !!shot.mobile,
  });

  const url = shot.url || BASE;
  let loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;

  if (shot.seed) {
    await evaluate(
      `localStorage.setItem('anomie.v1', ${JSON.stringify(JSON.stringify(SEED))});
       localStorage.setItem('anomie.muted','1'); true`,
      false
    );
    loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
  }

  // The dev server's HMR client will full-reload the page out from under us if
  // it has a pending update, which silently reverts everything the setup script
  // just did. So: wait for the app to boot, run the script, then verify it
  // actually took — and if the page reloaded, do it again.
  const ready = shot.ready ?? `!!document.querySelector('.buddy-row')`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await waitFor(ready);
    await sleep(shot.settle ?? 500);
    if (!shot.script) break;

    await evaluate(shot.script);
    await sleep(shot.after ?? 500);

    if (!shot.verify) break;
    if (await evaluate(`(() => { try { return !!(${shot.verify}); } catch { return false; } })()`)) break;

    if (attempt === 6) throw new Error(`setup for ${shot.file} kept getting reverted`);
    console.log(`    (page reloaded, retrying ${shot.file})`);
  }

  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  const dest = path.join(shot.dir || OUT, shot.file);
  await writeFile(dest, Buffer.from(data, 'base64'));
  console.log(`  ${path.relative(ROOT, dest)}  (${shot.width}x${shot.height} @${shot.scale ?? 2}x)`);
}

/** Open an IM with a buddy that already has a seeded transcript. */
const OPEN_IM = `(() => {
  const row = [...document.querySelectorAll('.buddy-row')].find(r => r.textContent.includes('SunshineGrrl82'));
  row.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
  return true;
})()`;

/** True once an IM window is open with the seeded transcript rendered in it. */
const IM_OPEN = `document.querySelectorAll('.im-window .im-history .line').length >= 6`;

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(path.join(ROOT, 'public'), { recursive: true });

  const profile = path.join(ROOT, '.chrome-shoot');
  await rm(profile, { recursive: true, force: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    await connect();
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('capturing:');

    // 1 — the desktop: buddy list floating over the hills.
    await shoot({
      file: '01-desktop.png',
      width: 1280,
      height: 800,
      seed: true,
    });

    // 2 — a conversation in progress, with a genuine model reply.
    await shoot({
      file: '02-conversation.png',
      width: 1280,
      height: 800,
      seed: true,
      script: `(() => {
        const row = [...document.querySelectorAll('.buddy-row')]
          .find(r => r.textContent.includes('SunshineGrrl82'));
        row.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));

        // Sit the pair lower and more central than the default cascade, so the
        // frame isn't three-quarters empty desktop.
        const bl = document.getElementById('buddy-window');
        bl.style.left = '96px'; bl.style.top = '150px';
        const im = document.querySelector('.im-window');
        im.style.left = '392px'; im.style.top = '236px';
        return true;
      })()`,
      verify: IM_OPEN,
    });

    // 3 — mobile buddy list, full-bleed.
    await shoot({
      file: '03-mobile-buddylist.png',
      width: 390,
      height: 844,
      mobile: true,
      seed: true,
    });

    // 4 — mobile conversation, full-bleed. The dense view is the harder case.
    await shoot({
      file: '04-mobile-im.png',
      width: 390,
      height: 844,
      mobile: true,
      seed: true,
      script: OPEN_IM,
      verify: IM_OPEN,
    });

    // 5 — the running man, at size and across the session decay.
    await shoot({
      file: '05-logo.png',
      width: 900,
      height: 268,
      url: BASE + 'tools/logo-sheet.html',
      ready: `document.querySelectorAll('#sheet figure').length === 6`,
    });

    // 6 — the unfurl card, at exactly 1200x630.
    await shoot({
      dir: path.join(ROOT, 'public'),
      file: 'og.png',
      width: 1200,
      height: 630,
      scale: 1,
      seed: true,
      verify: `document.getElementById('buddy-window').style.transform === 'scale(2.3)'
               && !document.getElementById('colophon')`,
      script: `(() => {
        document.getElementById('colophon')?.remove();

        // Shift the caption right to clear the space the window is about to
        // occupy. Retargeting the arc in place rather than re-importing the
        // module keeps this working against a production build too.
        const svg = document.querySelector('#backdrop svg');
        svg.querySelector('#arc').setAttribute('d', 'M 500 240 Q 830 128 1160 240');
        svg.querySelector('g[font-size]').setAttribute('font-size', '78');

        // Collapse Offline so the list reads as content rather than a long
        // column of grayed-out names at thumbnail size.
        [...document.querySelectorAll('.group-row')]
          .find(r => r.textContent.startsWith('Offline'))?.click();

        // '(not downloaded)' is real and on-theme in the app, but it is
        // illegible noise once this is scaled to an iMessage thumbnail.
        document.querySelectorAll('.away-note').forEach(n => n.remove());

        const w = document.getElementById('buddy-window');
        // Scale the real window rather than rebuilding one: Chrome rasterizes
        // at the transformed scale, so the 1px bevels come out as crisp chunky
        // blocks, which is the correct look for this of all projects.
        // Sized so the tree ends just under the last group rather than
        // trailing off into empty white, which is dead weight at thumbnail size.
        w.style.height = '238px';
        w.style.transformOrigin = 'top left';
        w.style.transform = 'scale(2.3)';
        w.style.left = '44px';
        w.style.top = '34px';
        return {
          colophon: !!document.getElementById('colophon'),
          notes: document.querySelectorAll('.away-note').length,
          transform: getComputedStyle(w).transform,
          w: w.getBoundingClientRect().width,
        };
      })()`,
    });

    console.log('done.');
  } finally {
    try { ws?.close(); } catch {}
    chrome.kill();
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
