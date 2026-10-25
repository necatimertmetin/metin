import * as THREE from 'three';
import type { StoneSpot } from './shapes';

export type Mode = 'lift' | 'go' | 'home' | 'fall' | 'rest' | 'away';

export type Stone = {
  p: THREE.Vector3; v: THREE.Vector3;
  r: THREE.Euler; w: THREE.Vector3;
  /** the pose a landed stone settles into: lying flat on one of its faces */
  q: THREE.Quaternion;
  /** the height a landed stone eases to as it settles onto that face */
  restY: number;
  spot: StoneSpot | null;
  mode: Mode;
  t: number; lt: number; delay: number;
  alive: number;
  seed: number;
};

export type Pointer = { has: boolean; x: number; y: number };

const rnd = (k = 1) => (Math.random() - 0.5) * k;
/** the same angle, within -π..π, so a spring back to zero takes the short way */
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3();

/** Half extents along world x and y of a stone's box turned by `q`. */
function extents(q: THREE.Quaternion, sp: StoneSpot): [number, number] {
  const e = tmpM.makeRotationFromQuaternion(q).elements;
  return [
    0.5 * (Math.abs(e[0]) * sp.w + Math.abs(e[4]) * sp.h + Math.abs(e[8]) * sp.d),
    0.5 * (Math.abs(e[1]) * sp.w + Math.abs(e[5]) * sp.h + Math.abs(e[9]) * sp.d),
  ];
}

/** Turn `q` the least amount that stands the box on whichever face is already closest to the ground. */
function restPose(q: THREE.Quaternion) {
  const e = tmpM.makeRotationFromQuaternion(q).elements;
  let j = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(e[k * 4 + 1]) > Math.abs(e[j * 4 + 1])) j = k;
  tmpV.set(e[j * 4], e[j * 4 + 1], e[j * 4 + 2]).normalize();
  UP.set(0, Math.sign(tmpV.y) || 1, 0);
  return q.premultiply(tmpQ.setFromUnitVectors(tmpV, UP));
}

function newStone(x: number, y: number, z: number): Stone {
  return { p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), q: new THREE.Quaternion(), restY: 0, spot: null, mode: 'go', t: 0, lt: 0, delay: 0, alive: 1, seed: Math.random() };
}

/**
 * The stones and how they move: they float into a shape and hover there, lift and drift to the next shape,
 * fall into a pile while the pointer is held, and gather again on release.
 */
export class StoneField {
  stones: Stone[] = [];
  /** set to 1 whenever a stone lands; the scene turns it into a small camera shake */
  shake = 0;
  private cols: Float32Array | null = null;
  private hw = 1;
  private hh = 1;
  private reduced: boolean;

  constructor(reduced: boolean) {
    this.reduced = reduced;
  }

  setView(hw: number, hh: number) {
    this.hw = hw;
    this.hh = hh;
  }

  /** Send the stones to a new set of spots, adding or retiring stones as needed. `intro` brings them up from below. */
  assign(spots: StoneSpot[], intro: boolean) {
    const { hw, hh } = this;
    const live = this.stones.filter((s) => s.mode !== 'away');
    while (live.length < spots.length) {
      const s = newStone(rnd(hw * 2.4), -hh - 1.5 - Math.random() * 2, rnd(2));
      s.r.set(rnd(3), rnd(3), rnd(3));
      live.push(s);
      this.stones.push(s);
    }
    live.sort((a, b) => a.p.x - b.p.x);
    const extra = live.length - spots.length;
    const skip = new Set<number>();
    for (let e = 0; e < extra; e++) skip.add(Math.floor(((e + 0.5) * live.length) / extra));
    let ti = 0;
    live.forEach((s, i) => {
      if (skip.has(i) || ti >= spots.length) { s.mode = 'away'; s.t = 0; s.w.set(rnd(3), rnd(3), rnd(3)); return; }
      const spot = spots[ti++];
      s.spot = spot;
      s.mode = 'lift';
      s.t = 0;
      s.lt = this.reduced || intro ? 0 : 0.18 + Math.random() * 0.3;
      s.delay = this.reduced ? 0 : (spot.x / hw * 0.5 + 0.5) * (intro ? 0.9 : 0.5) + Math.random() * 0.2;
      s.w.set(rnd(2.2), rnd(2.2), rnd(1.2));
      if (intro && !this.reduced) s.p.set(spot.x + rnd(3), -hh - 2 - Math.random() * 3, spot.z + rnd(2));
      if (this.reduced) { s.p.set(spot.x, spot.y, spot.z); s.r.set(0, 0, 0); s.mode = 'home'; }
    });
  }

  /** Drop every stone; they land and stack on a column height map along the floor. */
  crumble() {
    this.cols = new Float32Array(Math.ceil((this.hw * 3.2) / 0.12) + 2).fill(-this.hh * 0.96);
    for (const s of this.stones) {
      if (s.mode === 'away' || !s.spot) continue;
      s.mode = 'fall';
      s.v.set(rnd(1.4), Math.random() * 1.2, rnd(0.6));
      s.w.set(rnd(4), rnd(2), rnd(4));
    }
  }

  /** Lift the stones out of the pile and send them home. */
  rebuild() {
    for (const s of this.stones) {
      if (s.mode === 'away' || !s.spot) continue;
      s.mode = 'lift'; s.t = 0; s.lt = 0.15 + Math.random() * 0.3; s.delay = Math.random() * 0.4;
      s.r.set(wrap(s.r.x), wrap(s.r.y), wrap(s.r.z));
      s.w.set(rnd(1.6), rnd(1.6), rnd(1.6));
    }
  }

  get settled() {
    return this.stones.length > 0 && this.stones.every((s) => s.mode === 'home' || s.mode === 'away');
  }

  step(dt: number, time: number, pointer: Pointer) {
    const target = new THREE.Vector3();
    for (const s of this.stones) {
      const spot = s.spot;
      if (!spot && s.mode !== 'away') continue;
      s.t += dt;
      if (s.mode === 'away') {
        s.v.y += 1.5 * dt;
        s.v.x += (s.p.x > 0 ? 1 : -1) * 2 * dt;
        s.alive = Math.max(0, 1 - s.t / 1.2);
      } else if (s.mode === 'fall' && spot && this.cols) {
        s.v.y -= 32 * dt;
        const [ex, ey] = extents(tmpQ.setFromEuler(s.r), spot);
        /* everything below is measured under the stone as it is now, so it stays where it touches down */
        const contact = this.top(s.p.x, ex);
        const sink = contact - (s.p.y - ey);
        const l = this.top(s.p.x - ex * 2, ex), r = this.top(s.p.x + ex * 2, ex);
        if (sink > 0.03 - s.v.y * dt * 1.2) {
          /* came into the pile from the side (or the pile grew around it): never jump on top, ease out of it instead,
             sideways if one side is lower, else gently upwards */
          if (Math.min(l, r) < contact - 0.02) { s.v.x = (l < r ? -1 : 1) * 3; s.v.y *= 0.5; }
          else { s.p.y += Math.min(sink, 3 * dt); s.v.y = Math.max(s.v.y, 0); }
        } else if (s.p.y - ey <= contact && s.v.y < 0) {
          s.p.y = contact + ey;
          if (s.v.y < -5) { s.v.y *= -0.16; s.v.x *= 0.5; s.w.multiplyScalar(0.4); this.shake = Math.min(0.12, this.shake + 0.012); }
          else {
            restPose(s.q.setFromEuler(s.r));
            const [rx, ry] = extents(s.q, spot);
            const left = this.top(s.p.x - ex * 1.5, ex), right = this.top(s.p.x + ex * 1.5, ex);
            if (contact - Math.min(left, right) > ry * 1.4) {
              /* perched on a peak: slide off to the lower side and keep falling, so the pile spreads instead of towering */
              s.v.y = 0; s.v.x = (left < right ? -1 : 1) * 2.8;
            } else {
              /* lie down on the nearest face right here, and raise the pile under it */
              s.mode = 'rest'; s.v.set(0, 0, 0); s.w.set(0, 0, 0);
              s.restY = contact + ry;
              const [c0, c1] = this.colRange(s.p.x, rx);
              for (let c = c0; c <= c1; c++) this.cols[c] = Math.max(this.cols[c], contact + ry * 2);
            }
          }
        }
      } else if (s.mode === 'rest') {
        const k = 1 - Math.exp(-14 * dt);
        s.r.setFromQuaternion(tmpQ.setFromEuler(s.r).slerp(s.q, k));
        s.p.y += (s.restY - s.p.y) * k;
      } else if (s.mode === 'lift') {
        if (s.t >= s.delay * 0.25) {
          s.v.y += 2.6 * dt; s.v.x += s.p.x * 0.35 * dt; s.v.z += 0.6 * dt;
          if (s.t > s.delay * 0.25 + s.lt) { s.mode = 'go'; s.t = 0; }
        }
        s.v.multiplyScalar(Math.exp(-1.2 * dt));
      } else if ((s.mode === 'go' || s.mode === 'home') && spot) {
        if (s.mode === 'go' && s.t < s.delay * 0.6) {
          s.v.multiplyScalar(Math.exp(-2 * dt));
        } else {
          let near = 0;
          if (pointer.has && s.mode === 'home') { const dx = spot.x - pointer.x, dy = spot.y - pointer.y; near = Math.exp(-(dx * dx + dy * dy) * 1.1); }
          const K = s.mode === 'go' ? 22 : 70, C = s.mode === 'go' ? 6.6 : 12;
          /* a slow, individual hover so the stones never look glued in place */
          const hov = this.reduced ? 0 : 1, ph = time * 0.85 + s.seed * 40;
          target.set(spot.x + Math.sin(ph * 0.7) * 0.012 * hov, spot.y + Math.sin(ph) * 0.045 * hov, spot.z + near * 0.35);
          s.v.x += ((target.x - s.p.x) * K - s.v.x * C) * dt;
          s.v.y += ((target.y - s.p.y) * K - s.v.y * C) * dt;
          s.v.z += ((target.z - s.p.z) * K - s.v.z * C) * dt;
          const tx = near * (pointer.y - spot.y) * -0.18 + Math.sin(ph * 0.8 + 1.3) * 0.025 * hov;
          const ty = near * (pointer.x - spot.x) * 0.18 + Math.sin(ph * 0.6 + 2.1) * 0.03 * hov;
          const tz = spot.tilt + Math.sin(ph * 0.5) * 0.015 * hov;
          s.w.x += ((tx - s.r.x) * K - s.w.x * C) * dt;
          s.w.y += ((ty - s.r.y) * K - s.w.y * C) * dt;
          s.w.z += ((tz - s.r.z) * K - s.w.z * C) * dt;
          if (s.mode === 'go' && s.p.distanceTo(target) < 0.03 && s.v.length() < 0.3) { s.mode = 'home'; this.shake = Math.min(0.08, this.shake + 0.004); }
        }
      }
      if (s.mode !== 'rest') {
        s.p.addScaledVector(s.v, dt);
        s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
      }
    }
    this.stones = this.stones.filter((s) => s.alive > 0.001);
  }

  /** Columns under a stone centred at `x` with half width `hx`. */
  private colRange(x: number, hx: number): [number, number] {
    const n = this.cols!.length - 1, o = this.hw * 1.6;
    return [Math.max(0, Math.floor((x - hx + o) / 0.12)), Math.min(n, Math.floor((x + hx + o) / 0.12))];
  }

  /** Height of the pile under a stone centred at `x` with half width `hx`. */
  private top(x: number, hx: number) {
    const [c0, c1] = this.colRange(x, hx);
    let top = -this.hh * 0.96;
    for (let c = c0; c <= c1; c++) top = Math.max(top, this.cols![c]);
    return top;
  }
}
