import * as THREE from 'three';

/*
 * A picture's outline as flat shapes, to carve it in stone: the picture (a logo with a transparent background) is
 * read as a grid of in and out, the edges between them followed into closed loops, each loop thinned of needless
 * points and softened, and the loops sorted into outlines and the holes inside them. Centred, y up, `size` across its
 * longer side.
 */

const G = 180; // the grid the picture is read on

type Pt = [number, number];

/* the loops of edges between filled and empty cells; filled cells walked clockwise on screen, so outlines run one way and holes the other */
function loops(on: Uint8Array): Pt[][] {
  const W = G + 2, at = (x: number, y: number) => on[y * W + x];
  const out = new Map<string, Pt[]>();
  const add = (a: Pt, b: Pt) => {
    const k = `${a[0]},${a[1]}`;
    const list = out.get(k);
    if (list) list.push(b); else out.set(k, [b]);
  };
  for (let y = 1; y <= G; y++) for (let x = 1; x <= G; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add([x, y], [x + 1, y]);
    if (!at(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!at(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!at(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const result: Pt[][] = [];
  for (const [start, ends] of out) {
    while (ends.length) {
      const [sx, sy] = start.split(',').map(Number) as Pt;
      const loop: Pt[] = [[sx, sy]];
      let cur = ends.pop()!;
      for (let guard = 0; guard < 100000; guard++) {
        if (cur[0] === sx && cur[1] === sy) break;
        loop.push(cur);
        const next = out.get(`${cur[0]},${cur[1]}`);
        if (!next || !next.length) break;
        cur = next.pop()!;
      }
      if (loop.length > 8) result.push(loop);
    }
  }
  return result;
}

/* fewer points along nearly straight runs (Ramer-Douglas-Peucker), on a closed loop */
function simplify(pts: Pt[], eps: number): Pt[] {
  const rdp = (a: number, b: number, keep: boolean[]) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b % pts.length];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, best = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; far = i; }
    }
    if (far < 0) return;
    keep[far] = true;
    rdp(a, far, keep);
    rdp(far, b, keep);
  };
  const keep = pts.map(() => false);
  const half = Math.floor(pts.length / 2);
  keep[0] = keep[half] = true;
  rdp(0, half, keep);
  rdp(half, pts.length, keep);
  return pts.filter((_, i) => keep[i]);
}

/* corners rounded off a little (Chaikin), as stone wears them */
function soften(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
  });
  return out;
}

const area = (pts: THREE.Vector2[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;

function inside(p: THREE.Vector2, poly: THREE.Vector2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The outline of the picture at `url` as shapes with their holes, `size` across, centred, y up. */
export function traceImage(url: string, size: number): Promise<THREE.Shape[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve([]);
    img.onload = () => {
      const k = Math.min(G / img.width, G / img.height), w = img.width * k, h = img.height * k;
      const cv = document.createElement('canvas');
      cv.width = cv.height = G;
      const c = cv.getContext('2d', { willReadFrequently: true })!;
      c.drawImage(img, (G - w) / 2, (G - h) / 2, w, h);
      const a = c.getImageData(0, 0, G, G).data, W = G + 2, on = new Uint8Array(W * W);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) on[(y + 1) * W + x + 1] = a[(y * G + x) * 4 + 3] > 128 ? 1 : 0;
      const s = size / Math.max(w, h), mid = G / 2 + 1;
      const polys = loops(on)
        .map((l) => soften(simplify(l, 0.9)).map(([x, y]) => new THREE.Vector2((x - mid) * s, -(y - mid) * s)))
        .filter((p) => Math.abs(area(p)) > (size * size) / 2500);
      /* on screen the filled side was walked clockwise; with y turned up, outlines come out negative, holes positive */
      const outer = polys.filter((p) => area(p) < 0), holes = polys.filter((p) => area(p) > 0);
      const shapes = outer.map((p) => ({ poly: p, shape: new THREE.Shape(p), a: -area(p) }));
      for (const hole of holes) {
        const owner = shapes.filter((o) => inside(hole[0], o.poly)).sort((x, y) => x.a - y.a)[0];
        owner?.shape.holes.push(new THREE.Path(hole));
      }
      resolve(shapes.map((o) => o.shape));
    };
    img.src = url;
  });
}
