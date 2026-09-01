/**
 * Period sound effects, synthesized.
 *
 * These are approximations built out of oscillators and filtered noise, not the
 * original AOL wavs — those are still under copyright and are not shipped here.
 * The goal is "you remember this feeling", not "this is the same file".
 */

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = localStorage.getItem('anomie.muted') === '1';

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // One second of white noise, reused by every door sound.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** A plucked partial: fast attack, exponential decay. */
function tone(t0, freq, dur, gain, type = 'sine', detune = 0) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Band-passed noise with a swept centre frequency — the wood of the door. */
function noise(t0, dur, gain, filter) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = filter.type || 'bandpass';
  bp.Q.value = filter.q ?? 1;
  bp.frequency.setValueAtTime(filter.from, t0);
  bp.frequency.exponentialRampToValueAtTime(filter.to, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + (filter.attack ?? 0.01));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(env).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const VOICES = {
  /** Message received. The two-tone chime everyone born before 1995 still flinches at. */
  imrcv(t) {
    tone(t, 987.77, 0.13, 0.28, 'sine'); // B5
    tone(t, 1975.5, 0.07, 0.06, 'sine'); // upper partial, gives it the glassy edge
    tone(t + 0.085, 1318.51, 0.32, 0.3, 'sine'); // E6
    tone(t + 0.085, 2637.0, 0.11, 0.05, 'sine');
  },

  /** Message sent. Deliberately slighter — sending never felt as good as receiving. */
  imsend(t) {
    tone(t, 1174.66, 0.09, 0.12, 'sine');
    tone(t + 0.05, 1567.98, 0.14, 0.1, 'sine');
  },

  /** Door open — someone signed on. A creak upward, then the room. */
  dooropen(t) {
    noise(t, 0.3, 0.14, { from: 320, to: 1500, q: 3.5, attack: 0.05 });
    tone(t + 0.02, 196, 0.28, 0.09, 'triangle');
    tone(t + 0.16, 392, 0.3, 0.06, 'triangle');
  },

  /** Door slam — someone signed off. Broadband hit, then the thud in the frame. */
  doorslam(t) {
    noise(t, 0.16, 0.4, { type: 'lowpass', from: 4200, to: 260, q: 0.7, attack: 0.002 });
    tone(t, 84, 0.34, 0.42, 'sine');
    tone(t + 0.004, 128, 0.16, 0.16, 'triangle');
  },

  /** Error / offline. Two flat square blips: the sound of being told no. */
  error(t) {
    tone(t, 330, 0.12, 0.14, 'square');
    tone(t + 0.14, 262, 0.2, 0.14, 'square');
  },
};

export function play(name) {
  if (muted) return;
  if (!ensureContext()) return;
  const voice = VOICES[name];
  if (!voice) return;
  voice(ctx.currentTime + 0.01);
}

export function setMuted(value) {
  muted = !!value;
  localStorage.setItem('anomie.muted', muted ? '1' : '0');
}

export function isMuted() {
  return muted;
}

/** Called from the first click anywhere, to satisfy autoplay policy. */
export function unlock() {
  ensureContext();
}
