import * as THREE from 'three';
import { NOISE3 } from './glsl';
import { groundHeight } from './ground';
import { roughBox } from './gobekli';

/*
 * Derinkuyu: a great round stone lying on a well curb slides aside and the view comes over the mouth of the air shaft
 * and looks down it. The shaft drops into the dark through level after level of the underground city; from its walls
 * arched doorways lead into passages hewn in soft tuff, that bend away and open into vaulted rooms, one passage
 * stepping down to the next level and coming back to the shaft there. Once open, the oil lamps are lit from the top
 * down, their light spilling out of the doorways; at the bottom the well's water. In one doorway stands a round stone
 * door in its slot: the pointer coming near rolls it across. The pointer itself is a light held down into the shaft.
 *
 * Everything is in world units, around the shaft's centre on the rock's surface (`SX`, `SZ`); the group sits there.
 */

export const DERIN = { SX: 0, SZ: 5.2, A: 1.5 };
const { SX, SZ, A } = DERIN;
const TOP = 0.35, BOTTOM = -13.6, WATER = -13.2;

/* a passage, hewn: `pts` its middle line on its floor; it opens from a doorway at the first point (and, if `through`,
   at the last, back into the shaft); from `room` on (0 to 1 along it) it widens into a vaulted room and ends there */
type Branch = { pts: [number, number, number][]; room?: number; through?: boolean; w?: number; h?: number; rw?: number; rh?: number };
const L = [-2.0, -4.6, -7.2, -9.8, -12.3];
const BRANCHES: Branch[] = [
  /* the stables, off the far wall at the first level, and the kitchen off the right */
  { pts: [[-0.45, L[0], -A], [-0.45, L[0], -A - 1.4], [-1.5, L[0], -A - 2.7], [-3.3, L[0], -A - 3.2], [-5.6, L[0], -A - 3.0]], room: 0.52 },
  { pts: [[A, L[0], 0.3], [A + 1.5, L[0], 0.3], [A + 2.6, L[0], -0.8], [A + 3.0, L[0], -2.8]], room: 0.5, rw: 2.4 },
  /* the great hall behind the rolling stone, its doorway low */
  { pts: [[0.55, L[1], -A], [0.55, L[1], -A - 1.4], [1.5, L[1], -A - 2.6], [3.3, L[1], -A - 3.0], [5.6, L[1], -A - 2.5]], room: 0.48, h: 0.7, rw: 3.0, rh: 1.5 },
  /* the stair: out of the left wall, down a level and round, back into the shaft through the far wall */
  { pts: [[-A, L[1], -0.4], [-A - 1.5, L[1], -0.4], [-A - 2.6, -5.3, -1.5], [-A - 2.5, -6.4, -A - 1.8], [-1.0, L[2], -A - 1.6], [-1.0, L[2], -A]], through: true },
  /* the winery off the right wall */
  { pts: [[A, L[2], -0.2], [A + 1.4, L[2], -0.2], [A + 2.6, L[2], 0.8], [A + 4.6, L[2], 1.0]], room: 0.46 },
  /* the church, straight back from the far wall, high vaulted; a refuge off the left */
  { pts: [[0.3, L[3], -A], [0.3, L[3], -A - 1.6], [0.3, L[3], -A - 3.2], [0.3, L[3], -A - 6.0]], room: 0.36, rw: 3.2, rh: 1.7 },
  { pts: [[-A, L[3], 0.5], [-A - 1.6, L[3], 0.5], [-A - 3.0, L[3], -0.6], [-A - 4.2, L[3], -0.9]], room: 0.5 },
  /* the well room, at the bottom */
  { pts: [[-0.3, L[4], -A], [-0.3, L[4], -A - 1.4], [-1.4, L[4], -A - 2.8], [-2.6, L[4], -A - 3.4]], room: 0.45 },
];
/* the rolling stone, in the great hall's doorway; its slot beside it, to the left */
const DOOR = { x: 0.55, y: L[1], r: 0.62, open: -1.25 };

export type DerinEvents = {
  /** the cover stone starts to slide off the shaft */
  onOpen: () => void;
  /** it has come down off the curb onto the ground */
  onOpened: () => void;
  /** the stone door starts to roll (its x in world units) */
  onRoll: (x: number) => void;
};

export function createDerinkuyu(uDetail: { value: THREE.Texture }, uTime: { value: number }, ev: DerinEvents) {
  const group = new THREE.Group();
  group.position.set(SX, 0, SZ);
  group.visible = false;
  const MAXL = 12;
  const uLamps = { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) };
  const uOrigin = { value: new THREE.Vector3() };
  const lamps: { p: THREE.Vector3; i: number }[] = [];
  const mat = (holds = 0, dark = 1) => tuffMaterial({ uDetail, uTime, uLamps, uOrigin, uHolds: { value: holds }, uDark: { value: dark } });
  const shaftMat = mat(1), caveMat = mat(), rimMat = mat(0, 0);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = false) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    group.add(mesh);
    return mesh;
  };

  /* the passages, each one piece from doorway to room; their doorways, cut into the walls */
  const doors: { wall: 'far' | 'left' | 'right'; u: number; y: number; w: number; h: number }[] = [];
  const doorAt = (p: [number, number, number], w: number, h: number) => {
    const [x, y, z] = p;
    if (Math.abs(z + A) < 1e-3) doors.push({ wall: 'far', u: x, y, w, h });
    else if (Math.abs(x + A) < 1e-3) doors.push({ wall: 'left', u: -z, y, w, h });
    else if (Math.abs(x - A) < 1e-3) doors.push({ wall: 'right', u: z, y, w, h });
  };
  for (const [bi, b] of BRANCHES.entries()) {
    const w = b.w ?? 1.0, h = b.h ?? 1.1;
    add(passage(b, bi), caveMat);
    doorAt(b.pts[0], w, h);
    if (b.through) doorAt(b.pts[b.pts.length - 1], w, h);
    /* a lamp in the room, and one at the passage's bend */
    const curve = new THREE.CatmullRomCurve3(b.pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const at = (u: number, up: number) => curve.getPointAt(u).add(new THREE.Vector3(0, up, 0));
    if (b.room !== undefined) lamps.push({ p: at((b.room + 1) / 2 + 0.06, 1.0), i: 0 });
    lamps.push({ p: at(b.room !== undefined ? b.room * 0.55 : 0.5, 0.95), i: 0 });
  }
  lamps.sort((a, b) => b.p.y - a.p.y);
  lamps.length = Math.min(lamps.length, MAXL);

  /* the shaft's four walls, from the curb down to the water, with their doorways (and the stone door's slot) cut out */
  const wall = (kind: 'far' | 'left' | 'right' | 'near') => {
    const s = new THREE.Shape();
    s.moveTo(-A, BOTTOM); s.lineTo(A, BOTTOM); s.lineTo(A, TOP); s.lineTo(-A, TOP); s.closePath();
    for (const d of doors.filter((d) => d.wall === kind)) {
      const isDoor = kind === 'far' && Math.abs(d.u - DOOR.x) < 1e-3 && Math.abs(d.y - DOOR.y) < 1e-3;
      const hole = new THREE.Path();
      const l = d.u - d.w / 2, r = d.u + d.w / 2, f = d.y;
      if (isDoor) {
        /* the doorway and the slot the stone rests in, one opening */
        const sl = DOOR.x + DOOR.open - DOOR.r - 0.04, sh = DOOR.r * 2 + 0.06;
        hole.moveTo(sl, f); hole.lineTo(r, f); hole.lineTo(r, f + d.h);
        hole.absarc(d.u, f + d.h, d.w / 2, 0, Math.PI, false);
        hole.lineTo(l, f + sh); hole.lineTo(sl, f + sh); hole.closePath();
      } else {
        hole.moveTo(l, f); hole.lineTo(r, f); hole.lineTo(r, f + d.h);
        hole.absarc(d.u, f + d.h, d.w / 2, 0, Math.PI, false);
        hole.closePath();
      }
      s.holes.push(hole);
    }
    const g = new THREE.ShapeGeometry(s, 16);
    if (kind === 'far') g.translate(0, 0, -A);
    if (kind === 'left') { g.rotateY(Math.PI / 2); g.translate(-A, 0, 0); }
    if (kind === 'right') { g.rotateY(-Math.PI / 2); g.translate(A, 0, 0); }
    if (kind === 'near') { g.rotateY(Math.PI); g.translate(0, 0, A); }
    return g;
  };
  for (const k of ['far', 'left', 'right', 'near'] as const) add(wall(k), shaftMat);
  /* the stone door's slot, a hollow behind the wall */
  {
    const sl = DOOR.x + DOOR.open - DOOR.r - 0.04, sr = DOOR.x + DOOR.r + 0.04, sh = DOOR.r * 2 + 0.06;
    const g = new THREE.BoxGeometry(sr - sl, sh, 0.36);
    g.translate((sl + sr) / 2, DOOR.y + sh / 2, -A - 0.18);
    add(g, caveMat);
  }

  /* the well curb: four blocks of tuff round the mouth, half sunk in the ground */
  const ground = groundHeight(SX, SZ);
  const T = 0.5;
  for (const [x, z, w, d] of [[0, -A - T / 2, 2 * A + 2 * T, T], [0, A + T / 2, 2 * A + 2 * T, T], [-A - T / 2, 0, T, 2 * A], [A + T / 2, 0, T, 2 * A]]) {
    const m = add(roughBox(w, 0.75, d, x * 3 + z * 7 + 2, 0), rimMat, true);
    m.position.set(x, ground + TOP - 0.375 + 0.02, z);
  }

  /* the water at the bottom: black, a little of the sky in it */
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * A, 2 * A), new THREE.MeshStandardMaterial({ color: 0x05080c, roughness: 0.08, metalness: 0.9, envMapIntensity: 0.6, fog: false }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER;
  group.add(water);

  /* the cover: a great round stone lying on the curb */
  const cover = add(millstone(A + 0.55, 0.4, 0.12), rimMat, true);
  cover.rotation.x = -Math.PI / 2;
  const coverY = ground + TOP + 0.2;

  /* the stone door */
  const door = add(millstone(DOOR.r, 0.22, 0.16), caveMat, true);

  /* the flames */
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lamps.flatMap((l) => [l.p.x, l.p.y + 0.05, l.p.z])), 3));
  const fA = new Float32Array(lamps.length);
  fGeo.setAttribute('aA', new THREE.BufferAttribute(fA, 1));
  const uPx = { value: 400 };
  const flames = new THREE.Points(fGeo, new THREE.ShaderMaterial({
    uniforms: { uPx, uTime },
    vertexShader: /* glsl */ `
      attribute float aA; uniform float uPx; uniform float uTime; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
        float fl = .85 + .15 * sin(uTime * 13. + position.x * 7.) * sin(uTime * 7.3 + position.z * 5.);
        gl_PointSize = .45 * fl * uPx / -mv.z; vA = aA * fl; }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){ vec2 q = gl_PointCoord - .5; q.y *= .7; float d = length(q);
        vec3 c = mix(vec3(1., .5, .15), vec3(1., .9, .65), smoothstep(.2, .0, d));
        float a = (smoothstep(.5, .0, d) * .45 + smoothstep(.08, .0, d)) * vA; if (a < .003) discard;
        gl_FragColor = vec4(c * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  flames.frustumCulled = false;
  group.add(flames);

  let on = false, clock = 0, k = 0, opened = false, startedOpen = false, lit = -1;
  let doorOpen = 1, doorWant = 1, doorArmed = true;
  const tmp = new THREE.Vector3();
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

  return {
    group,
    /** how far the cover has slid off, 0 to 1 */
    get open() { return k; },
    /** where the view stands to look down the shaft, and what it looks at (the pointer moves it a little) */
    view(gaze: THREE.Vector2, groundY: number) {
      camPos.set(SX + 0.15 + gaze.x * 0.35, groundY + 5.6, SZ + 2.5 - gaze.y * 0.35);
      camLook.set(SX + gaze.x * 0.25, groundY - 8.5, SZ - 0.45 - gaze.y * 0.2);
      return { pos: camPos, look: camLook };
    },
    set(want: boolean) {
      if (want === on) return;
      on = want;
      clock = 0;
      startedOpen = false;
      if (!want) { opened = false; lit = -1; }
    },
    resize(px: number) { uPx.value = px; },
    update(dt: number, groundY: number, camera: THREE.Camera, ndc: THREE.Vector2, hasPointer: boolean, reduced: boolean) {
      group.position.y = groundY;
      uOrigin.value.copy(group.position);
      clock += dt;
      /* a moment first, for whatever stood on the ground to go back into it, then the cover slides off */
      if (on && clock > 0.6) {
        if (!startedOpen) { startedOpen = true; if (k < 1) ev.onOpen(); }
        k = reduced ? 1 : Math.min(1, k + dt / 1.9);
      } else if (!on) k = Math.max(0, k - dt / 1.5);
      const e = k * k * (3 - 2 * k);
      /* it slides off the curb, then tips down onto the ground beside it */
      const drop = THREE.MathUtils.smoothstep(e, 0.62, 0.9);
      cover.position.set(e * 4.3, coverY - drop * (TOP + 0.02), -e * 0.6);
      cover.rotation.set(-Math.PI / 2 + drop * 0.05, 0, e * 0.9);
      if (on && k >= 1 && !opened) { opened = true; lit = 0; ev.onOpened(); }
      /* the lamps, lit one after another from the top down; out at once when it closes */
      if (lit >= 0) lit += dt;
      lamps.forEach((l, i) => {
        const want = lit >= 0 ? THREE.MathUtils.clamp((lit - 0.4 - i * 0.32) / 0.45, 0, 1) : 0;
        l.i += (want - l.i) * Math.min(1, dt * (want ? 6 : 8));
        fA[i] = l.i;
        uLamps.value[i].set(l.p.x, l.p.y, l.p.z, l.i);
      });
      (fGeo.attributes.aA as THREE.BufferAttribute).needsUpdate = true;
      /* the stone door: the pointer coming near rolls it across the doorway, or back into its slot */
      tmp.set(SX + DOOR.x + DOOR.open * 0.5, groundY + DOOR.y + DOOR.r, SZ - A).project(camera);
      const near = hasPointer && opened ? Math.hypot(tmp.x - ndc.x, tmp.y - ndc.y) : 9;
      if (near < 0.12 && doorArmed) { doorArmed = false; doorWant = 1 - doorWant; ev.onRoll(SX + DOOR.x); }
      if (near > 0.2) doorArmed = true;
      if (!opened) doorWant = 1;
      doorOpen += Math.sign(doorWant - doorOpen) * Math.min(Math.abs(doorWant - doorOpen), dt / 1.1);
      const s = doorOpen * doorOpen * (3 - 2 * doorOpen), dx = DOOR.open * s;
      door.position.set(DOOR.x + dx, DOOR.y + DOOR.r + 0.01, -A - 0.18);
      door.rotation.set(0, 0, -dx / DOOR.r);
      group.visible = k > 0 || on;
    },
  };
}

/* a passage from its middle line: an arched section swept along it, widening into a vaulted room at the end */
function passage(b: Branch, seed: number) {
  const curve = new THREE.CatmullRomCurve3(b.pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const M = Math.max(24, Math.round(curve.getLength() * 9));
  const w0 = b.w ?? 1.0, h0 = b.h ?? 1.1, rw = b.rw ?? 2.7, rh = b.rh ?? 1.35;
  /* the section, the same number of points at any width: floor, right wall, the arch, left wall */
  const section = (w: number, h: number) => {
    const p: [number, number][] = [];
    for (let i = 0; i < 4; i++) p.push([-w / 2 + (w * i) / 4, 0]);
    for (let i = 0; i < 4; i++) p.push([w / 2, (h * i) / 4]);
    for (let i = 0; i <= 14; i++) { const a = (Math.PI * i) / 14; p.push([(Math.cos(a) * w) / 2, h + (Math.sin(a) * w) / 2 * 0.9]); }
    for (let i = 1; i < 4; i++) p.push([-w / 2, h - (h * i) / 4]);
    return p;
  };
  const N = section(1, 1).length;
  const pos: number[] = [], idx: number[] = [];
  const side = new THREE.Vector3(), t = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i <= M; i++) {
    const u = i / M;
    curve.getPointAt(u, c);
    curve.getTangentAt(u, t);
    side.set(-t.z, 0, t.x).normalize();
    const r = b.room === undefined ? 0 : THREE.MathUtils.smoothstep(u, b.room, b.room + 0.14);
    const w = THREE.MathUtils.lerp(w0, rw, r), h = THREE.MathUtils.lerp(h0, rh, r);
    /* hewn by hand: the walls wander a little, not at the open ends where they meet the shaft's wall */
    const ends = THREE.MathUtils.smoothstep(u, 0, 0.06) * (b.through ? THREE.MathUtils.smoothstep(1 - u, 0, 0.06) : 1);
    for (const [s, v] of section(w, h)) {
      const n = (noiseAt(c.x * 1.7 + s * 1.3 + seed, v * 1.7, c.z * 1.7) - 0.5) * 0.14 * ends * (v > 0.01 ? 1 : 0.2);
      const ss = s * (1 + n), vv = v > 0.01 ? v * (1 + n * 0.6) : 0;
      pos.push(c.x + side.x * ss, c.y + vv, c.z + side.z * ss);
    }
    if (i < M) for (let j = 0; j < N; j++) {
      const a = i * N + j, b2 = i * N + ((j + 1) % N), cc = a + N, d = b2 + N;
      idx.push(a, cc, b2, b2, cc, d);
    }
  }
  /* a room's back wall closes it */
  if (b.room !== undefined) {
    const base = M * N, mid = pos.length / 3;
    const last = new THREE.Vector3(pos[base * 3], 0, 0);
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < N; j++) { cx += pos[(base + j) * 3]; cy += pos[(base + j) * 3 + 1]; cz += pos[(base + j) * 3 + 2]; }
    last.set(cx / N, cy / N, cz / N);
    pos.push(last.x, last.y, last.z);
    for (let j = 0; j < N; j++) idx.push(base + j, base + ((j + 1) % N), mid);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function noiseAt(x: number, y: number, z: number) {
  const h = (a: number, b: number, c: number) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), sx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx), sy),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx), sy),
    sz,
  );
}

/* a millstone: a thick disc with a hole through its middle, its faces along z, its edge worn round */
function millstone(r: number, t: number, hole: number) {
  const e = Math.min(0.06, t * 0.3);
  const pts = [
    new THREE.Vector2(r * hole, -t / 2), new THREE.Vector2(r - e, -t / 2), new THREE.Vector2(r, -t / 2 + e),
    new THREE.Vector2(r, t / 2 - e), new THREE.Vector2(r - e, t / 2), new THREE.Vector2(r * hole, t / 2),
    new THREE.Vector2(r * hole, -t / 2),
  ];
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateX(Math.PI / 2);
  return g;
}

/*
 * Tuff: soft volcanic rock, pinkish beige, laid down in bands, hewn with picks. Deeper down the shaft it goes dark,
 * as only a little of the sky reaches there (no fog in it: the night's haze would turn the dark grey); the lamps warm
 * whatever is near them. The shaft's walls carry footholds, two staggered rows down one side.
 */
function tuffMaterial(u: Record<string, { value: unknown }>) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, envMapIntensity: 0.15, side: THREE.DoubleSide, fog: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP2; varying vec3 vWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP2 = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${NOISE3}
varying vec3 vWP2; varying vec3 vWN;
uniform sampler2D uDetail; uniform float uTime; uniform vec4 uLamps[12]; uniform vec3 uOrigin; uniform float uHolds; uniform float uDark;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 lp = vWP2 - uOrigin;
vec3 tp = vWP2 * .45;
vec3 tw = pow(abs(vWN), vec3(4.)); tw /= dot(tw, vec3(1.));
vec3 tt = texture2D(uDetail, tp.yz).rgb * tw.x + texture2D(uDetail, tp.xz).rgb * tw.y + texture2D(uDetail, tp.xy).rgb * tw.z;
float band = fbm3(vec3(vWP2.x * .08, vWP2.y * 1.6, vWP2.z * .08));
vec3 tc = mix(vec3(.48, .36, .3), vec3(.64, .52, .43), smoothstep(.3, .7, band));
tc *= .8 + .4 * fbm3(vWP2 * 1.3);
tc *= mix(1., clamp(pow(tt.r / .3, 1.2), .45, 1.7), .55);
float picks = smoothstep(.55, .9, n3(vec3(vWP2.x * 2.5 + vWP2.z * 2.5, vWP2.y * 22., 0.) + n3(vWP2 * 3.) * 4.));
tc *= 1. - .16 * picks;
/* footholds: two staggered rows of notches down the left wall */
float hold = 0.;
if (uHolds > .5 && abs(lp.x + ${A.toFixed(2)}) < .02) {
  vec2 hq = vec2(lp.z, lp.y);
  float row = step(0., hq.x) ;
  float yy = fract((hq.y + row * .22) / .44);
  hold = step(abs(abs(hq.x) - .32), .09) * step(yy, .18);
}
tc *= 1. - .7 * hold;
vec3 lit = tc;
/* the dark of the depths */
float deep = smoothstep(.3, -7.5, lp.y) * uDark;
tc *= mix(1., .045, deep);
/* soot over the lamps */
for (int i = 0; i < 12; i++) { vec4 L = uLamps[i]; if (L.w > 0.) tc *= 1. - .45 * L.w * exp(-length((lp - L.xyz - vec3(0., .55, 0.)) * vec3(1.3, .8, 1.3)) * 2.4); }
diffuseColor.rgb *= tc;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float tBh = (tt.g - .6) * 1.2 + band * .6 - picks * .4 - hold * 1.5 + (fbm3(vWP2 * 4.) - .5) * .4;
vec3 tVp = -vViewPosition; vec3 tDpx = dFdx(tVp); vec3 tDpy = dFdy(tVp);
float tDhx = dFdx(tBh); float tDhy = dFdy(tBh);
vec3 tR1 = cross(tDpy, normal); vec3 tR2 = cross(normal, tDpx);
float tDet = dot(tDpx, tR1);
vec3 tGrad = sign(tDet) * (tDhx * tR1 + tDhy * tR2) * .012;
float tLim = abs(tDet) * .7, tLen = length(tGrad);
if (tLen > tLim) tGrad *= tLim / tLen;
vec3 tN = normalize(abs(tDet) * normal - tGrad);
if (dot(tN, normalize(vViewPosition)) > .05) normal = tN;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
/* the lamps' warmth, flickering */
for (int i = 0; i < 12; i++) {
  vec4 L = uLamps[i];
  if (L.w <= 0.) continue;
  float ld = length(lp - L.xyz);
  float fl = .85 + .15 * sin(uTime * 13. + L.x * 7.) * sin(uTime * 7.3 + L.z * 5.);
  totalEmissiveRadiance += vec3(1., .48, .18) * lit * L.w * fl * 2.2 / (1. + ld * ld * 1.8);
}`);
  };
  m.customProgramCacheKey = () => 'derinkuyu-tuff2';
  return m;
}
