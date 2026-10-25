/** The eight neighbours of a pixel, clockwise from the one above. */
export const NEIGHBOURS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** Thin a mask (1 = on) down to a one-pixel skeleton along the middle of its shapes, in place (Zhang-Suen). */
export function thin(on: Uint8Array, W: number, H: number) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : on[y * W + x]);
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const kill: number[] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!on[y * W + x]) continue;
        const v = NEIGHBOURS.map(([dx, dy]) => at(x + dx, y + dy));
        const b = v.reduce((a, q) => a + q, 0);
        let t = 0;
        for (let k = 0; k < 8; k++) if (!v[k] && v[(k + 1) % 8]) t++;
        const [p2, , p4, , p6, , p8] = v;
        const ok = pass === 0 ? !(p2 && p4 && p6) && !(p4 && p6 && p8) : !(p2 && p4 && p8) && !(p2 && p6 && p8);
        if (b >= 2 && b <= 6 && t === 1 && ok) kill.push(y * W + x);
      }
      for (const i of kill) on[i] = 0;
      if (kill.length) changed = true;
    }
  }
  return on;
}
