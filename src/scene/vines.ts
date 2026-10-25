import * as THREE from 'three';

/** One vine in a stone's own space (world units, centred on the stone): stem segments and leaves, as instance matrices. */
export type Vine = { stem: THREE.Matrix4[]; leaves: THREE.Matrix4[] };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * A point on a rounded rectangle loop of half sizes `A` × `B` and corner radius `R`, at arc length `s`,
 * starting on the +v side at u = -(A - R) and running towards +u. Returns position and outward normal in (u, v).
 */
function loopPoint(A: number, B: number, R: number, s: number): [number, number, number, number] {
  const a = Math.max(0, A - R), b = Math.max(0, B - R), q = (Math.PI / 2) * R;
  const parts = [2 * a, q, 2 * b, q, 2 * a, q, 2 * b, q];
  const P = parts.reduce((x, y) => x + y, 0);
  s = ((s % P) + P) % P;
  let i = 0;
  while (s > parts[i] && i < 7) { s -= parts[i]; i++; }
  const arc = (cu: number, cv: number, from: number) => {
    const t = from - s / R;
    return [cu + Math.cos(t) * R, cv + Math.sin(t) * R, Math.cos(t), Math.sin(t)] as [number, number, number, number];
  };
  switch (i) {
    case 0: return [-a + s, B, 0, 1];
    case 1: return arc(a, b, Math.PI / 2);
    case 2: return [A, b - s, 1, 0];
    case 3: return arc(a, -b, 0);
    case 4: return [a - s, -B, 0, -1];
    case 5: return arc(-a, -b, -Math.PI / 2);
    case 6: return [-A, -b + s, -1, 0];
    default: return arc(-a, b, Math.PI);
  }
}

function loopLength(A: number, B: number, R: number) {
  return 4 * Math.max(0, A - R) + 4 * Math.max(0, B - R) + 2 * Math.PI * R;
}

const Y = new THREE.Vector3(), Z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();

/**
 * Grow a vine over a `w` × `h` × `d` stone. It either drapes from the top over the front edge and down the face,
 * or creeps across the front and around the sides, following the stone's rounded edges with a slow wander.
 * `g` sets the scale of stem and leaves (the stone grid cell).
 */
export function growVine(w: number, h: number, d: number, g: number): Vine {
  const m = Math.min(w, h, d), R = 0.2 * m, lift = m * 0.09 + g * 0.02;
  const drape = Math.random() < 0.6;
  /* the loop's plane: (u, v) are its axes in stone space, `side` the axis the vine wanders along */
  const [A, B, Sd] = drape ? [d / 2, h / 2, w / 2] : [w / 2, d / 2, h / 2];
  const Ru = R + lift;
  const P = loopLength(A + lift, B + lift, Ru);
  const top = 2 * Math.max(0, A - R), side = 2 * Math.max(0, B - R), q = (Math.PI / 2) * Ru;
  /* drape: start on the top towards the back; creep: start on one side towards the back */
  const s0 = drape ? top * rnd(0.1, 0.5) : P - q - side * rnd(0.1, 0.5);
  const len = drape ? (top - s0 + q + side * rnd(0.5, 1.15)) : (P - s0 + top + q + side * rnd(0.1, 0.6));
  const off0 = rnd(-0.6, 0.6) * Math.max(0, Sd - R), amp = Math.min(Sd * 0.3, g * 0.22), f = rnd(1.6, 2.8) / g, ph = rnd(0, 6.28);

  const at = (s: number, n: THREE.Vector3) => {
    const [pu, pv, nu, nv] = loopPoint(A + lift, B + lift, Ru, s0 + s);
    const o = THREE.MathUtils.clamp(off0 + Math.sin(s * f + ph) * amp, -Sd + R, Sd - R);
    if (drape) { n.set(0, nv, nu); return new THREE.Vector3(o, pv, pu); }
    n.set(nu, 0, nv);
    return new THREE.Vector3(pu, o, pv);
  };

  const stem: THREE.Matrix4[] = [], leaves: THREE.Matrix4[] = [];
  const ds = g * 0.08, r = g * rnd(0.03, 0.042);
  const n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
  let p0 = at(0, n0);
  for (let s = ds, k = 0; s <= len; s += ds, k++) {
    const p1 = at(s, n1);
    const dir = Z.subVectors(p1, p0), l = dir.length();
    if (l > 1e-5) {
      /* stem: a thin cylinder from p0 to p1, a touch longer so the joints close */
      tmpQ.setFromUnitVectors(UP, dir.clone().divideScalar(l));
      const thin = 1 - (s / len) * 0.6;
      stem.push(new THREE.Matrix4().compose(p0.clone().lerp(p1, 0.5), tmpQ.clone(), new THREE.Vector3(r * thin, l * 1.25, r * thin)));
      /* leaves: alternate sides every couple of segments, lying almost flat on the stone */
      if (Math.random() < 0.5) {
        const a = dir.clone().divideScalar(l).applyAxisAngle(n1, (k % 2 ? 1 : -1) * rnd(0.6, 1.1));
        const nn = n1.clone().addScaledVector(a, rnd(0.1, 0.35)).normalize();
        a.addScaledVector(nn, -a.dot(nn)).normalize();
        const b = Y.crossVectors(nn, a);
        const sz = g * rnd(0.36, 0.54) * (1 - (s / len) * 0.3);
        /* the leaf stands stalk down in its square, so its up is turned onto `a`, out from the stem, its stalk at the stem */
        const pos = p1.clone().addScaledVector(a, sz * 0.46).addScaledVector(nn, g * 0.012);
        leaves.push(new THREE.Matrix4().makeBasis(b.clone().negate(), a.clone(), nn).scale(new THREE.Vector3(sz, sz, sz)).setPosition(pos));
      }
    }
    p0 = p1;
  }
  return { stem, leaves };
}
