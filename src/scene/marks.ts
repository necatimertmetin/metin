import { stoneDraw, stoneGroup, stonePath, stoneSlab, stoneText } from './shapes';
import { GLYPHS, RUNE_FONT } from './textures';

/*
 * Ready-made marks for the stones, drawn in white on the shape canvas.
 * Strokes are kept thick (about a tenth of the mark) so every line is at least a stone wide.
 */

/** The React atom: three orbits and a nucleus. */
export const reactAtom = stoneDraw((ctx, { cx, cy, w, h }) => {
  const s = Math.min(w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.07;
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.48, s * 0.17, a, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
}, { rows: 26, maxH: 0.66 });

/** A TypeScript-style badge: a rounded square with TS cut out of its corner. */
export const tsBadge = stoneDraw((ctx, { cx, cy, w, h }) => {
  const s = Math.min(w, h) * 0.9, x = cx - s / 2, y = cy - s / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, s, s, s * 0.08);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.font = `800 ${s * 0.46}px "Inter Tight", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('TS', x + s * 0.92, y + s * 0.9);
  ctx.globalCompositeOperation = 'source-over';
}, { rows: 16, maxH: 0.5 });

/** A mouse pointer. */
export const cursorArrow = stonePath('M0 0 L0 17 L4.5 12.5 L7.5 19.5 L10.5 18 L7.5 11.5 L13 11.5 Z', [13, 19.5], { rows: 14, maxH: 0.56 });

/** A git branch: a trunk, a branch curving off it, three commits. */
export const gitBranch = stoneDraw((ctx, { cx, cy, w, h }) => {
  const s = Math.min(w, h), r = s * 0.13;
  const a = [cx - s * 0.22, cy + s * 0.38], b = [cx - s * 0.22, cy - s * 0.38], c = [cx + s * 0.26, cy - s * 0.16];
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.moveTo(c[0], c[1]);
  ctx.bezierCurveTo(c[0], cy + s * 0.12, a[0], cy + s * 0.04, a[0], cy + s * 0.22);
  ctx.stroke();
  for (const [x, y] of [a, b, c]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}, { rows: 16, maxH: 0.56 });

/** An envelope. */
export const envelope = stoneDraw((ctx, { cx, cy, w, h }) => {
  const s = Math.min(w / 1.5, h), ew = s * 1.4, eh = s * 0.92, x = cx - ew / 2, y = cy - eh / 2;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.15;
  ctx.lineJoin = 'round';
  ctx.strokeRect(x, y, ew, eh);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(cx, cy + eh * 0.12);
  ctx.lineTo(x + ew, y);
  ctx.stroke();
}, { rows: 16, maxW: 0.6, maxH: 0.5 });

/** A stele with lines of inscription cut across it, the shape of the Orkhon monuments. */
export const stele = stoneDraw((ctx, { cx, cy, h }) => {
  const sh = h, sw = h * 0.5, x = cx - sw / 2, y = cy - sh / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + sh);
  ctx.lineTo(x, y + sw * 0.45);
  ctx.quadraticCurveTo(x, y, cx, y);
  ctx.quadraticCurveTo(x + sw, y, x + sw, y + sw * 0.45);
  ctx.lineTo(x + sw, y + sh);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) ctx.fillRect(x + sw * 0.18, y + sh * (0.3 + i * 0.13), sw * 0.64, sh * 0.045);
  ctx.globalCompositeOperation = 'source-over';
}, { rows: 22, maxH: 0.66 });

/** Ötüken: two mountains under a sun. */
export const mountains = stoneDraw((ctx, { cx, cy, w, h }) => {
  const s = Math.min(w / 1.6, h), base = cy + s * 0.45;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.8, base);
  ctx.lineTo(cx - s * 0.25, cy - s * 0.3);
  ctx.lineTo(cx + s * 0.05, cy + s * 0.05);
  ctx.lineTo(cx + s * 0.3, cy - s * 0.12);
  ctx.lineTo(cx + s * 0.8, base);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + s * 0.42, cy - s * 0.38, s * 0.13, 0, Math.PI * 2);
  ctx.fill();
}, { rows: 16, maxW: 0.7, maxH: 0.5 });

type CardOptions = {
  title: string;
  /** a smaller line under the divider */
  role?: string;
  /** a row of short words along the bottom, joined with dots */
  tags?: string[];
  runeColor?: string;
  /** the card's centre in the view, -1 to 1, and the share of the view it fills (default a 0.7 × 0.62 card in the middle) */
  at?: [number, number];
  maxW?: number;
  maxH?: number;
};

/**
 * A card built of stones: a frame of big stones, the title in small ones, a divider, then the role and tags
 * in smaller stones still. Each part is placed relative to the card, so the whole card moves and scales as one.
 */
export function stoneCard({ title, role, tags, runeColor, at = [0, 0], maxW = 0.7, maxH = 0.62 }: CardOptions) {
  const [ax, ay] = at;
  /* `r` runs from the card's bottom (-1) to its top (1); `f` and `fw` are shares of the card's height and width */
  const place = (r: number, f: number, fw: number) => ({ at: [ax, ay + r * maxH] as [number, number], maxH: maxH * f, maxW: maxW * fw });
  const parts = [
    stoneDraw((ctx, { cx, cy, w, h }) => {
      const lw = Math.min(w, h) * 0.075;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2 + lw / 2, cy - h / 2 + lw / 2, w - lw, h - lw, Math.min(w, h) * 0.12);
      ctx.stroke();
    }, { ...place(0, 1, 1), rows: 16, vines: 0.5 }),
    stoneText(title, { ...place(0.48, 0.22, 0.8), rows: 9, spacing: 0.04, vines: 0.2 }),
    stoneDraw((ctx, { cx, cy, w, h }) => ctx.fillRect(cx - w / 2, cy - h / 2, w, h), { ...place(0.16, 0.035, 0.5), rows: 1, vines: 0 }),
  ];
  if (role) parts.push(stoneText(role, { ...place(-0.14, 0.16, 0.6), rows: 7, spacing: 0.12, vines: 0.1 }));
  if (tags?.length) parts.push(stoneText(tags.join('  '), { ...place(-0.56, 0.13, 0.66), rows: 6, spacing: 0.14, vines: 0.1 }));
  return stoneGroup(parts, { runeColor });
}

type TabletOptions = {
  title: string;
  /** smaller lines under the divider: a role, links, a short sentence */
  lines?: string[];
  runeColor?: string;
  /** the slab's centre in the view, -1 to 1, and the share of the view it fills (default 0.7 × 0.62, in the middle) */
  at?: [number, number];
  maxW?: number;
  maxH?: number;
  /** how much ivy hangs over the top edge, 0 to 1 (default 0.35) */
  vines?: number;
};

/** A row of runes as wide as `width`, the same row every time for the same `seed`. */
function runeRow(ctx: CanvasRenderingContext2D, seed: number, width: number) {
  let s = seed, row = '';
  while (ctx.measureText(row).width < width) { s = (s * 16807) % 2147483647; row += GLYPHS[s % GLYPHS.length] + ' '; }
  return row.trim();
}

/**
 * One big slab with its content cut into the face like an Orkhon inscription: bands of runes along the top and bottom,
 * the title large in the middle, a divider, and a few smaller lines. The cut letters glow like the runes,
 * brightest where the pointer is.
 */
export function stoneTablet({ title, lines = [], runeColor, at, maxW = 0.7, maxH = 0.62, vines }: TabletOptions) {
  return stoneSlab((ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* rune bands */
    ctx.font = `${h * 0.075}px ${RUNE_FONT}`;
    ctx.letterSpacing = '0px';
    ctx.fillText(runeRow(ctx, 7 + title.length, w * 0.8), w / 2, h * 0.13);
    ctx.fillText(runeRow(ctx, 31 + title.length, w * 0.8), w / 2, h * 0.87);
    /* title, as large as fits */
    let size = h * 0.19;
    const titleFont = () => { ctx.font = `800 ${size}px "Inter Tight", sans-serif`; ctx.letterSpacing = `${size * 0.03}px`; };
    titleFont();
    const tw = ctx.measureText(title).width;
    if (tw > w * 0.8) { size *= (w * 0.8) / tw; titleFont(); }
    ctx.fillText(title, w / 2, h * (lines.length ? 0.36 : 0.5));
    if (!lines.length) return;
    ctx.fillRect(w * 0.32, h * 0.48, w * 0.36, h * 0.009);
    /* lines share the band between the divider and the bottom runes */
    const step = Math.min(h * 0.09, (h * 0.22) / lines.length);
    lines.forEach((l, i) => {
      let ls = step * 0.7;
      const lineFont = () => { ctx.font = `600 ${ls}px "Hanken Grotesk", sans-serif`; ctx.letterSpacing = `${ls * 0.06}px`; };
      lineFont();
      const lw = ctx.measureText(l).width;
      if (lw > w * 0.78) { ls *= (w * 0.78) / lw; lineFont(); }
      ctx.fillText(l, w / 2, h * 0.55 + step * (i + 0.5));
    });
  }, { at, maxW, maxH, vines, runeColor });
}
