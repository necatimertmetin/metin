import * as THREE from 'three';
import { groundHeight } from './ground';
import type { StoneSpot } from './shapes';

/** `phys`: moved by the physics engine (see physics.ts); `script`: moved by the scene itself (the opening stone's strike) */
export type Mode = 'emerge' | 'lift' | 'go' | 'home' | 'fall' | 'rest' | 'away' | 'phys' | 'script';

export type Stone = {
  p: THREE.Vector3; v: THREE.Vector3;
  r: THREE.Euler; w: THREE.Vector3;
  /** the pose a landed stone settles into: lying flat on one of its faces */
  q: THREE.Quaternion;
  /** the height a landed stone eases to as it settles onto that face; for a buried stone, where it lies in the rock */
  restY: number;
  /** on its first, slow flight up from the rock */
  slow: boolean;
  /** how much it still lies in the ground, 1 to 0: while 1 it looks like the ground itself */
  bury: number;
  spot: StoneSpot | null;
  /** the size the stone has now: it eases to its spot's size while it travels, so a new shape never makes stones jump */
  size: THREE.Vector3;
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

/** Half extents along world x and y of a box of `size` turned by `q`. */
function extents(q: THREE.Quaternion, size: THREE.Vector3): [number, number] {
  const e = tmpM.makeRotationFromQuaternion(q).elements;
  return [
    0.5 * (Math.abs(e[0]) * size.x + Math.abs(e[4]) * size.y + Math.abs(e[8]) * size.z),
    0.5 * (Math.abs(e[1]) * size.x + Math.abs(e[5]) * size.y + Math.abs(e[9]) * size.z),
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
  return { p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), q: new THREE.Quaternion(), restY: 0, slow: false, bury: 0, spot: null, size: new THREE.Vector3(), mode: 'go', t: 0, lt: 0, delay: 0, alive: 1, seed: Math.random() };
}

/**
 * The stones and how they move: at first they lie in the ground rock, break away one by one and float slowly up
 * into the shape; they hover there, lift and drift to the next shape, fall to the ground while the pointer is held,
 * and gather again on release.
 */
export class StoneField {
  stones: Stone[] = [];
  /** how much the view is shaking (the scene raises it as stones land, and lets it die away) */
  shake = 0;
  /** called when a buried stone breaks out of the ground, with the hole it leaves: centre, footprint, depth and turn */
  onBreak: ((x: number, y: number, z: number, w: number, d: number, depth: number, angle: number) => void) | null = null;
  /** called when a falling stone hits the ground, `strength` 0 to 1 */
  onLand: ((strength: number, x: number, size: number) => void) | null = null;
  /** called when a stone settles into its place in a shape */
  onHome: ((x: number) => void) | null = null;
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

  /** Height of the ground rock's surface at (x, z). */
  floorAt(x: number, z: number) {
    return -this.hh * 0.96 + groundHeight(x, z);
  }

  /**
   * Lay a stone into the rock near its spot, rune face up and flush with the surface, to break away after `delay`
   * seconds and rise for `rise` seconds before flying to its spot.
   */
  private bury(s: Stone, delay: number, rise: number) {
    const spot = s.spot!;
    const x = spot.x + rnd(2), z = rnd(6) - 0.5;
    s.r.set(-Math.PI / 2, 0, rnd(0.8));
    s.p.set(x, this.floorAt(x, z) - spot.d / 2 + 0.02, z);
    s.restY = s.p.y;
    s.v.set(0, 0, 0); s.w.set(0, 0, 0);
    s.mode = 'emerge'; s.t = 0; s.delay = delay; s.lt = rise; s.slow = true; s.bury = 1;
  }

  /**
   * Send the stones to a new set of spots, adding or retiring stones as needed. `intro` is the opening:
   * every new stone starts in the rock and they break free over about ten seconds (a stone already out, like the one
   * struck to begin, just flies to its spot). Stones added later also come out of the rock, quickly.
   */
  assign(spots: StoneSpot[], intro: boolean) {
    const { hw } = this;
    const live = this.stones.filter((s) => s.mode !== 'away');
    const fresh = new Set<Stone>();
    while (live.length < spots.length) {
      const s = newStone(0, 0, 0);
      fresh.add(s);
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
      /* a stone new to the field takes its spot's size at once; one already in flight grows into it on the way */
      if (fresh.has(s) || s.size.x === 0) s.size.set(spot.w, spot.h, spot.d);
      if (this.reduced) { s.p.set(spot.x, spot.y, spot.z); s.r.set(0, 0, 0); s.mode = 'home'; return; }
      /* the opening: from the middle outwards, a stone breaks away every moment for about seven seconds */
      if (intro && fresh.has(s)) { this.bury(s, Math.abs(spot.x / hw) * 5.5 + Math.random() * 1.8, 2 + Math.random() * 0.8); return; }
      if (fresh.has(s)) { this.bury(s, Math.random() * 0.4, 0.7); return; }
      /* still coming out of the rock: keep coming, it just flies to the new spot */
      if (s.mode === 'emerge') return;
      s.mode = 'lift';
      s.t = 0;
      s.lt = 0.18 + Math.random() * 0.3;
      s.delay = (spot.x / hw * 0.5 + 0.5) * 0.5 + Math.random() * 0.2;
      s.slow = false;
      s.w.set(rnd(2.2), rnd(2.2), rnd(1.2));
    });
  }

  /** Put stones straight into their spots, hovering there, with nothing coming or going (the opening's lone stone). */
  placeAt(spots: StoneSpot[]) {
    this.stones = spots.map((sp) => {
      const s = newStone(sp.x, sp.y, sp.z);
      s.spot = sp;
      s.size.set(sp.w, sp.h, sp.d);
      s.r.set(0, 0, sp.tilt);
      s.mode = 'home';
      return s;
    });
  }

  /** Drop every stone; each lands on the ground where it falls and stays there. */
  crumble() {
    for (const s of this.stones) {
      if (s.mode === 'away' || !s.spot) continue;
      s.mode = 'fall';
      /* a push forward or back as well, so the stones scatter over the ground instead of landing in one line */
      s.v.set(rnd(1.4), Math.random() * 1.2, rnd(5));
      s.w.set(rnd(4), rnd(2), rnd(4));
    }
  }

  /** Lift the stones out of the pile and send them home. */
  rebuild() {
    for (const s of this.stones) {
      if (s.mode === 'away' || !s.spot) continue;
      s.mode = 'lift'; s.t = 0; s.lt = 0.15 + Math.random() * 0.3; s.delay = Math.random() * 0.4; s.slow = false;
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
      if ((!spot && s.mode !== 'away') || s.mode === 'phys' || s.mode === 'script') continue;
      if (spot && s.mode !== 'away') s.size.lerp(tmpV.set(spot.w, spot.h, spot.d), 1 - Math.exp(-2.4 * dt));
      s.t += dt;
      if (s.mode === 'emerge' && spot) {
        /* lies in the rock, then trembles, cracks free and rises out of it, turning slowly upright */
        const u = s.t - s.delay;
        if (u > 0 && u < 0.8) {
          const k = u / 0.8;
          s.p.y = s.restY + Math.sin(u * 95) * 0.008 * k;
          s.r.x = -Math.PI / 2 + Math.sin(u * 70) * 0.025 * k;
        } else if (u >= 0.8) {
          if (u - dt < 0.8) this.onBreak?.(s.p.x, s.restY, s.p.z, spot.w, spot.h, spot.d, s.r.z);
          const k = Math.min(1, (u - 0.8) / s.lt), e = k * k * (3 - 2 * k);
          s.bury = 1 - Math.min(1, k * 2.5);
          s.p.y = s.restY + e * (spot.d / 2 + 0.5 + spot.h * 0.5);
          s.r.x = -Math.PI / 2 * (1 - e * 0.6);
          if (k >= 1) { s.bury = 0; s.mode = 'go'; s.t = 0; s.delay = 0; s.v.set(0, 0.4, 0); s.w.set(0, 0, 0); }
        }
      } else if (s.mode === 'away') {
        s.v.y += 1.5 * dt;
        s.v.x += (s.p.x > 0 ? 1 : -1) * 2 * dt;
        s.alive = Math.max(0, 1 - s.t / 1.2);
      } else if (s.mode === 'fall' && spot) {
        s.v.y -= 32 * dt;
        const [, ey] = extents(tmpQ.setFromEuler(s.r), s.size);
        /* every stone comes down on the ground where it falls; none stacks on another */
        const floorY = this.floorAt(s.p.x, s.p.z);
        if (s.p.y - ey <= floorY && s.v.y < 0) {
          s.p.y = floorY + ey;
          this.onLand?.(Math.min(1, -s.v.y / 18), s.p.x, Math.cbrt(s.size.x * s.size.y * s.size.z));
          if (s.v.y < -5) { s.v.y *= -0.16; s.v.x *= 0.5; s.v.z *= 0.5; s.w.multiplyScalar(0.4); }
          else {
            /* and tips over onto whichever face is nearest the ground, right there */
            restPose(s.q.setFromEuler(s.r));
            s.restY = floorY + extents(s.q, s.size)[1];
            s.mode = 'rest'; s.v.set(0, 0, 0); s.w.set(0, 0, 0);
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
          /* the first flight up from the rock is slow and heavy; later moves are brisk */
          const K = s.mode === 'go' ? (s.slow ? 4.5 : 22) : 70, C = s.mode === 'go' ? (s.slow ? 3.9 : 6.6) : 12;
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
          if (s.mode === 'go' && s.p.distanceTo(target) < 0.03 && s.v.length() < 0.3) { s.mode = 'home'; s.slow = false; this.onHome?.(s.p.x); }
        }
      }
      if (s.mode !== 'rest') {
        s.p.addScaledVector(s.v, dt);
        s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
      }
    }
    this.stones = this.stones.filter((s) => s.alive > 0.001);
  }
}
