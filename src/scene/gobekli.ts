import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NOISE3 } from './glsl';
import { groundHeight } from './ground';
import { GLYPHS, RUNE_FONT } from './textures';

/*
 * Monuments that rise out of the ground in their scenes. Göbeklitepe: an enclosure of T-shaped pillars that rises out of the ground when its scene comes and sinks back when it
 * goes. A ring of pillars set into the dark around two greater ones in the middle; on their broad faces the animals of
 * the first temples, in low relief: fox, boar, vulture, snakes, scorpion, crane; on the two in the middle arms, hands, a
 * belt and a fox pelt, as the pillars there are people. Once a pillar stands its carvings wake from the bottom up, in the
 * scene's rune light, and the pointer brightens the ones it nears.
 *
 * The Orkhon monuments: three steles of grey stone, Tonyukuk's rough and plain, Bilge Kağan's and Kül Tigin's crowned
 * with a rounded top and set on stone turtles, their faces cut with Old Turkic letters in columns that wake the same way.
 *
 * Built at the size the view has at its usual proportions (half height 3.08) and scaled with the view.
 */
export type Site = 'gobekli' | 'orkhon';

const BASE_HH = 3.08;
/* the relief atlas: 4 × 2 cells, each a pillar's broad face, 100 × 300 units drawn at 2.56 px a unit */
const CW = 256, CH = 768, COLS = 4, ROWS = 2;

type Pillar = {
  g: THREE.Group;
  x: number; z: number; rot: number;
  /* shaft height plus head height, for how deep it lies sunk */
  tall: number;
  big: boolean;
  delay: number; dur: number;
  k: number; clock: number;
  started: boolean; landed: boolean;
  u: { uLit: { value: number }; uNear: { value: number } };
  near: number;
};

export type EnclosureEvents = {
  /** a pillar starts grinding up out of the ground (its x in world units, and whether it is one of the two great ones) */
  onGrind: (x: number, big: boolean, dur: number) => void;
  /** a pillar has come up all the way and settles */
  onLand: (x: number, big: boolean) => void;
};

export function createEnclosure(uDetail: { value: THREE.Texture }, uRune: { value: THREE.Color }, uTime: { value: number }, ev: EnclosureEvents, site: Site = 'gobekli') {
  const group = new THREE.Group();
  group.visible = false;
  const orkhon = site === 'orkhon';
  /* the letters need their font, so the inscriptions are cut the first time the monuments rise */
  const uReliefs = { value: orkhon ? new THREE.DataTexture(new Uint8Array(4), 1, 1) : reliefAtlas(CARVINGS) };
  let cut = !orkhon;
  /* Göbeklitepe's pale warm limestone; the Orkhon steles' grey */
  const uTone = { value: orkhon ? new THREE.Color(0.42, 0.42, 0.41) : new THREE.Color(0.62, 0.53, 0.4) };
  const uCarveIn = { value: orkhon ? 1 : 0 };

  const pillars: Pillar[] = [];
  const headMat = pillarMaterial({ uDetail, uRune, uTime, uReliefs, uTone, uCarveIn, uLit: { value: 0 }, uNear: { value: 0 }, uCell: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) }, uRelief: { value: 0 }, uSeed: { value: 4.2 } });

  const add = (x: number, z: number, rot: number, W: number, H: number, D: number, cell: number, big: boolean, delay: number, seed: number, top: 'T' | 'arch' | 'rough' = 'T', turtle = false) => {
    const g = new THREE.Group();
    const u = { uLit: { value: 0 }, uNear: { value: 0 } };
    const mat = pillarMaterial({
      uDetail, uRune, uTime, uReliefs, uTone, uCarveIn, ...u,
      uCell: { value: new THREE.Vector2(cell % COLS, Math.floor(cell / COLS)) },
      uSize: { value: new THREE.Vector2(W, H) },
      uRelief: { value: 1 }, uSeed: { value: seed },
    });
    /* a stele on a turtle stands on its back */
    const foot = turtle ? W * 0.42 : 0;
    const shaft = new THREE.Mesh(roughBox(W, H, D, seed, top === 'T' ? 0.05 : 0.02), mat);
    shaft.position.y = foot + H / 2;
    const parts: THREE.Mesh[] = [shaft];
    let hh = 0;
    if (top === 'T') {
      /* the head: longer than the shaft is wide, reaching out further on the side that faces in */
      hh = H * 0.17;
      const head = new THREE.Mesh(roughBox(W * 1.55, hh, D * 1.04, seed + 3, 0.0), headMat);
      head.position.set(W * 0.16, foot + H + hh / 2 - 0.02, 0);
      parts.push(head);
    } else if (top === 'arch') {
      /* a rounded crown, a little thicker than the slab */
      hh = W * 0.42;
      const crown = new THREE.Mesh(roughArch(W * 1.04, hh, D * 1.1, seed + 3), headMat);
      crown.position.y = foot + H - 0.02;
      parts.push(crown);
    }
    if (turtle) {
      /* the shell, low and domed; the head pushed out in front; four stubby feet */
      const body = new THREE.Mesh(roughBlob(W * 1.3, foot * 1.9, W * 1.05, seed + 5), headMat);
      body.position.set(0, foot * 0.1, -0.05);
      const head = new THREE.Mesh(roughBlob(W * 0.3, foot * 0.75, W * 0.42, seed + 7), headMat);
      head.position.set(0, foot * 0.3, W * 0.62);
      parts.push(body, head);
      for (const [fx, fz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const f = new THREE.Mesh(roughBlob(W * 0.26, foot * 0.55, W * 0.22, seed + 9 + fx + fz * 3), headMat);
        f.position.set(fx * W * 0.55, foot * 0.1, fz * W * 0.38 - 0.05);
        parts.push(f);
      }
    }
    for (const m of parts) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.rotation.y = rot;
    group.add(g);
    pillars.push({ g, x, z, rot, tall: foot + H + hh, big, delay, dur: big ? 3.2 : 2.4, k: 0, clock: 0, started: false, landed: false, u, near: 0 });
  };

  if (orkhon) {
    /* Tonyukuk's, plain and rough, on the left; Bilge Kağan's in the middle; Kül Tigin's on the right */
    add(-3.15, -1.2, 0.28, 0.95, 2.55, 0.42, 0, false, 0.3, 5.3, 'rough');
    add(0.05, -1.9, 0.08, 1.3, 3.0, 0.42, 1, true, 1.1, 17.1, 'arch', true);
    add(3.25, -1.25, -0.22, 1.25, 2.9, 0.42, 2, true, 1.9, 29.7, 'arch', true);
  } else {

  /* the ring, open towards the viewer; its broad faces turned in, to the middle */
  const CX = 0, CZ = -1.7, RX = 4.7, RZ = 2.7;
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = THREE.MathUtils.degToRad(-120 + (240 * i) / (N - 1));
    const x = CX + RX * Math.sin(a), z = CZ - RZ * Math.cos(a);
    const rot = Math.atan2(CX - x, CZ + 1.5 - z);
    const H = 2.15 + ((i * 37) % 5) * 0.09;
    /* they come up one after another round the ring, from the back outwards */
    const order = Math.abs(i - (N - 1) / 2);
    add(x, z, rot, 0.74, H, 0.26, i % 6, false, 0.25 + order * 0.32 + (i % 2) * 0.12, 1.7 + i * 2.31);
  }
  /* the two great pillars in the middle, a little apart, turned slightly to each other and to the viewer */
  add(-1.0, -1.3, 0.3, 0.98, 3.55, 0.32, 6, true, 2.3, 31.4);
  add(1.05, -1.5, -0.12, 0.98, 3.7, 0.32, 7, true, 2.75, 47.9);
  }

  /* dust thrown up round a pillar's foot as it grinds out of the ground */
  const DUST = 420;
  const dPos = new Float32Array(DUST * 3), dA = new Float32Array(DUST), dS = new Float32Array(DUST);
  const dV = new Float32Array(DUST * 3), dLife = new Float32Array(DUST), dMax = new Float32Array(DUST), dSize = new Float32Array(DUST);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('aA', new THREE.BufferAttribute(dA, 1));
  dGeo.setAttribute('aS', new THREE.BufferAttribute(dS, 1));
  const uPx = { value: 400 };
  const dust = new THREE.Points(dGeo, new THREE.ShaderMaterial({
    uniforms: { uPx, uCol: { value: new THREE.Color(0x8c8070) } },
    vertexShader: /* glsl */ `
      attribute float aA; attribute float aS; uniform float uPx; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = aS * uPx / -mv.z; vA = aA; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .05, d) * vA; if (a < .004) discard; gl_FragColor = vec4(uCol, a); }`,
    transparent: true, depthWrite: false,
  }));
  dust.frustumCulled = false;
  group.add(dust);
  let dNext = 0;
  const puff = (p: Pillar, y: number, n: number) => {
    for (let j = 0; j < n; j++) {
      const i = dNext; dNext = (dNext + 1) % DUST;
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.45;
      dPos[i * 3] = p.x + Math.cos(a) * r; dPos[i * 3 + 1] = y + Math.random() * 0.1; dPos[i * 3 + 2] = p.z + Math.sin(a) * r * 0.6;
      dV[i * 3] = Math.cos(a) * (0.25 + Math.random() * 0.5); dV[i * 3 + 1] = 0.15 + Math.random() * 0.45; dV[i * 3 + 2] = Math.sin(a) * (0.2 + Math.random() * 0.4);
      dMax[i] = dLife[i] = 1.8 + Math.random() * 1.8;
      dSize[i] = (p.big ? 0.55 : 0.4) * (0.6 + Math.random() * 0.8);
    }
  };

  let on = false;
  const tmp = new THREE.Vector3();
  const v2 = new THREE.Vector2();

  return {
    group,
    /** raise the enclosure (its scene has come) or sink it again */
    set(want: boolean) {
      if (want === on) return;
      on = want;
      if (want && !cut) { cut = true; uReliefs.value = reliefAtlas(INSCRIPTIONS); }
      for (const p of pillars) { p.clock = 0; p.started = p.k > 0 && want; if (!want) p.landed = false; }
    },
    /** world units per point-size unit: the view's height in device pixels over twice the tangent of half its field of view */
    resize(px: number) { uPx.value = px; },
    update(dt: number, hh: number, camera: THREE.Camera, ndc: THREE.Vector2, hasPointer: boolean, reduced: boolean) {
      const U = hh / BASE_HH;
      group.scale.setScalar(U);
      let any = false;
      for (const [i, p] of pillars.entries()) {
        p.clock += dt;
        if (on) {
          if (p.clock > p.delay) {
            if (!p.started) { p.started = true; if (p.k < 1) ev.onGrind(p.x * U, p.big, p.dur); }
            p.k = reduced ? 1 : Math.min(1, p.k + dt / p.dur);
          }
        } else p.k = Math.max(0, p.k - dt / 1.5);
        if (p.k > 0) any = true;
        const ground = (-hh * 0.96 + groundHeight(p.x * U, p.z * U)) / U;
        const top = ground - 0.1, bottom = ground - p.tall - 0.3;
        /* grinding: slow to start, heaviest at the end, where it settles */
        const k = p.k, e = on ? 1 - (1 - k) ** 2.4 : k * k * (3 - 2 * k);
        const moving = k > 0 && k < 1;
        const amp = moving ? (p.big ? 0.01 : 0.014) * (on ? 1 : 0.5) : 0;
        p.g.position.set(p.x + Math.sin(uTime.value * 43 + i) * amp * 0.6, bottom + (top - bottom) * e, p.z);
        p.g.rotation.set(Math.sin(uTime.value * 31 + i * 1.7) * amp, p.rot, Math.sin(uTime.value * 27 + i * 2.3) * amp);
        if (moving && on && !reduced) puff(p, ground, Math.random() < dt * (p.big ? 70 : 45) ? 1 : 0);
        if (on && k >= 1 && !p.landed) {
          p.landed = true;
          ev.onLand(p.x * U, p.big);
          if (!reduced) puff(p, ground, p.big ? 26 : 14);
        }
        /* its carvings wake once it stands, from the foot up; they go dark at once as it sinks */
        const lit = p.landed ? 1 : 0;
        p.u.uLit.value += (lit - p.u.uLit.value) * Math.min(1, dt * (lit ? 0.7 : 4));
        /* under the pointer: how near its middle is, on screen */
        tmp.set(p.x * U, (ground + p.tall * 0.45) * U, p.z * U).project(camera);
        const d = v2.set(tmp.x, tmp.y).distanceTo(ndc);
        const want = hasPointer && p.landed ? Math.exp(-d * d * 22) : 0;
        p.near += (want - p.near) * Math.min(1, dt * 5);
        p.u.uNear.value = p.near;
      }
      /* the dust drifts out and up, slowing, and thins away */
      let live = false;
      for (let i = 0; i < DUST; i++) {
        if (dLife[i] <= 0) { dA[i] = 0; continue; }
        live = true;
        dLife[i] -= dt;
        const f = Math.exp(-dt * 1.4);
        dV[i * 3] *= f; dV[i * 3 + 1] = dV[i * 3 + 1] * f - dt * 0.02; dV[i * 3 + 2] *= f;
        dPos[i * 3] += dV[i * 3] * dt; dPos[i * 3 + 1] += dV[i * 3 + 1] * dt; dPos[i * 3 + 2] += dV[i * 3 + 2] * dt;
        const age = 1 - dLife[i] / dMax[i];
        dA[i] = Math.max(0, Math.min(1, age * 6) * (1 - age)) * 0.38;
        dS[i] = dSize[i] * (0.6 + age * 1.6) * U;
      }
      (dGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (dGeo.attributes.aA as THREE.BufferAttribute).needsUpdate = true;
      (dGeo.attributes.aS as THREE.BufferAttribute).needsUpdate = true;
      group.visible = any || live;
    },
  };
}

type PillarUniforms = Record<string, { value: unknown }>;

/* the photographed rock of the walls' pieces (ambientCG's Rock061, CC0): its colour, its surface and its roughness */
const loader = new THREE.TextureLoader();
const rockTex = (name: string, colour = false) => {
  const t = loader.load(`${import.meta.env.BASE_URL}realm/rock061_${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
let rock: { uRockC: { value: THREE.Texture }; uRockN: { value: THREE.Texture }; uRockR: { value: THREE.Texture } } | null = null;

/*
 * The pillars' stone: the stones' own dark palette and grain (the same picture of real rock, cast from three sides), and
 * on a shaft's broad faces its relief, raised from the face, worn, with the background cut back and shadowed around it,
 * and the rune light running along its edges.
 */
function pillarMaterial(u: PillarUniforms) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0, envMapIntensity: 0.2 });
  rock ??= { uRockC: { value: rockTex('color', true) }, uRockN: { value: rockTex('normalgl') }, uRockR: { value: rockTex('roughness') } };
  const r = rock;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPL; varying vec3 vPN; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPL = position; vPN = normal;\nvAX = normalMatrix * vec3(1., 0., 0.); vAY = normalMatrix * vec3(0., 1., 0.); vAZ = normalMatrix * vec3(0., 0., 1.);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${NOISE3}
varying vec3 vPL; varying vec3 vPN; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;
uniform sampler2D uRockC; uniform sampler2D uRockN; uniform sampler2D uRockR;
uniform sampler2D uDetail; uniform sampler2D uReliefs; uniform vec3 uRune; uniform float uTime;
uniform float uLit; uniform float uNear; uniform vec2 uCell; uniform vec2 uSize; uniform float uRelief; uniform float uSeed;
uniform vec3 uTone; uniform float uCarveIn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 pw = vPL * 1.6 + uSeed * vec3(7.3, 3.1, 5.7);
vec3 ptw = pow(abs(normalize(vPN)), vec3(4.)); ptw /= dot(ptw, vec3(1.));
vec3 ptex = texture2D(uDetail, pw.yz).rgb * ptw.x + texture2D(uDetail, pw.xz).rgb * ptw.y + texture2D(uDetail, pw.xy).rgb * ptw.z;
float pH = texture2D(uDetail, pw.yz, 2.5).g * ptw.x + texture2D(uDetail, pw.xz, 2.5).g * ptw.y + texture2D(uDetail, pw.xy, 2.5).g * ptw.z;
vec3 pc = uTone * mix(.62, 1., smoothstep(.2, .8, fbm3(pw * .4)));
pc *= (.84 + .32 * fbm3(pw * 1.4)) * mix(1., clamp(pow(ptex.r / .3, 1.4), .3, 2.), .35);
/* the photographed rock, from the three sides a face mostly looks to, at a scale where its layers and pits read */
vec3 rp = vPL * .55 + uSeed * vec3(.37, .53, .29);
vec3 rC = texture2D(uRockC, rp.zy).rgb * ptw.x + texture2D(uRockC, rp.xz).rgb * ptw.y + texture2D(uRockC, rp.xy).rgb * ptw.z;
float rL = dot(rC, vec3(.3, .59, .11));
pc *= clamp(pow(rL / .32, 1.1), .35, 1.6);
float rRough = texture2D(uRockR, rp.zy).r * ptw.x + texture2D(uRockR, rp.xz).r * ptw.y + texture2D(uRockR, rp.xy).r * ptw.z;
/* rain streaks down the faces */
pc *= 1. - .16 * smoothstep(.55, .85, n3(vec3(pw.x * 2.5, pw.y * .3, pw.z * 2.5) + 11.));
/* the relief, on the broad faces of a shaft */
float pFace = step(.6, abs(vPN.z)) * uRelief;
vec2 ruv = clamp(vec2((vPN.z > 0. ? vPL.x : -vPL.x) / uSize.x + .5, vPL.y / uSize.y + .5), .002, .998);
vec4 prt = texture2D(uReliefs, vec2((uCell.x + ruv.x) / ${COLS}., (uCell.y + 1. - ruv.y) / ${ROWS}.));
float pRel = prt.r * pFace, pRelB = prt.g * pFace;
/* raised: the figure worn smoother and paler, the ground cut back around it in shadow; cut in: dark in the groove */
if (uCarveIn > .5) pc *= 1. - .6 * pRel;
else {
  pc *= 1. + .3 * pRel;
  pc *= 1. - .45 * smoothstep(.02, .45, pRelB) * (1. - pRel);
}
diffuseColor.rgb *= pc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(.55 + rRough * .45, 0., 1.);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  /* the rock's surface: its three projections blended (whiteout), turned from the pillar's axes to the view's */
  vec3 n0 = normalize(vPN);
  vec3 tX = texture2D(uRockN, rp.zy).xyz * 2. - 1., tY = texture2D(uRockN, rp.xz).xyz * 2. - 1., tZ = texture2D(uRockN, rp.xy).xyz * 2. - 1.;
  tX.xy *= 1.6; tY.xy *= 1.6; tZ.xy *= 1.6;
  tX = vec3(tX.xy + n0.zy, abs(tX.z) * n0.x);
  tY = vec3(tY.xy + n0.xz, abs(tY.z) * n0.y);
  tZ = vec3(tZ.xy + n0.xy, abs(tZ.z) * n0.z);
  vec3 on = normalize(tX.zyx * ptw.x + tY.xzy * ptw.y + tZ.xyz * ptw.z);
  vec3 vn = normalize(mat3(vAX, vAY, vAZ) * on);
  if (dot(vn, normalize(vViewPosition)) > .05) normal = vn;
}
float pBh = (uCarveIn > .5 ? -(pRel * .9 + pRelB * .4) : pRelB * 1.6 + pRel * .35) + (fbm3(pw * 3.) - .5) * .3 + (pH - .67) * 1.2 + (rL - .3) * 2.;
vec3 pVp = -vViewPosition; vec3 pDpx = dFdx(pVp); vec3 pDpy = dFdy(pVp);
float pDhx = dFdx(pBh); float pDhy = dFdy(pBh);
vec3 pR1 = cross(pDpy, normal); vec3 pR2 = cross(normal, pDpx);
float pDet = dot(pDpx, pR1);
vec3 pGrad = sign(pDet) * (pDhx * pR1 + pDhy * pR2) * .009;
float pLim = abs(pDet) * .7, pLen = length(pGrad);
if (pLen > pLim) pGrad *= pLim / pLen;
vec3 pN = normalize(abs(pDet) * normal - pGrad);
if (dot(pN, normalize(vViewPosition)) > .05) normal = pN;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
/* light along the carving's edges, rising up the face as the pillar wakes */
float pRim = pow(clamp(pRelB * (1. - pRelB) * 4., 0., 1.), 3.);
float pWake = smoothstep(ruv.y - .18, ruv.y, uLit * 1.25 - .1);
float pGlow = (uCarveIn > .5 ? pRel * .7 + pRelB * .15 : pRim * .9 + pRel * .2) * pFace * (pWake * (.3 + .08 * sin(uTime * 2.1 + uSeed)) + uNear * 2.4);
totalEmissiveRadiance += uRune * pGlow;`);
  };
  m.customProgramCacheKey = () => 'gobekli-pillar';
  return m;
}

/* a box made stone: corners rounded, faces lumpy, chipped; `taper` narrows it towards the foot */
function roughBox(w: number, h: number, d: number, seed: number, taper: number) {
  const segs = (n: number) => Math.max(2, Math.round(n * 9));
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, d, segs(w), segs(h), segs(d));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const R = Math.min(w, h, d) * 0.22, half = new THREE.Vector3(w / 2, h / 2, d / 2);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    q.set(
      THREE.MathUtils.clamp(p.x, -half.x + R, half.x - R),
      THREE.MathUtils.clamp(p.y, -half.y + R, half.y - R),
      THREE.MathUtils.clamp(p.z, -half.z + R, half.z - R),
    );
    dir.subVectors(p, q);
    if (dir.lengthSq() < 1e-9) continue;
    dir.normalize();
    const s = seed * 13.1;
    const lump = noise(p.x * 2.2 + s, p.y * 2.2, p.z * 2.2) - 0.5;
    const chip = Math.max(0, noise(p.x * 6 + s, p.y * 6 + 5, p.z * 6) - 0.62) * 2.2;
    p.copy(q).addScaledVector(dir, R + lump * 0.05 - chip * 0.05);
    p.x *= 1 - taper * (0.5 - p.y / h);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/* a rounded crown for a stele: a half disc standing on its flat side, `w` wide, `h` high, `d` thick, its edges worn */
function roughArch(w: number, h: number, d: number, seed: number) {
  let g: THREE.BufferGeometry = new THREE.CylinderGeometry(w / 2, w / 2, d, 32, 1, false, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  g.scale(1, (2 * h) / w, 1);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 1 + (noise(x * 3 + seed, y * 3, z * 3) - 0.5) * 0.06;
    pos.setXYZ(i, x * s, Math.max(0, y * s), z * (0.92 + 0.08 * (1 - y / h)));
  }
  g.computeVertexNormals();
  return g;
}

/* a worn lump of stone (a turtle's shell and head): a sphere squashed to `w` × `h` × `d`, lumpy */
function roughBlob(w: number, h: number, d: number, seed: number) {
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(0.5, 28, 16);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 1 + (noise(x * 4 + seed, y * 4, z * 4) - 0.5) * 0.18;
    pos.setXYZ(i, x * w * s, Math.max(y, -0.15) * h * s, z * d * s);
  }
  g.computeVertexNormals();
  return g;
}

/* 3D value noise, 0 to 1 */
function hash(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

/*
 * The carvings, white on black, one pillar face to a cell; red is the figure, green the figure softened (for its
 * rounded edges, the shadow round it and the light along its edge).
 */
function reliefAtlas(carvings: ((c: CanvasRenderingContext2D) => void)[]) {
  const W = CW * COLS, H = CH * ROWS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  carvings.forEach((draw, i) => {
    ctx.save();
    ctx.translate((i % COLS) * CW, Math.floor(i / COLS) * CH);
    ctx.scale(CW / 100, CH / 300);
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.lineCap = ctx.lineJoin = 'round';
    draw(ctx);
    ctx.restore();
  });
  const src = ctx.getImageData(0, 0, W, H).data;
  const sharp = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) sharp[i] = src[i * 4] / 255;
  const soft = blur(blur(sharp, W, H, 7), W, H, 7);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = sharp[i] * 255;
    out[i * 4 + 1] = Math.min(255, soft[i] * 255);
    out[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* a box blur, along rows then columns, radius `r` pixels */
function blur(a: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length), n = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

type Pt = [number, number];
const poly = (c: CanvasRenderingContext2D, pts: Pt[]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); };
const line = (c: CanvasRenderingContext2D, pts: Pt[], w: number) => { c.lineWidth = w; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
const oval = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill(); };
const cut = (c: CanvasRenderingContext2D, f: () => void) => { c.save(); c.globalCompositeOperation = 'destination-out'; f(); c.restore(); c.globalCompositeOperation = 'source-over'; };

/* the arms of a pillar that is a person: down its side from the shoulder, the forearm across to the hands at its front */
function arms(c: CanvasRenderingContext2D) {
  line(c, [[86, 34], [88, 90], [86, 134], [78, 146]], 9);
  line(c, [[80, 146], [50, 150], [22, 154]], 8);
  for (let f = 0; f < 5; f++) line(c, [[22, 148 + f * 2.4], [8, 147 + f * 3.2]], 2.4);
}
function belt(c: CanvasRenderingContext2D, marks: 'c' | 'h') {
  c.fillRect(0, 166, 100, 13);
  cut(c, () => {
    for (let i = 0; i < 6; i++) {
      const x = 9 + i * 16.5;
      if (marks === 'c') { c.lineWidth = 2.4; c.beginPath(); c.arc(x, 172.5, 3.6, 0.3, Math.PI * 1.7); c.stroke(); }
      else { line(c, [[x - 3, 169], [x - 3, 176]], 2); line(c, [[x + 3, 169], [x + 3, 176]], 2); line(c, [[x - 3, 172.5], [x + 3, 172.5]], 2); }
    }
  });
}
/* a fox pelt hanging from the belt, head down */
function pelt(c: CanvasRenderingContext2D, x: number) {
  line(c, [[x, 178], [x, 190]], 5);
  oval(c, x, 214, 9, 25);
  poly(c, [[x - 8, 234], [x, 258], [x + 8, 234]]);
  poly(c, [[x - 7, 238], [x - 11, 230], [x - 5, 233]]);
  poly(c, [[x + 7, 238], [x + 11, 230], [x + 5, 233]]);
  line(c, [[x - 7, 200], [x - 15, 216]], 3.5);
  line(c, [[x + 7, 200], [x + 15, 216]], 3.5);
  line(c, [[x - 6, 228], [x - 13, 244]], 3.5);
  line(c, [[x + 6, 228], [x + 13, 244]], 3.5);
}

const CARVINGS: ((c: CanvasRenderingContext2D) => void)[] = [
  /* a fox, leaping down at the viewer, jaws open */
  (c) => {
    oval(c, 54, 92, 27, 10, -0.4);
    poly(c, [[34, 100], [14, 116], [8, 122], [20, 118], [12, 126], [26, 120], [38, 110]]);
    poly(c, [[32, 98], [30, 84], [38, 95]]);
    poly(c, [[37, 96], [39, 83], [43, 94]]);
    line(c, [[38, 106], [26, 122], [18, 128]], 5);
    line(c, [[44, 106], [36, 124], [28, 132]], 5);
    line(c, [[70, 86], [82, 98], [90, 114]], 5);
    line(c, [[66, 90], [74, 104], [78, 120]], 5);
    poly(c, [[74, 80], [86, 64], [94, 50], [90, 42], [84, 54], [76, 70], [70, 80]]);
    cut(c, () => oval(c, 27, 106, 1.8, 1.8));
  },
  /* a wild boar, its back bristling */
  (c) => {
    oval(c, 56, 120, 30, 15);
    poly(c, [[32, 110], [16, 124], [10, 133], [18, 135], [34, 131]]);
    poly(c, [[32, 111], [34, 99], [40, 112]]);
    for (let i = 0; i < 9; i++) poly(c, [[36 + i * 5, 108], [38.5 + i * 5, 99 - (i % 2) * 2], [41 + i * 5, 108]]);
    line(c, [[38, 130], [36, 148]], 5);
    line(c, [[47, 132], [47, 150]], 5);
    line(c, [[70, 132], [72, 150]], 5);
    line(c, [[80, 128], [84, 147]], 5);
    line(c, [[86, 116], [93, 111], [94, 118]], 2.5);
    cut(c, () => { oval(c, 25, 119, 1.8, 1.8); line(c, [[15, 131], [21, 126]], 1.6); });
  },
  /* a vulture, wings raised, a disc over one wing; three bags above */
  (c) => {
    for (let i = 0; i < 3; i++) {
      const x = 18 + i * 26;
      c.fillRect(x, 24, 16, 14);
      c.lineWidth = 2.6; c.beginPath(); c.arc(x + 8, 24, 5.5, Math.PI, 0); c.stroke();
    }
    oval(c, 52, 104, 11, 26, 0.15);
    oval(c, 45, 72, 6, 6);
    poly(c, [[40, 70], [32, 75], [40, 76]]);
    line(c, [[46, 76], [50, 84]], 5);
    poly(c, [[48, 88], [26, 74], [12, 82], [18, 88], [10, 96], [20, 98], [14, 106], [26, 106], [46, 102]]);
    poly(c, [[56, 88], [80, 76], [92, 86], [86, 90], [93, 98], [84, 100], [89, 108], [76, 106], [58, 102]]);
    oval(c, 78, 58, 7, 7);
    poly(c, [[46, 126], [52, 142], [60, 126]]);
    line(c, [[48, 128], [44, 146]], 3);
    line(c, [[56, 128], [58, 146]], 3);
  },
  /* snakes running down the stone */
  (c) => {
    for (let k = 0; k < 3; k++) {
      const x0 = 28 + k * 22, pts: Pt[] = [];
      for (let y = 22 + k * 6; y <= 192; y += 4) pts.push([x0 + Math.sin(y * 0.07 + k * 1.3) * 7, y]);
      line(c, pts, 5);
      const [hx] = pts[pts.length - 1];
      oval(c, hx, 198, 5, 8);
    }
  },
  /* a scorpion, head down, tail curled */
  (c) => {
    oval(c, 50, 102, 10, 15);
    oval(c, 50, 120, 8, 6);
    line(c, [[50, 90], [50, 76], [53, 66], [59, 58], [66, 57], [68, 64]], 5);
    poly(c, [[65, 62], [72, 66], [65, 69]]);
    line(c, [[44, 122], [36, 132], [33, 140]], 4);
    line(c, [[56, 122], [64, 132], [67, 140]], 4);
    oval(c, 32, 145, 4.5, 6.5, 0.3);
    oval(c, 68, 145, 4.5, 6.5, -0.3);
    for (let i = 0; i < 4; i++) {
      const y = 96 + i * 5.5;
      line(c, [[42, y], [32, y - 3 + i * 2], [27, y + 5 + i * 2]], 2.5);
      line(c, [[58, y], [68, y - 3 + i * 2], [73, y + 5 + i * 2]], 2.5);
    }
  },
  /* a crane, long legged */
  (c) => {
    oval(c, 58, 108, 16, 10, -0.2);
    line(c, [[46, 102], [41, 88], [45, 76], [40, 64]], 4.5);
    oval(c, 38, 62, 4.5, 4);
    line(c, [[35, 62], [20, 69]], 2.5);
    line(c, [[55, 116], [53, 138], [50, 160]], 2.6);
    line(c, [[61, 116], [63, 138], [67, 160]], 2.6);
    poly(c, [[72, 104], [88, 110], [72, 114]]);
  },
  /* a great pillar, a person: an H and a crescent at the neck, arms, a belt, a fox pelt */
  (c) => {
    line(c, [[43, 8], [43, 22]], 3.4);
    line(c, [[57, 8], [57, 22]], 3.4);
    line(c, [[43, 15], [57, 15]], 3.4);
    c.lineWidth = 3.6; c.beginPath(); c.arc(50, 28, 8, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    arms(c);
    belt(c, 'c');
    pelt(c, 42);
  },
  /* the other: a bull's head hung at the neck, arms, a belt, a fox pelt */
  (c) => {
    oval(c, 50, 28, 6, 8);
    line(c, [[45, 22], [38, 16], [40, 8]], 3.4);
    line(c, [[55, 22], [62, 16], [60, 8]], 3.4);
    line(c, [[32, 10], [50, 36], [68, 10]], 1.6);
    arms(c);
    belt(c, 'h');
    pelt(c, 46);
  },
];

/*
 * The Orkhon inscriptions: Old Turkic letters in columns, read from the top, cut between ruled lines, with a word mark
 * (two dots) here and there; the crowned steles carry the ibex, the khagans' mark, at the top. The letters run in
 * their own fixed order for each stele, so a stele always says the same.
 */
function inscription(seed: number, cols: number, ibex: boolean) {
  return (c: CanvasRenderingContext2D) => {
    let r = seed;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const top = ibex ? 46 : 14, x0 = 9, x1 = 91, step = (x1 - x0) / cols;
    if (ibex) {
      /* the ibex: a body, legs, and the great horns swept back */
      line(c, [[38, 34], [62, 34]], 4);
      line(c, [[40, 34], [38, 42]], 2.4);
      line(c, [[60, 34], [62, 42]], 2.4);
      line(c, [[38, 34], [34, 28]], 3.4);
      c.lineWidth = 2.6; c.beginPath(); c.arc(44, 26, 10, Math.PI * 1.05, Math.PI * 1.75); c.stroke();
    }
    for (let k = 0; k <= cols; k++) line(c, [[x0 + k * step, top - 4], [x0 + k * step, 292]], 0.7);
    c.font = `${step * 0.8}px ${RUNE_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let k = 0; k < cols; k++) {
      const cx = x0 + (k + 0.5) * step;
      for (let y = top + step * 0.5; y < 288; y += step * 0.95) {
        if (rnd() < 0.12) { oval(c, cx, y - step * 0.16, 0.9, 0.9); oval(c, cx, y + step * 0.16, 0.9, 0.9); continue; }
        c.fillText(GLYPHS[Math.floor(rnd() * GLYPHS.length)], cx, y);
      }
    }
  };
}
const INSCRIPTIONS = [inscription(11, 4, false), inscription(23, 5, true), inscription(37, 5, true)];

