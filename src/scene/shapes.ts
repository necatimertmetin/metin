import { growVine, type Vine } from './vines';

/** Where one stone sits when its shape is whole, in world units, plus the vine that grows on it. */
export type StoneSpot = {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  tilt: number;
  glyph: number;
  vine: Vine | null;
};

/** Where a shape sits and how big it may grow, shared by every kind of shape. */
type Frame = {
  /** how many stone rows tall the shape is cut; more rows make smaller stones (default 12) */
  rows?: number;
  /** the most of the view's width and height the shape may fill, 0 to 1 (default 0.72 × 0.5) */
  maxW?: number;
  maxH?: number;
  /** the shape's centre in the view, -1 to 1 on each axis (default the middle, a little high) */
  at?: [number, number];
  /**
   * smallest and largest stone side, in grid cells (a cell is the shape's height / `rows`). Default 1 to 3, at most 2 tall.
   * A `minStone` above 1 leaves gaps where the shape is thinner than the smallest stone.
   */
  minStone?: number;
  maxStone?: number;
  /** share of stones a vine grows on, 0 to 1 (default 0.35) */
  vines?: number;
  /** colour of the rune and crack light, any CSS colour: 'red', 'royalblue', '#ff3b30' (default turquoise) */
  runeColor?: string;
};

/**
 * Anything the stones can build: a line or lines of text, an SVG path (an icon, a logo),
 * or a free canvas drawing in white. Keep a shape in a constant so its stone layout is cached.
 */
export type Shape = Frame & (
  | { text: string; font?: string; weight?: number; outline?: number }
  | { path: string; viewBox: [number, number] }
  | { draw: (ctx: CanvasRenderingContext2D, box: Box) => void }
);

/** The area a `draw` shape may use, in canvas pixels, centred on `cx`, `cy`. */
export type Box = { cx: number; cy: number; w: number; h: number };

const FAMILY = '"Inter Tight","Arial Narrow",sans-serif';

/** Shorthands for the common cases. `outline` thickens thin type (as a share of the font size) so each stroke is a stone wide. */
export const stoneText = (text: string, frame: Frame & { font?: string; weight?: number; outline?: number } = {}): Shape => ({ text, ...frame });
export const stonePath = (path: string, viewBox: [number, number], frame: Frame = {}): Shape => ({ path, viewBox, ...frame });
export const stoneDraw = (draw: (ctx: CanvasRenderingContext2D, box: Box) => void, frame: Frame = {}): Shape => ({ draw, ...frame });

/** A jigsaw piece, the mark for browser extensions. */
export const puzzlePiece = stoneDraw((ctx, { cx, cy, w, h }) => {
  const u = Math.min(w, h) / 3.2, x0 = cx - u * 1.5, y0 = cy - u * 1.5;
  const disc = (x: number, y: number) => { ctx.beginPath(); ctx.arc(x, y, u * 0.6, 0, Math.PI * 2); ctx.fill(); };
  ctx.fillRect(x0, y0, u * 3, u * 3);
  disc(cx, y0);
  disc(x0 + u * 3, cy);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  disc(cx, y0 + u * 3);
  disc(x0, cy);
  ctx.restore();
}, { maxW: 0.5, maxH: 0.62 });

function drawShape(ctx: CanvasRenderingContext2D, sh: Shape, w: number, h: number) {
  ctx.fillStyle = '#fff';
  const [ax, ay] = sh.at ?? [0, 0];
  const box: Box = { cx: w * (0.5 + ax * 0.5), cy: h * (0.46 - ay * 0.5), w: w * (sh.maxW ?? 0.72), h: h * (sh.maxH ?? 0.5) };
  if ('draw' in sh) { sh.draw(ctx, box); return; }
  if ('path' in sh) {
    const [vw, vh] = sh.viewBox, k = Math.min(box.w / vw, box.h / vh);
    ctx.translate(box.cx - (vw * k) / 2, box.cy - (vh * k) / 2);
    ctx.scale(k, k);
    ctx.fill(new Path2D(sh.path));
    return;
  }
  /* text: one or more lines, sized so the block fits the box */
  const lines = sh.text.split('\n'), lh = 0.92, font = (px: number) => `${sh.weight ?? 800} ${px}px ${sh.font ?? FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = box.h / (0.86 + (lines.length - 1) * lh);
  ctx.font = font(size);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > box.w) size *= box.w / widest;
  ctx.font = font(size);
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * (sh.outline ?? 0);
  lines.forEach((l, i) => {
    const y = box.cy + (i - (lines.length - 1) / 2) * size * lh;
    ctx.fillText(l, box.cx, y);
    if (sh.outline) ctx.strokeText(l, box.cx, y);
  });
}

/** Stone sizes in cells, [width, height], biggest first. */
function stoneSizes(min = 1, max?: number): number[][] {
  if (min <= 1 && max === undefined) return [[3, 2], [2, 2], [3, 1], [2, 1], [1, 2], [1, 1]];
  const lo = Math.max(1, Math.round(min)), hi = Math.max(lo, Math.round(max ?? 3));
  const out: number[][] = [];
  for (let w = lo; w <= hi; w++) for (let h = lo; h <= hi; h++) out.push([w, h]);
  return out.sort((a, b) => b[0] * b[1] - a[0] * a[1] || b[0] - a[0]);
}

/**
 * Cover a shape with stones of mixed sizes on a coarse grid, leaving air between them,
 * and grow vines over some of them.
 * `hw`/`hh` are the half width and height of the world area the shape is drawn into.
 * A shape that would need more than `max` stones is cut again in fewer, larger ones.
 */
export function layStones(shape: Shape, hw: number, hh: number, max: number, rows = shape.rows ?? 12): StoneSpot[] {
  const w = 900, h = Math.round((900 * hh) / hw);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  drawShape(ctx, shape, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let py = 0; py < h; py += 2) for (let px = 0; px < w; px += 2) {
    if (img[(py * w + px) * 4 + 3] > 127) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
  }
  const toWX = (p: number) => (p / w - 0.5) * 2 * hw;
  const toWY = (p: number) => -(p / h - 0.5) * 2 * hh;
  const at = (wx: number, wy: number) => {
    const ix = Math.round((wx / (2 * hw) + 0.5) * w), iy = Math.round((-wy / (2 * hh) + 0.5) * h);
    return ix >= 0 && iy >= 0 && ix < w && iy < h && img[(iy * w + ix) * 4 + 3] > 127;
  };
  if (minX > maxX) return [];
  const top = toWY(minY), bottom = toWY(maxY), left = toWX(minX), right = toWX(maxX);
  const g = (top - bottom) / rows, ncol = Math.ceil((right - left) / g) + 1;
  const occ: boolean[] = [], used: boolean[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < ncol; c++) {
    const cx = left + (c + 0.5) * g, cy = top - (r + 0.5) * g, o = g * 0.3;
    const hit = (at(cx, cy) ? 2 : 0) + [[-o, -o], [o, -o], [-o, o], [o, o]].filter(([dx, dy]) => at(cx + dx, cy + dy)).length;
    occ.push(hit >= 4);
    used.push(false);
  }
  const free = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < ncol && occ[r * ncol + c] && !used[r * ncol + c];
  const order = Array.from({ length: rows * ncol }, (_, i) => i);
  for (let j = order.length - 1; j > 0; j--) { const t = Math.floor(Math.random() * (j + 1)); [order[j], order[t]] = [order[t], order[j]]; }
  const sizes = stoneSizes(shape.minStone, shape.maxStone);
  const out: StoneSpot[] = [];
  for (const idx of order) {
    const r0 = Math.floor(idx / ncol), c0 = idx % ncol;
    if (!free(r0, c0)) continue;
    /* sometimes skip the biggest size so the large stones don't all come out the same */
    for (let si = sizes.length > 1 && Math.random() < 0.35 ? 1 : 0; si < sizes.length; si++) {
      const [sw, sh] = sizes[si];
      let ok = true;
      for (let dr = 0; dr < sh && ok; dr++) for (let dc = 0; dc < sw && ok; dc++) if (!free(r0 + dr, c0 + dc)) ok = false;
      if (!ok) continue;
      for (let dr = 0; dr < sh; dr++) for (let dc = 0; dc < sw; dc++) used[(r0 + dr) * ncol + c0 + dc] = true;
      const bw = sw * g - g * (0.12 + Math.random() * 0.08);
      const bh = sh * g - g * (0.12 + Math.random() * 0.08);
      const bd = g * (1.15 + Math.random() * 0.7);
      const vine = Math.random() < (shape.vines ?? 0.35) ? growVine(bw, bh, bd, g) : null;
      out.push({
        x: left + (c0 + sw / 2) * g, y: top - (r0 + sh / 2) * g, z: (Math.random() - 0.5) * g * 0.4,
        w: bw, h: bh, d: bd, tilt: (Math.random() - 0.5) * 0.1, glyph: Math.floor(Math.random() * 64), vine,
      });
      break;
    }
  }
  if (out.length > max && rows > 2) return layStones(shape, hw, hh, max, Math.max(2, Math.floor(rows * Math.sqrt(max / out.length))));
  return out.sort((a, b) => a.x - b.x);
}
