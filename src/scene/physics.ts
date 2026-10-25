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

export class StonePhysics {
  private readonly world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  private readonly queue = new RAPIER.EventQueue(true);
  private readonly bodies = new Map<Stone, RAPIER.RigidBody>();
  private readonly byCollider = new Map<number, Stone>();
  private readonly lastHit = new Map<Stone, number>();
  private ground: RAPIER.Collider | null = null;
  private acc = 0;
  private time = 0;
  /** called when a stone strikes something hard enough to hear, `strength` 0 to 1 */
  onHit: ((strength: number, x: number) => void) | null = null;

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
    if (this.ground) this.world.removeCollider(this.ground, false);
    const x0 = -22, z0 = -16, cell = 0.5, nx = 88, nz = 56;
    const verts = new Float32Array((nx + 1) * (nz + 1) * 3);
    const idx = new Uint32Array(nx * nz * 6);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell, k = (j * (nx + 1) + i) * 3;
      verts[k] = x; verts[k + 1] = base + groundHeight(x, z); verts[k + 2] = z;
    }
    let n = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], n);
      n += 6;
    }
    this.ground = this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.9));
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
      const r = Math.min(sp.w, sp.h, sp.d) * 0.18;
      const hx = Math.max(0.01, sp.w * 0.48 - r), hy = Math.max(0.01, sp.h * 0.48 - r), hz = Math.max(0.01, sp.d * 0.48 - r);
      const mass = sp.w * sp.h * sp.d * 2.5;
      const col = this.world.createCollider(RAPIER.ColliderDesc.roundCuboid(hx, hy, hz, r)
        .setDensity(2.5).setFriction(0.75).setRestitution(0.12)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        /* well above the force of just resting, so only real knocks are heard */
        .setContactForceEventThreshold(mass * 120), body);
      this.bodies.set(s, body);
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
        if (!s || this.time - (this.lastHit.get(s) ?? -1) < 0.25) return;
        this.lastHit.set(s, this.time);
        const sp = s.spot!, mass = sp.w * sp.h * sp.d * 2.5;
        this.onHit?.(Math.min(1, e.totalForceMagnitude() / (mass * 900)), s.p.x);
      });
    }
    for (const [s, body] of this.bodies) {
      const t = body.translation(), q = body.rotation();
      s.p.set(t.x, t.y, t.z);
      s.r.setFromQuaternion(tmpQ.set(q.x, q.y, q.z, q.w));
      const v = body.linvel(), w = body.angvel();
      s.v.set(v.x, v.y, v.z);
      s.w.set(w.x, w.y, w.z);
    }
  }
}
