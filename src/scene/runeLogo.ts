import * as THREE from 'three';
import { changing, rand, randomGlyph, writeRunes, type Rune } from './inscription';
import { thin } from './skeleton';

/*
 * A project's logo written in Old Turkic letters, for its nebula: the logo is thinned to the line along the middle of
 * its shapes, and letters are set along that line, turned with it. It lives a little: a light follows the pointer
 * across it, a touch sends a ripple through the letters, and on the way out the letters flare and drift off.
 */

const S = 560; // the canvas, square
const BOX = 440; // the logo's box inside it
const G = 200; // the grid the logo is thinned on
const GAP = 20; // letters apart, in canvas pixels
const SIZE = 25;

/** The letters along a logo's middle line, in canvas pixels. */
function lettersOf(img: HTMLImageElement): Rune[] {
  const k = Math.min(G / img.width, G / img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
  const cv = document.createElement('canvas');
  cv.width = cv.height = G;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(img, (G - w) / 2, (G - h) / 2, w, h);
  const a = c.getImageData(0, 0, G, G).data, on = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) on[i] = a[i * 4 + 3] > 128 ? 1 : 0;
  thin(on, G, G);
  const pix: [number, number][] = [];
  for (let i = 0; i < G * G; i++) if (on[i]) pix.push([i % G, Math.floor(i / G)]);
  /* a fixed shuffle, then the first pixel of each stretch of line that is far enough from the letters already placed */
  for (let i = pix.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pix[i], pix[j]] = [pix[j], pix[i]];
  }
  const scale = BOX / G, gap = GAP / scale, out: Rune[] = [];
  for (const [x, y] of pix) {
    if (out.some((r) => (r.x - x) ** 2 + (r.y - y) ** 2 < gap * gap)) continue;
    /* the way the line runs here, from the skeleton pixels around it, turned so the letter is never upside down */
    let sxx = 0, syy = 0, sxy = 0;
    for (const [u, v] of pix) {
      const dx = u - x, dy = v - y;
      if (dx * dx + dy * dy > 30) continue;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    out.push({ x, y, a: ang, g: randomGlyph(), ph: rand() * 6.3, flare: 0 });
  }
  const o = (S - BOX) / 2;
  out.forEach((r) => { r.x = o + r.x * scale; r.y = o + r.y * scale; });
  return out;
}

export function createRuneLogo(url: string, color = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const texture = new THREE.CanvasTexture(cv);
  const base = new THREE.Color(color), white = new THREE.Color('#ffffff');
  const grad = c.createLinearGradient(60, 60, 500, 500);
  grad.addColorStop(0.15, `#${base.clone().lerp(white, 0.75).getHexString()}`);
  grad.addColorStop(0.55, `#${base.clone().lerp(white, 0.25).getHexString()}`);
  grad.addColorStop(0.9, `#${base.clone().lerp(white, 0.6).getHexString()}`);

  const runes: Rune[] = [];
  const img = new Image();
  img.onload = () => runes.push(...lettersOf(img));
  img.src = url;
  const swap = changing(runes);

  let t = 0, leave = -1, scatter = 0, ripple = -1;
  const light = new THREE.Vector2(S / 2, S / 2), lightWant = new THREE.Vector2(), rippleAt = new THREE.Vector2();
  let lightOn = 0;

  /** A touch: a ripple runs out through the letters from where it landed. */
  const poke = () => { ripple = 0; rippleAt.copy(light); };
  const reset = () => { leave = -1; scatter = 0; ripple = -1; lightOn = 0; };

  /* goodbye: the letters flare all at once, then drift off into the cloud */
  const LEAVE = 1.9;
  const farewell = () => { if (leave < 0) leave = 0; };
  const stay = () => { leave = -1; scatter = 0; };
  const leaving = () => leave >= 0 && leave < LEAVE;

  /** `pointer`: where the pointer is across the logo (about -1 to 1), or null; `hover`: on it. */
  const update = (dt: number, pointer: THREE.Vector2 | null, hover: boolean) => {
    t += dt;
    if (pointer) lightWant.set(S / 2 + pointer.x * S / 2, S / 2 - pointer.y * S / 2);
    light.lerp(lightWant, Math.min(1, dt * 8));
    lightOn += ((pointer && pointer.length() < 1.3 ? (hover ? 1 : 0.55) : 0) - lightOn) * Math.min(1, dt * 4);
    if (ripple >= 0) ripple = ripple > 1.6 ? -1 : ripple + dt;
    if (leave >= 0) leave += dt;
    scatter = leave >= 0 ? Math.min(1, Math.max(0, (leave - 0.55) / 1.2)) : 0;
    const gather = leave >= 0 && leave < 0.55 ? Math.sin((leave / 0.55) * Math.PI) : 0;
    swap(dt);

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    /* breathing, slowly */
    const b = 1 + Math.sin(t * 1.2) * 0.012;
    c.translate(S / 2, S / 2);
    c.scale(b, b);
    c.translate(-S / 2, -S / 2);
    c.fillStyle = grad;
    c.strokeStyle = grad;
    c.lineJoin = 'round';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    writeRunes(c, runes, SIZE, 1, t, scatter, (r) => {
      /* the pointer's light, the ripple's ring passing, the flare before goodbye */
      const d2 = (r.x - light.x) ** 2 + (r.y - light.y) ** 2;
      let g = lightOn * 0.55 * Math.exp(-d2 / (2 * 85 * 85));
      if (ripple >= 0) {
        const ring = Math.abs(Math.hypot(r.x - rippleAt.x, r.y - rippleAt.y) - ripple * 380);
        g += Math.max(0, 1 - ring / 45) * (1 - ripple / 1.6) * 0.9;
      }
      return g + gather * 0.6;
    });
    c.globalAlpha = 1;
    texture.needsUpdate = true;
  };

  return { texture, update, poke, reset, farewell, stay, leaving };
}
