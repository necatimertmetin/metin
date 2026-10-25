import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { groundHeight } from './ground';
import type { Stone } from './stones';

/*
 * Real rigid-body physics for the stones while they are dropped, with Rapier (a game physics engine, as WebAssembly):
 * every stone is a solid round-edged box of its own size that tumbles, collides, stacks and slides on the ground rock.
 * Only the fall is simulated; building shapes and hovering stay hand-animated.
 */

const STEP = 1 / 60;
/* stronger than Earth's: the scene is small, and stones falling at 9.8 units/s² look like they float */
const GRAVITY = -26;

const tmpQ = new THREE.Quaternion();

/** A pit left in the ground where a stone broke out: its middle, its footprint turned by `angle`, and how deep it is. */
export type Pit = { x: number; z: number; w: number; d: number; angle: number; depth: number };

/* the coarse ground's grid, and the fine one laid over the pits */
const X0 = -22, Z0 = -16, CELL = 0.5, NX = 88, NZ = 56, FINE = 0.08;

export class StonePhysics {
  private readonly world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  private readonly queue = new RAPIER.EventQueue(true);
  private readonly bodies = new Map<Stone, RAPIER.RigidBody>();
  private readonly byCollider = new Map<number, Stone>();
  private readonly lastHit = new Map<Stone, number>();
  /*
   * whether a stone may sound again: a contact keeps reporting force for as long as a stone rests or rubs on something,
   * so after it sounds once it must get moving again (bounce up, tumble) before it can sound a second time
   */
  private readonly armed = new Set<Stone>();
  private ground: RAPIER.Collider | null = null;
  private pitGround: RAPIER.Collider | null = null;
  private base = 0;
  private pits: readonly Pit[] = [];
  private pitCount = -1;
  private acc = 0;
  private time = 0;
  /** called when a stone strikes something hard enough to hear, `strength` 0 to 1, `size` its typical side */
  onHit: ((strength: number, x: number, size: number) => void) | null = null;

  /** Load the engine (it is WebAssembly) and make an empty world. */
  static async create() {
    await RAPIER.init();
    return new StonePhysics();
  }

  private constructor() {
    this.world.timestep = STEP;
  }

  /** Whether any stone is being simulated. */
  get active() {
    return this.bodies.size > 0;
  }

  /** (Re)build the ground rock's collider: the same heights as its mesh, over the area stones can land on. */
  setGround(base: number) {
    this.base = base;
    this.pitCount = -1;
    this.buildGround();
  }

  /** The pits stones have left in the ground, so stones can fall into them; rebuilt only when more have opened. */
  setPits(pits: readonly Pit[]) {
    this.pits = pits;
    if (pits.length !== this.pitCount) this.buildGround();
  }

  /*
   * The ground's collider: its heights on a coarse grid, except over the patch the pits are in (snapped to that grid),
   * where a fine grid takes over whose points inside a pit are sunk to the pit's floor.
   */
  private buildGround() {
    this.pitCount = this.pits.length;
    let i0 = NX, i1 = 0, j0 = NZ, j1 = 0;
    for (const p of this.pits) {
      const r = Math.hypot(p.w, p.d) / 2;
      i0 = Math.min(i0, Math.floor((p.x - r - X0) / CELL)); i1 = Math.max(i1, Math.ceil((p.x + r - X0) / CELL));
      j0 = Math.min(j0, Math.floor((p.z - r - Z0) / CELL)); j1 = Math.max(j1, Math.ceil((p.z + r - Z0) / CELL));
    }
    i0 = Math.max(0, i0); i1 = Math.min(NX, i1); j0 = Math.max(0, j0); j1 = Math.min(NZ, j1);
    const patch = i0 < i1 && j0 < j1;

    /* the coarse ground, with the pits' patch left out */
    if (this.ground) this.world.removeCollider(this.ground, false);
    this.ground = this.world.createCollider(RAPIER.ColliderDesc.trimesh(...this.grid(X0, Z0, CELL, NX, NZ, null,
      (i, j) => patch && i >= i0 && i < i1 && j >= j0 && j < j1)).setFriction(0.9));

    /* the fine ground over the pits */
    if (this.pitGround) { this.world.removeCollider(this.pitGround, false); this.pitGround = null; }
    if (!patch) return;
    const fx0 = X0 + i0 * CELL, fz0 = Z0 + j0 * CELL;
    const nx = Math.round(((i1 - i0) * CELL) / FINE), nz = Math.round(((j1 - j0) * CELL) / FINE);
    const fine = ((i1 - i0) * CELL) / nx;
    /* how far each point is sunk: each pit marks only the points under its own footprint */
    const sink = new Float32Array((nx + 1) * (nz + 1));
    for (const p of this.pits) {
      const r = Math.hypot(p.w, p.d) / 2, c = Math.cos(p.angle), s = Math.sin(p.angle);
      const a0 = Math.max(0, Math.floor((p.x - r - fx0) / fine)), a1 = Math.min(nx, Math.ceil((p.x + r - fx0) / fine));
      const b0 = Math.max(0, Math.floor((p.z - r - fz0) / fine)), b1 = Math.min(nz, Math.ceil((p.z + r - fz0) / fine));
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const dx = fx0 + i * fine - p.x, dz = fz0 + j * fine - p.z;
        /* into the pit's own frame (it is turned by `angle` about the vertical) */
        const u = dx * c - dz * s, v = dx * s + dz * c;
        if (Math.abs(u) <= p.w / 2 && Math.abs(v) <= p.d / 2) {
          const k = j * (nx + 1) + i;
          sink[k] = Math.max(sink[k], p.depth);
        }
      }
    }
    this.pitGround = this.world.createCollider(RAPIER.ColliderDesc.trimesh(...this.grid(fx0, fz0, fine, nx, nz, sink, null)).setFriction(0.9));
  }

  /* a grid of the ground's surface as a triangle mesh, its points sunk by `sink`, leaving out the cells `skip` names */
  private grid(x0: number, z0: number, cell: number, nx: number, nz: number, sink: Float32Array | null, skip: ((i: number, j: number) => boolean) | null): [Float32Array, Uint32Array] {
    const verts = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell, k = j * (nx + 1) + i;
      verts[k * 3] = x; verts[k * 3 + 1] = this.base + groundHeight(x, z) - (sink ? sink[k] : 0); verts[k * 3 + 2] = z;
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (skip?.(i, j)) continue;
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    return [verts, new Uint32Array(idx)];
  }

  /** Hand the given stones to the physics, each starting from its current pose and spin. */
  drop(stones: Stone[]) {
    for (const s of stones) {
      const sp = s.spot;
      if (!sp || this.bodies.has(s)) continue;
      tmpQ.setFromEuler(s.r);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(s.p.x, s.p.y, s.p.z)
        .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
        .setLinvel(s.v.x, s.v.y, s.v.z)
        .setAngvel({ x: s.w.x, y: s.w.y, z: s.w.z })
        .setAngularDamping(0.3)
        .setCcdEnabled(true));
      /* a box rounded like the stone, a little under its full size so the bumps of the mesh rest on things */
      const { x: sw, y: sh, z: sd } = s.size;
      const r = Math.min(sw, sh, sd) * 0.18;
      const hx = Math.max(0.01, sw * 0.48 - r), hy = Math.max(0.01, sh * 0.48 - r), hz = Math.max(0.01, sd * 0.48 - r);
      const mass = sw * sh * sd * 2.5;
      const col = this.world.createCollider(RAPIER.ColliderDesc.roundCuboid(hx, hy, hz, r)
        .setDensity(2.5).setFriction(0.75).setRestitution(0.12)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        /* well above the force of just resting, so only real knocks are heard */
        .setContactForceEventThreshold(mass * 120), body);
      this.bodies.set(s, body);
      this.armed.add(s);
      this.byCollider.set(col.handle, s);
      s.mode = 'phys';
    }
  }

  /** Let every stone go again (they keep the pose the physics left them in). */
  release() {
    for (const body of this.bodies.values()) this.world.removeRigidBody(body);
    this.bodies.clear();
    this.byCollider.clear();
    this.lastHit.clear();
    this.armed.clear();
    this.acc = 0;
  }

  /** Advance the simulation by `dt` in fixed steps and copy the result onto the stones. */
  step(dt: number) {
    if (!this.active) return;
    this.acc = Math.min(this.acc + dt, STEP * 3);
    while (this.acc >= STEP) {
      this.world.step(this.queue);
      this.acc -= STEP;
      this.time += STEP;
      this.queue.drainContactForceEvents((e) => {
        const s = this.byCollider.get(e.collider1()) ?? this.byCollider.get(e.collider2());
        if (!s || !this.armed.has(s) || this.time - (this.lastHit.get(s) ?? -1) < 0.4) return;
        /* only a real blow: a stone resting or barely shifting makes no sound */
        const v = this.bodies.get(s)?.linvel();
        if (!v || Math.hypot(v.x, v.y, v.z) < 1.2) return;
        this.lastHit.set(s, this.time);
        this.armed.delete(s);
        const mass = s.size.x * s.size.y * s.size.z * 2.5;
        this.onHit?.(Math.min(1, e.totalForceMagnitude() / (mass * 900)), s.p.x, Math.cbrt(s.size.x * s.size.y * s.size.z));
      });
    }
    for (const [s, body] of this.bodies) {
      const t = body.translation(), q = body.rotation();
      s.p.set(t.x, t.y, t.z);
      s.r.setFromQuaternion(tmpQ.set(q.x, q.y, q.z, q.w));
      const v = body.linvel(), w = body.angvel();
      s.v.set(v.x, v.y, v.z);
      s.w.set(w.x, w.y, w.z);
      if (Math.hypot(v.x, v.y, v.z) > 2.5) this.armed.add(s);
    }
  }
}
