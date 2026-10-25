/*
 * The site's sound, all synthesised with Web Audio (no files): a far choir and rune chimes, and the stones' sounds:
 * cracking out of the rock, whooshing through the air, thudding onto the ground, clicking into place.
 * Browsers only allow audio after a gesture, so it starts on the first pointer press or key.
 */

const STORE = 'metin-sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = readEnabled();
let lastHit = 0;
let lastTick = 0;
let lastCrack = 0;

function readEnabled() {
  try { return localStorage.getItem(STORE) !== 'off'; } catch { return true; }
}

/** Two seconds of brown noise, looped or sliced for every sound. */
function makeNoise(c: AudioContext) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return b;
}

function source(c: AudioContext, loop = false) {
  const s = c.createBufferSource();
  s.buffer = noise;
  s.loop = loop;
  return s;
}

/** A synthetic hall: stereo noise fading away over `secs`, for a convolver. */
function makeHall(c: AudioContext, secs: number) {
  const len = Math.round(c.sampleRate * secs), b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return b;
}

/* the chords the choir drifts through, in D aeolian: Dm9, B♭maj7, Gm over D, Asus4 (four voices each, in Hz) */
const CHORDS = [
  [220, 293.66, 349.23, 440],
  [233.08, 293.66, 349.23, 440],
  [196, 293.66, 392, 466.16],
  [220, 293.66, 329.63, 440],
];
/* the runes' chimes: D minor pentatonic, high */
const CHIMES = [587.33, 659.25, 880, 1046.5, 1174.66, 1318.5];

/**
 * One sung voice: two detuned saws through the formants of a vowel ("ah" by default),
 * with a slow, slightly uneven vibrato. Returns its pitch, to glide between chords.
 */
function singer(c: AudioContext, out: AudioNode, freq: number, level: number, formants: [number, number, number] = [700, 1150, 2600]) {
  const g = c.createGain();
  g.gain.value = level;
  const bank = formants.map((f, i) => {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 7 + i * 3;
    const bg = c.createGain();
    bg.gain.value = [1, 0.45, 0.18][i];
    bp.connect(bg).connect(g);
    return bp;
  });
  const pitch = c.createConstantSource();
  pitch.offset.value = freq;
  const vib = c.createOscillator(), vibAmt = c.createGain();
  vib.frequency.value = 4.6 + Math.random() * 0.9;
  vibAmt.gain.value = freq * 0.004;
  vib.connect(vibAmt);
  for (const det of [-7, 6]) {
    const o = c.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 0; o.detune.value = det;
    pitch.connect(o.frequency);
    vibAmt.connect(o.frequency);
    for (const bp of bank) o.connect(bp);
    o.start();
  }
  pitch.start(); vib.start();
  g.connect(out);
  return pitch.offset;
}

/**
 * The ambience: a distant choir drifting slowly through modal chords over a low hummed D,
 * with now and then a high chime, all far off in a long hall.
 */
function startAmbience(c: AudioContext, out: AudioNode) {
  const hall = c.createConvolver(), wet = c.createGain(), dry = c.createGain(), bus = c.createGain();
  hall.buffer = makeHall(c, 5.5);
  wet.gain.value = 0.85; dry.gain.value = 0.25; bus.gain.value = 0.5;
  bus.connect(hall).connect(wet).connect(out);
  bus.connect(dry).connect(out);

  /* the choir, breathing slowly in and out */
  const choir = c.createGain();
  choir.gain.value = 0.022;
  const breath = c.createOscillator(), breathAmt = c.createGain();
  breath.frequency.value = 0.07; breathAmt.gain.value = 0.008;
  breath.connect(breathAmt).connect(choir.gain);
  breath.start();
  choir.connect(bus);
  const voices = CHORDS[0].map((f) => singer(c, choir, f, 1));

  /* the pedal: a low D on "oo" that never moves */
  const pedal = c.createGain();
  pedal.gain.value = 0.03;
  pedal.connect(bus);
  singer(c, pedal, 73.42, 1, [300, 870, 2240]);
  singer(c, pedal, 146.83, 0.5, [300, 870, 2240]);

  /* every ten seconds or so the voices glide to the next chord */
  let chord = 0;
  const nextChord = () => {
    chord = (chord + 1) % CHORDS.length;
    voices.forEach((v, i) => v.setTargetAtTime(CHORDS[chord][i], c.currentTime, 1.6));
    setTimeout(nextChord, 9000 + Math.random() * 4000);
  };
  setTimeout(nextChord, 10000);

  /* and once in a while, a rune chimes */
  const chime = () => {
    if (c.state === 'running') {
      const t = c.currentTime, f = CHIMES[Math.floor(Math.random() * CHIMES.length)];
      const g = c.createGain(), p = c.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      g.connect(p).connect(bus);
      /* a bell: the note, and a quieter inharmonic partial above it */
      for (const [mul, lvl] of [[1, 1], [2.76, 0.25]] as const) {
        const o = c.createOscillator(), og = c.createGain();
        o.frequency.value = f * mul; og.gain.value = lvl;
        o.connect(og).connect(g);
        o.start(t); o.stop(t + 4.2);
      }
    }
    setTimeout(chime, 6000 + Math.random() * 9000);
  };
  setTimeout(chime, 4000);
}

function ensure() {
  if (ctx || !enabled) return;
  try { ctx = new AudioContext(); } catch { return; }
  noise = makeNoise(ctx);
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  startAmbience(ctx, master);
  master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 3);
}

/** A sound that lives for `dur` seconds, panned by `pan` (-1 left to 1 right). */
function voice(pan: number, dur: number) {
  const c = ctx!, g = c.createGain(), p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p).connect(master!);
  const t = c.currentTime;
  return { c, g, t, end: t + dur };
}

const live = () => !!ctx && enabled && ctx.state === 'running';

export const sound = {
  get enabled() { return enabled; },

  /** Turn all sound on or off, and remember the choice. */
  setEnabled(on: boolean) {
    enabled = on;
    try { localStorage.setItem(STORE, on ? 'on' : 'off'); } catch { /* private mode: just not remembered */ }
    if (on) { ensure(); void ctx?.resume(); } else void ctx?.suspend();
  },

  /** Call from any user gesture; the first one starts the audio. */
  unlock() {
    ensure();
    if (ctx && enabled && ctx.state !== 'running') void ctx.resume();
  },

  /** Pause while the tab is hidden. */
  setVisible(visible: boolean) {
    if (!ctx || !enabled) return;
    if (visible) void ctx.resume(); else void ctx.suspend();
  },

  /** A stone hitting the ground: `strength` 0 to 1. */
  hit(strength: number, pan: number) {
    if (!live()) return;
    const now = performance.now();
    if (now - lastHit < 28) return;
    lastHit = now;
    const s = Math.min(1, strength);
    const { c, g, t, end } = voice(pan, 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 + s * 0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + s * 0.25);
    const n = source(c), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500 + s * 1400;
    n.playbackRate.value = 0.7 + Math.random() * 0.5;
    n.connect(lp).connect(g);
    n.start(t, Math.random() * 1.5, 0.4);
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.setValueAtTime(95 + Math.random() * 30, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    og.gain.value = 0.6;
    o.connect(og).connect(g);
    o.start(t); o.stop(end);
  },

  /** A stone settling into its place in a shape: a small dry click. */
  tick(pan: number) {
    if (!live()) return;
    const now = performance.now();
    if (now - lastTick < 45) return;
    lastTick = now;
    const { c, g, t } = voice(pan, 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const n = source(c), bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 1200; bp.Q.value = 2;
    n.playbackRate.value = 2;
    n.connect(bp).connect(g);
    n.start(t, Math.random() * 1.5, 0.1);
  },

  /** A stone cracking out of the rock: a short scratchy grind. */
  crack(pan: number) {
    if (!live()) return;
    const now = performance.now();
    if (now - lastCrack < 70) return;
    lastCrack = now;
    const dur = 0.35 + Math.random() * 0.3;
    const { c, g, t, end } = voice(pan, dur);
    g.gain.setValueAtTime(0.0001, t);
    /* a ragged envelope of little bursts reads as stone grinding on stone */
    let at = t;
    while (at < end - 0.03) {
      g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.12, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.01, at + 0.03);
      at += 0.02 + Math.random() * 0.05;
    }
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const n = source(c), hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 250;
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    n.playbackRate.value = 1.6;
    n.connect(hp).connect(lp).connect(g);
    n.start(t, Math.random() * 1.2, dur);
  },

  /** Stones lifting and flying: a broad rush of air over `dur` seconds. */
  whoosh(dur = 1.6, strength = 1) {
    if (!live()) return;
    const { c, g, t, end } = voice(0, dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * strength, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const n = source(c, true), bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(300, end);
    n.connect(bp).connect(g);
    n.start(t); n.stop(end);
  },
};
