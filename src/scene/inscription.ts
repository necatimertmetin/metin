import { GLYPHS, RUNE_FONT } from './textures';

/*
 * Pictures written in Old Turkic letters (Lito's face, the projects' logos): letters set along lines, each glowing at
 * its own pace, now and then turning into another, and on the way out drifting off and fading.
 */

/* points along an outline, every few pixels, each with its outward normal and its distance along the outline */
export type Trace = { x: number; y: number; nx: number; ny: number; s: number }[];
export function resample(poly: [number, number][], closed: boolean, step = 5): Trace {
  const src = closed ? [...poly, poly[0]] : poly, out: Trace = [];
  let s = 0, carry = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const [ax, ay] = src[i], [bx, by] = src[i + 1], len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const tx = (bx - ax) / len, ty = (by - ay) / len;
    for (let d = carry; d < len; d += step) out.push({ x: ax + tx * d, y: ay + ty * d, nx: ty, ny: -tx, s: s + d });
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
    s += len;
  }
  return out;
}
/* a rounded rectangle, clockwise from the top left */
export function traceRoundRect(x: number, y: number, w: number, h: number, r: number): Trace {
  r = Math.min(r, w / 2, h / 2);
  const poly: [number, number][] = [], corners = [[x + w - r, y + r], [x + w - r, y + h - r], [x + r, y + h - r], [x + r, y + r]];
  corners.forEach(([cx, cy], q) => {
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + ((q + i / 12) * Math.PI) / 2;
      poly.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  });
  return resample(poly, true);
}

/* a letter of the inscription: where it sits, its turn, which letter, its own moment to glow, and a flare when it changes */
export type Rune = { x: number; y: number; a: number; g: number; ph: number; flare: number };
let seed = 7;
export const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const randomGlyph = () => Math.floor(rand() * GLYPHS.length);

/* letters along an outline, `gap` apart, each turned along it but never upside down */
export function inscribe(tr: Trace, gap: number): Rune[] {
  const out: Rune[] = [];
  let next = 0;
  for (const p of tr) {
    if (p.s < next) continue;
    next = p.s + gap;
    let a = Math.atan2(p.nx, -p.ny);
    if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
    out.push({ x: p.x, y: p.y, a, g: randomGlyph(), ph: rand() * 6.3, flare: 0 });
  }
  return out;
}

/**
 * Write letters at their places on `c` (font, fill and stroke set by the caller's style): each glows at its own pace,
 * brighter in a flare; `scatter` (0 to 1) sends each off its own way, turning a little, as it fades.
 */
export function writeRunes(c: CanvasRenderingContext2D, runes: Rune[], size: number, alpha: number, t: number, scatter: number, glow?: (r: Rune) => number) {
  c.font = `${size}px ${RUNE_FONT}`;
  c.lineWidth = size * 0.09;
  for (const r of runes) {
    const g = glow ? glow(r) : 0;
    c.globalAlpha = alpha * Math.min(1, 0.55 + 0.3 * Math.sin(t * 1.1 + r.ph) + r.flare * 0.6 + g + scatter * 0.8) * (1 - scatter);
    c.save();
    c.translate(r.x, r.y);
    if (scatter > 0) {
      const k = scatter * scatter, d = r.ph * 5 + r.g;
      c.translate(Math.cos(d) * 120 * k, Math.sin(d) * 120 * k - 40 * k);
    }
    c.rotate(r.a + (r.ph - 3) * 0.5 * scatter * scatter);
    if (g) c.scale(1 + g * 0.3, 1 + g * 0.3);
    c.strokeText(GLYPHS[r.g], 0, 0);
    c.fillText(GLYPHS[r.g], 0, 0);
    c.restore();
  }
}

/** Now and then one of the letters turns into another, with a brief flare; call it every frame. */
export function changing(runes: Rune[]) {
  let next = 0;
  return (dt: number) => {
    next -= dt;
    if (next <= 0 && runes.length) {
      next = 0.12 + Math.random() * 0.3;
      const r = runes[Math.floor(Math.random() * runes.length)];
      r.g = randomGlyph();
      r.flare = 1;
    }
    runes.forEach((r) => { r.flare = Math.max(0, r.flare - dt * 1.5); });
  };
}
