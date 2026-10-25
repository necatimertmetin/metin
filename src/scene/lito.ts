import * as THREE from 'three';
import { inscribe, rand, randomGlyph, resample, traceRoundRect, writeRunes, changing, type Rune } from './inscription';

/*
 * Lito, alive: the little robot from the SyncroSale extension, drawn afresh every frame into a texture the nebula
 * condenses into. The head, the antenna, the ears and the eyes are the extension's own shapes (its 512 wide design
 * space), written in Old Turkic letters instead of drawn: a living inscription whose letters glow and now and then
 * change, but never move; what it does is its own: it wakes up with a blink, follows the pointer with its eyes and a tilt of the head,
 * blinks now and then, smiles when the pointer is on it, cheers when it is touched, and nods off when left alone.
 */

const S = 560; // the canvas, square, with room around the head for its bob and tilt
const STOPS: [number, string][] = [[0.2, '#e6edf3'], [0.55, '#67e8f9'], [0.85, '#c4b5fd']];

/* the parts, in letters: the head, the ears, the antenna and its dot (sizes are the letters' font size) */
const PARTS: { runes: Rune[]; size: number; pulse?: boolean }[] = [
  { runes: inscribe(traceRoundRect(64, 184, 384, 290, 82), 36), size: 42 },
  { runes: inscribe(resample([[16, 292], [16, 360]], false), 32), size: 30 },
  { runes: inscribe(resample([[496, 292], [496, 360]], false), 32), size: 30 },
  { runes: inscribe(resample([[256, 140], [256, 170]], false), 30), size: 30 },
  /* the antenna's light: one big letter */
  { runes: [{ x: 256, y: 92, a: 0, g: 0x2f, ph: 0, flare: 0 }], size: 58, pulse: true },
];
/* each eye: a ring of small letters around the eye's box (104 by 110), and a pupil of four bright ones that looks around */
const EYES = [0, 1].map(() => inscribe(traceRoundRect(0, 0, 104, 110, 36), 26));
const PUPILS = [0, 1].map(() => [[-12, -12], [12, -12], [-12, 12], [12, 12]].map(([x, y]) => ({ x, y, a: 0, g: randomGlyph(), ph: rand() * 6.3, flare: 0 })));
/* the letters the smiles and the z's are written in */
const SMILE = Array.from({ length: 16 }, randomGlyph);
const ZED = Array.from({ length: 12 }, randomGlyph);
const ALL_RUNES = [...PARTS.flatMap((p) => p.runes), ...EYES.flat(), ...PUPILS.flat()];

export function createLito() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const texture = new THREE.CanvasTexture(cv);
  const swap = changing(ALL_RUNES);
  const grad = c.createLinearGradient(40, 90, 470, 430);
  STOPS.forEach(([o, col]) => grad.addColorStop(o, col));

  let paintAcc = 1, leave = -1, scatter = 0, t = 0, awake = 0, blinkAt = 2.5, still = 0, cheer = 0, wasHover = false, hop = 0;
  const look = new THREE.Vector2(), lookWant = new THREE.Vector2(), glance = new THREE.Vector2(), last = new THREE.Vector2();
  let glanceFor = 0, glanceNext = 6;
  let smile = 0, sleepy = 0;

  /** A touch: a little cheer. */
  const poke = () => { cheer = 1.4; hop = 1; still = 0; };

  /** Start over from asleep, for when it is opened again. */
  const reset = () => { awake = 0; blinkAt = 2.5; still = 0; cheer = 0; smile = 0; sleepy = 0; leave = -1; scatter = 0; };

  /*
   * Goodbye, when its panel closes: a wink and a smile, then its letters loosen and drift off into the cloud, fading.
   * `stay` takes it back if it is opened again on the way out; `leaving` is true until the letters are gone.
   */
  const LEAVE = 2.4;
  const farewell = () => { if (awake > 0.5 && leave < 0) { leave = 0; sleepy = 0; still = 0; } };
  const stay = () => { leave = -1; scatter = 0; };
  const leaving = () => leave >= 0 && leave < LEAVE;

  /**
   * `pointer`: where the pointer is, relative to the head (about -1 to 1 across it), or null; `hover`: on the head.
   */
  const update = (dt: number, pointer: THREE.Vector2 | null, hover: boolean) => {
    t += dt;
    awake = Math.min(1, awake + dt / 1.6);

    /* left alone, it nods off; any movement of the pointer wakes it */
    if (pointer && pointer.distanceTo(last) > 0.05) { still = 0; last.copy(pointer); } else still += dt;
    if (pointer) lookWant.copy(pointer).clampLength(0, 1);
    sleepy += ((still > 7 && !hover && cheer <= 0 ? 1 : 0) - sleepy) * Math.min(1, dt * (still > 7 ? 0.7 : 5));

    /* now and then, with the pointer still, a glance away and back */
    glanceNext -= dt;
    if (glanceNext <= 0 && still > 1.5 && sleepy < 0.3) {
      glance.set(Math.random() * 2 - 1, Math.random() * 1.2 - 0.6);
      glanceFor = 0.9 + Math.random() * 0.6;
      glanceNext = 5 + Math.random() * 5;
    }
    glanceFor -= dt;
    const want = glanceFor > 0 ? glance : sleepy > 0.5 ? new THREE.Vector2(0, -0.5) : lookWant;
    look.lerp(want, Math.min(1, dt * (glanceFor > 0 ? 9 : 6)));

    if (hover && !wasHover) hop = Math.max(hop, 0.6);
    wasHover = hover;
    cheer = Math.max(0, cheer - dt);
    if (leave >= 0) leave += dt;
    const bye = leave >= 0.45;
    scatter = leave >= 0 ? Math.min(1, Math.max(0, (leave - 1.25) / 1.1)) : 0;
    /* the wink: the left eye shuts and opens again, the right stays open */
    const wink = leave >= 0.05 && leave < 0.45 ? Math.sin(((leave - 0.05) / 0.4) * Math.PI) : 0;
    smile += ((hover || cheer > 0 || bye ? 1 : 0) - smile) * Math.min(1, dt * 8);
    hop = Math.max(0, hop - dt * 2.2);

    /* a blink every few seconds, sometimes two */
    blinkAt -= dt;
    if (blinkAt < -0.16) blinkAt = Math.random() < 0.2 ? 0.25 : 3 + Math.random() * 3.5;
    const blink = blinkAt < 0 ? 1 - Math.abs(blinkAt + 0.08) / 0.08 : 0;
    /* waking: eyes shut, then open with a blink at the end */
    const wake = awake < 0.55 ? 1 : awake < 0.7 ? 1 - (awake - 0.55) / 0.15 : awake < 0.8 ? (awake - 0.7) / 0.1 : awake < 0.9 ? 1 - (awake - 0.8) / 0.1 : 0;
    const open = Math.max(0.08, 1 - Math.max(blink, wake, sleepy * 0.62));

    swap(dt);

    /* painted and sent to the graphics card thirty times a second, not every frame */
    paintAcc += dt;
    if (paintAcc < 1 / 30) return;
    paintAcc = 0;
    draw(open, Math.sin(Math.PI * hop), wink);
    texture.needsUpdate = true;
  };

  const write = (runes: Rune[], size: number, alpha = 1) => writeRunes(c, runes, size, alpha, t, scatter);

  /* letters along a path given as points, `gap` apart, from a list of letters */
  const writeAlong = (poly: [number, number][], gap: number, size: number, glyphs: number[], alpha: number) => {
    const runes = inscribe(resample(poly, false, 2), gap);
    runes.forEach((r, i) => { r.g = glyphs[i % glyphs.length]; r.ph = i * 1.3; });
    write(runes, size, alpha);
  };

  const curve = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) =>
    Array.from({ length: 24 }, (_, i) => {
      const k = i / 23, m = 1 - k;
      return [m * m * x0 + 2 * m * k * cx + k * k * x1, m * m * y0 + 2 * m * k * cy + k * k * y1] as [number, number];
    });

  const draw = (open: number, jump: number, wink: number) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    /* the head bobs, leans towards where it looks, jumps when it is glad, and wiggles in a cheer */
    const bob = Math.sin(t * 1.5) * 6 + sleepy * 8 - jump * 34;
    const wiggle = cheer > 0 ? Math.sin(t * 22) * 0.06 * Math.min(1, cheer) : 0;
    c.translate(S / 2, S / 2 + 6 + bob);
    c.rotate(look.x * 0.07 + wiggle + sleepy * 0.08);
    c.translate(-256, -280);
    c.fillStyle = grad;
    c.strokeStyle = grad;
    c.lineJoin = 'round';
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    /* the head, the ears, the antenna; the antenna's dot pulses slowly (faster in a cheer) */
    const pulse = 0.65 + 0.35 * Math.sin(t * (cheer > 0 ? 14 : 2.4));
    PARTS.forEach((p) => write(p.runes, p.size, p.pulse ? 0.55 + pulse * 0.45 : 1));

    /*
     * the eyes: they slide a little towards where it looks, the pupils further. A blink squeezes the letters flat.
     * Or, glad, the happy arcs.
     */
    const lx = look.x, ly = -look.y, sm = smile;
    if (sm < 0.98) {
      [140, 268].forEach((x, e) => {
        const ex = x + lx * 10, ey = 276 + ly * 8, px = 52 + lx * 22, py = 55 + ly * 22;
        c.save();
        c.translate(ex, ey + 55);
        c.scale(1, e === 0 ? Math.max(0.08, open * (1 - wink)) : open);
        c.translate(0, -55);
        write(EYES[e], 27, 1 - sm);
        c.translate(px, py);
        write(PUPILS[e], 30, 1 - sm);
        c.restore();
      });
    }
    if (sm > 0.02) {
      writeAlong(curve(146, 346, 191, 276 - jump * 14, 236, 346), 27, 34, SMILE, sm);
      writeAlong(curve(276, 346, 321, 276 - jump * 14, 366, 346), 27, 34, SMILE.slice(8), sm);
    }

    /* nodding off: z's in letters, rising one after another and fading */
    if (sleepy > 0.6) {
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.35 + i / 3) % 1, z = 0.6 + k * 0.7, x = 410 + k * 40 + i * 6, y = 180 - k * 110;
        const zed: [number, number][] = [[x, y], [x + 36 * z, y], [x, y + 42 * z], [x + 36 * z, y + 42 * z]];
        writeAlong(zed, 15 * z, 17 * z, ZED, ((sleepy - 0.6) / 0.4) * Math.sin(k * Math.PI));
      }
    }
    c.globalAlpha = 1;
  };

  draw(0.08, 0, 0);
  return { texture, update, poke, reset, farewell, stay, leaving };
}
