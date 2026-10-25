/*
 * The site's sound, all synthesised with Web Audio (no files): a far choir and rune chimes, and the stones' sounds:
 * cracking out of the rock, whooshing through the air, thudding onto the ground, clicking into place.
 * Browsers only allow audio after a gesture, so it starts on the first pointer press or key.
 */

const STORE = 'metin-sound';
const VOLUME = 'metin-volume';
/* the master gain at full volume */
const LOUD = 0.8;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let white: AudioBuffer | null = null;
/* the open waste the rocks' sounds roll out over, so they sound as big as they are (see makeVast) */
let hall: GainNode | null = null;
let lastSwell = 0;
let enabled = readEnabled();
let volume = readVolume();
let lastHit = 0;
let lastTick = 0;
let lastCrack = 0;

function readVolume() {
  try { const v = parseFloat(localStorage.getItem(VOLUME) ?? ''); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; } catch { return 1; }
}

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

/** Two seconds of white noise: the sharp edge of stone striking stone, which brown noise is too dull for. */
function makeWhite(c: AudioContext) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function source(c: AudioContext, loop = false, bright = false) {
  const s = c.createBufferSource();
  s.buffer = bright ? white : noise;
  s.loop = loop;
  return s;
}

/*
 * A layer of low noise for a big rock: brown noise slowed down (so it is deeper still) through a lowpass that closes
 * from `from` to `to` Hz, swelling in `attack` seconds and dying over `len`.
 */
function rumble(c: AudioContext, out: AudioNode, at: number, from: number, to: number, level: number, attack: number, len: number, rate = 0.5) {
  const n = source(c), lp = c.createBiquadFilter(), g = c.createGain();
  lp.type = 'lowpass'; lp.Q.value = 0.4;
  lp.frequency.setValueAtTime(from, at);
  lp.frequency.exponentialRampToValueAtTime(to, at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  n.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
  n.connect(lp).connect(g).connect(out);
  n.start(at, Math.random() * 1.5, len + 0.05);
}

/*
 * After a great fall the sky itself seems to answer: a deep open fifth on D, in the choir's key, swelling slowly out of
 * the echo and dying away, soft enough to be felt more than heard. At most once every few seconds.
 */
function swell(c: AudioContext, level: number) {
  const now = performance.now();
  if (now - lastSwell < 3500 || !hall) return;
  lastSwell = now;
  const t = c.currentTime + 0.15, g = c.createGain(), lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 1.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
  g.connect(lp);
  lp.connect(master!);
  lp.connect(hall);
  for (const [f, lvl] of [[73.42, 1], [110, 0.7], [146.83, 0.55], [220, 0.3]] as const) {
    for (const det of [-3, 3]) {
      const o = c.createOscillator(), og = c.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      og.gain.value = lvl * 0.5;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + 6.6);
    }
  }
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

/*
 * An endless open plain under the sky, not a room: no walls, so no early reflections. A moment of silence, then the
 * sound comes back from far away, briefly, and fades over `secs` (outdoors little sends it back), its highs lost to
 * the distance (each channel's noise smoothed more and more as it goes on), the two ears never hearing the same thing.
 */
function makeVast(c: AudioContext, secs: number) {
  const len = Math.round(c.sampleRate * secs), pre = Math.round(c.sampleRate * 0.09), bloom = c.sampleRate * 0.25;
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const k = (i - pre) / (len - pre);
      /* darker the longer it travels */
      const a = 0.5 - 0.47 * Math.sqrt(k);
      lp += a * ((Math.random() * 2 - 1) - lp);
      const env = Math.min(1, (i - pre) / bloom) * Math.pow(1 - k, 4);
      d[i] = lp * env * (2.2 + k * 3);
    }
  }
  return b;
}

/* a soft clipping curve, for sounds that should bite */
const DRIVE = (() => {
  const n = 1024, k = 3, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  return curve;
})();

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
  white = makeWhite(ctx);
  master = ctx.createGain();
  master.gain.value = 0;
  /* a limiter at the end, so many rocks landing at once can be loud without breaking up */
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -10; limit.knee.value = 8; limit.ratio.value = 6; limit.attack.value = 0.012; limit.release.value = 0.25;
  master.connect(limit).connect(ctx.destination);
  /* the plain's long tail, and the far hills answering a beat later, again and again, dimmer and duller each time */
  const conv = ctx.createConvolver();
  conv.buffer = makeVast(ctx, 2.6);
  hall = ctx.createGain();
  hall.gain.value = 0.32;
  hall.connect(conv).connect(master);
  const merge = ctx.createChannelMerger(2);
  for (const [ch, secs] of [[0, 0.62], [1, 0.87]] as const) {
    const dl = ctx.createDelay(2), fb = ctx.createGain(), dull = ctx.createBiquadFilter();
    dl.delayTime.value = secs; fb.gain.value = 0.22;
    dull.type = 'lowpass'; dull.frequency.value = 700;
    hall.connect(dl);
    dl.connect(dull).connect(fb).connect(dl);
    dull.connect(merge, 0, ch);
  }
  const echoes = ctx.createGain();
  echoes.gain.value = 0.25;
  merge.connect(echoes).connect(conv);
  startAmbience(ctx, master);
  master.gain.linearRampToValueAtTime(LOUD * volume, ctx.currentTime + 3);
}

/** A sound that lives for `dur` seconds, panned by `pan` (-1 left to 1 right); `wet` of it also rings in the hall. */
function voice(pan: number, dur: number, wet = 0) {
  const c = ctx!, g = c.createGain(), p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p).connect(master!);
  if (wet > 0 && hall) { const send = c.createGain(); send.gain.value = wet; g.connect(send).connect(hall); }
  const t = c.currentTime;
  return { c, g, t, end: t + dur };
}

const live = () => !!ctx && enabled && ctx.state === 'running';

export const sound = {
  get enabled() { return enabled; },
  get volume() { return volume; },

  /** Set the volume, 0 to 1, and remember it. */
  setVolume(v: number) {
    volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOLUME, String(volume)); } catch { /* private mode: just not remembered */ }
    if (ctx && master) master.gain.setTargetAtTime(LOUD * volume, ctx.currentTime, 0.05);
  },

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

  /**
   * A boulder coming down: each of the stones is meant as a rock of some five cubic metres, a dozen tonnes. `strength`
   * 0 to 1 is how hard it lands, `size` 0.6 to 1 how big it is among them. A sound like that lives almost all in the
   * low end: a dull split, the slow heavy crunch of stone crushing stone, a blow that shakes the ground, and the ground
   * rumbling on. Nothing bright (that is what made them sound like gravel), and no tone (that made them hollow).
   */
  hit(strength: number, pan: number, size = 0.8) {
    if (!live()) return;
    const now = performance.now();
    if (now - lastHit < 40) return;
    lastHit = now;
    const s = Math.min(1, strength);
    const z = Math.min(1, Math.max(0, size));
    const { c, g, t } = voice(pan, 2, (0.2 + s * 0.25) * (0.6 + z * 0.6));
    g.gain.value = (0.8 + s * 1.0) * (0.6 + z * 0.5);
    /* the split: dull, low, a few hundredths of a second */
    {
      const n = source(c), lp = c.createBiquadFilter(), cg = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.7 + s * 0.5, t + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      n.connect(lp).connect(cg).connect(g);
      n.start(t, Math.random() * 1.6, 0.06);
    }
    /* the crunch: coarse and slow, big pieces of stone breaking against each other, driven so it is rough */
    {
      const n = source(c), bp = c.createBiquadFilter(), lp = c.createBiquadFilter(), cg = c.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 230 + Math.random() * 120; bp.Q.value = 0.6;
      lp.type = 'lowpass'; lp.frequency.value = 650;
      const len = 0.2 + z * 0.2 + s * 0.15;
      cg.gain.setValueAtTime(0.0001, t);
      let at = t;
      while (at < t + len) {
        cg.gain.exponentialRampToValueAtTime((0.5 + Math.random() * 0.5) * (0.5 + s * 0.6), at + 0.008);
        cg.gain.exponentialRampToValueAtTime(0.06, at + 0.04);
        at += 0.035 + Math.random() * 0.045;
      }
      cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      const drive = c.createWaveShaper();
      drive.curve = DRIVE;
      n.playbackRate.value = 0.6;
      n.connect(bp).connect(lp).connect(cg).connect(drive).connect(g);
      n.start(t, Math.random() * 1.4, len + 0.1);
    }
    /* the weight: very low noise, struck at once and held a moment, its filter still */
    {
      const n = source(c), lp = c.createBiquadFilter(), wg = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 110 - z * 30; lp.Q.value = 0.3;
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.exponentialRampToValueAtTime(1.7, t + 0.004);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3 + z * 0.3);
      n.playbackRate.value = 0.5;
      n.connect(lp).connect(wg).connect(g);
      n.start(t, Math.random() * 1.5, 0.7);
    }
    /* the blow that shakes the ground: a very low push, over in a fifth of a second */
    {
      const o = c.createOscillator(), pg = c.createGain();
      o.frequency.setValueAtTime(56, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.15);
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.exponentialRampToValueAtTime((0.7 + s * 0.8) * (0.6 + z * 0.5), t + 0.006);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 + z * 0.1);
      o.connect(pg).connect(g);
      o.start(t); o.stop(t + 0.3);
    }
    /* the ground rumbling on under the echo */
    rumble(c, g, t + 0.05, 170, 40, 0.3 + s * 0.35, 0.1, 1.1 + z * 0.5 + s * 0.6, 0.25);
    /* a couple of big pieces knocking down after it */
    for (let k = 0, m = Math.round(s * 2 * Math.random()); k < m; k++) {
      const at = t + 0.15 + Math.random() * 0.35;
      rumble(c, g, at, 500, 150, 0.15 + Math.random() * 0.15, 0.005, 0.12, 0.6);
    }
    if (s > 0.55 && z > 0.85) swell(c, 0.05 + s * 0.05);
  },

  /** A rock settling into its place in a shape: a heavy dull knock and a short grind as it beds in. */
  tick(pan: number) {
    if (!live()) return;
    const now = performance.now();
    if (now - lastTick < 60) return;
    lastTick = now;
    const { c, g, t } = voice(pan, 0.7, 0.12);
    g.gain.value = 1;
    rumble(c, g, t, 420, 90, 0.5, 0.006, 0.2, 0.5);
    rumble(c, g, t + 0.03, 700, 180, 0.12, 0.03, 0.22, 0.9);
  },

  /** A rock breaking out of the bedrock: a long deep grinding, stone dragging on stone, and the rumble under it. */
  crack(pan: number) {
    if (!live()) return;
    const now = performance.now();
    if (now - lastCrack < 90) return;
    lastCrack = now;
    const dur = 0.6 + Math.random() * 0.5;
    const { c, g, t } = voice(pan, dur + 1, 0.5);
    g.gain.value = 1.7;
    /* the grind: low, ragged bursts */
    const gr = c.createGain();
    gr.connect(g);
    gr.gain.setValueAtTime(0.0001, t);
    let at = t;
    while (at < t + dur - 0.05) {
      gr.gain.exponentialRampToValueAtTime(0.12 + Math.random() * 0.2, at + 0.02);
      gr.gain.exponentialRampToValueAtTime(0.03, at + 0.07);
      at += 0.05 + Math.random() * 0.09;
    }
    gr.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const n = source(c), hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 60;
    lp.type = 'lowpass'; lp.frequency.value = 650;
    n.playbackRate.value = 0.7;
    n.connect(hp).connect(lp).connect(gr);
    n.start(t, Math.random() * 1.2, dur);
    /* the rumble under it */
    rumble(c, g, t, 180, 50, 0.3, 0.15, dur + 0.5, 0.3);
  },

  /**
   * An ancient seal giving way, over `dur` seconds and then at its breaking: not a stone's sound but an awakening.
   * Pressure gathering from far below (a drone on D, felt more than heard, steady, nothing in it that repeats), and
   * the stone cracking under the strain more and more often. Then it breaks (the caller sounds the stone breaking,
   * heavy) and the pressure lets go in a falling breath.
   */
  awaken(dur: number, pan = 0) {
    if (!live()) return;
    const c = ctx!, t = c.currentTime, end = t + dur;
    const bus = c.createGain(), p = c.createStereoPanner();
    p.pan.value = pan * 0.5;
    bus.gain.value = 1;
    bus.connect(p).connect(master!);
    /* a little of it out in the open sky (more, and the far echoes would make it go round and round) */
    if (hall) { const send = c.createGain(); send.gain.value = 0.35; bus.connect(send).connect(hall); }

    /* the pressure: D and A deep down, swelling steadily, letting go in a falling breath at the break */
    for (const [f, lvl] of [[36.71, 0.55], [55, 0.35], [73.42, 0.18]] as const) {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(f, t);
      o.frequency.setValueAtTime(f, end);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, end + 1.6);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(lvl, end - 0.05);
      og.gain.setValueAtTime(lvl * 1.3, end);
      og.gain.exponentialRampToValueAtTime(0.0001, end + 2.2);
      o.connect(og).connect(bus);
      o.start(t); o.stop(end + 2.4);
    }

    /* the stone straining: low cracks, few at first, crowding in towards the break, each one at its own moment */
    for (let k = 0; k < 9; k++) {
      const when = t + dur * (1 - Math.pow(Math.random(), 1.8)) * 0.97;
      const near = (when - t) / dur;
      rumble(c, bus, when, 500 + Math.random() * 400, 140, (0.08 + near * 0.22) * (0.6 + Math.random() * 0.6), 0.004, 0.08 + Math.random() * 0.1, 0.6);
    }

    /* the stone, far under it all */
    rumble(c, bus, t, 160, 60, 0.12, dur * 0.8, dur + 0.3, 0.28);

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
