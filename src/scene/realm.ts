import * as THREE from 'three';
import { NOISE3 } from './glsl';
import { sound } from './sound';

/*
 * Another place, reached through Lito's nebula: nothing but a sheer wall filling the view, square on, dim. It is a wall
 * of natural stones (a photographed one, ambientCG's Rocks001, CC0), its colour turned to black and wine red and its
 * surface truly shaped by its height map, so the joints are deep. Old Turkic letters are cut into some of the stones'
 * faces, burning amber from inside, their light bleeding into the stone around them; embers glint in the joints. Out
 * of the wall Lito's head pushes itself free, one piece of layered rock (Rock061): not a block but its lines (the
 * frame, the ears, the antenna), and as it comes away and turns to you its eyes light up, leaving a dark socket of its
 * shape behind.
 */

const loader = new THREE.TextureLoader();
/* a texture from public/realm, repeating `rx` by `ry` times across its surface */
function tex(name: string, rx: number, ry: number, colour = false) {
  const t = loader.load(`${import.meta.env.BASE_URL}realm/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/*
 * The photographed stone, regraded: its brightness kept (squared, so it sinks towards black), its hue thrown away, and
 * instead a deep wine red where the stone was warm and the noise allows, near black elsewhere. `wine` scales how much.
 */
const GRADE = /* glsl */ `
{
  vec3 src = diffuseColor.rgb;
  float L = dot(src, vec3(.3, .59, .11));
  float warm = smoothstep(.02, .12, src.r - src.b) * smoothstep(.35, .7, n3(vec3(vStone * .9, 3.)));
  diffuseColor.rgb = L * L * 1.4 * mix(vec3(.5, .47, .5), vec3(1.2, .3, .36), warm * WINE);
}
`;

/* the wall's stone, with its letters and embers, all fixed to where on the wall they are (`vStone`, in world units) */
function wallMaterial(uRunes: { value: THREE.Texture | null }, uGlow: { value: THREE.Color }, uTime: { value: number }) {
  const W = 18, H = 11, TILE = 3.2;
  const rx = W / TILE, ry = H / TILE;
  const disp = tex('rocks001_displacement', rx, ry);
  const mat = new THREE.MeshStandardMaterial({
    map: tex('rocks001_color', rx, ry, true),
    normalMap: tex('rocks001_normalgl', rx, ry),
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughnessMap: tex('rocks001_roughness', rx, ry),
    displacementMap: disp,
    /* sunk into the wall's plane, never out of it, so nothing stands in front of Lito's socket */
    displacementScale: 0.2,
    displacementBias: -0.2,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uRunes, uGlow, uTime, uDisp: { value: disp } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define WINE 1.\n${NOISE3}\nvarying vec2 vStone; uniform sampler2D uRunes; uniform sampler2D uDisp; uniform vec3 uGlow; uniform float uTime;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${GRADE}
/* how high the stone is here: its faces high, its joints low */
float hgt = texture2D(uDisp, vMapUv).r;
/* letters on a loose grid, about one place in five, each at its own slant, cut only into the stones' faces */
vec2 rc = floor(vStone / .75);
float cut = 0., halo = 0., rid = h3(vec3(rc, 4.));
if (rid < .2) {
  vec2 ctr = (rc + .3 + .4 * vec2(h3(vec3(rc, 5.)), h3(vec3(rc, 6.)))) * .75;
  float b = (h3(vec3(rc, 7.)) - .5) * .6;
  vec2 uv = mat2(cos(b), -sin(b), sin(b), cos(b)) * (vStone - ctr) / .34 + .5;
  float g = floor(h3(vec3(rc, 8.)) * 64.);
  vec2 gc = vec2(mod(g, 8.), floor(g / 8.));
  float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.) * smoothstep(.42, .6, hgt);
  vec4 t = texture2D(uRunes, vec2((gc.x + clamp(uv.x, 0., 1.)) / 8., (7. - gc.y + clamp(uv.y, 0., 1.)) / 8.)) * inside;
  cut = t.r; halo = t.g;
}
diffuseColor.rgb *= 1. - cut * .8;
/* embers deep in the joints */
vec2 eq = vStone * 30., ec = floor(eq);
float eh = h3(vec3(ec, 12.));
float fleck = step(.99, eh) * smoothstep(.4, .05, length(fract(eq) - .5)) * smoothstep(.3, .12, hgt) * (.55 + .45 * sin(uTime * 2. + eh * 50.));
float pulse = .7 + .3 * sin(uTime * 1.1 + rid * 40.);
float flare = smoothstep(.92, 1., sin(uTime * .37 + rid * 91.));
vec3 seep = uGlow * ((cut * 1.8 + halo * .55) * (pulse + flare * 1.4) + fleck * 2.4);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += seep;');
  };
  return mat;
}

/* Lito's head: layered rock, near black */
function headMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    map: tex('rock061_color', 0.7, 0.7, true),
    normalMap: tex('rock061_normalgl', 0.7, 0.7),
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: tex('rock061_roughness', 0.7, 0.7),
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define WINE .35\n${NOISE3}\nvarying vec2 vStone;`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${GRADE}`);
  };
  return mat;
}

/* Lito's head in its lines, in the extension's 512 wide design space, as flat shapes (y up, centred, `s` per unit) */
function litoShapes(s: number) {
  const X = (x: number) => (x - 256) * s, Y = (y: number) => -(y - 300) * s;
  const round = <T extends THREE.Path>(path: T, x: number, y: number, w: number, h: number, r: number) => {
    r = Math.min(r, w / 2, h / 2);
    path.moveTo(X(x + r), Y(y));
    path.lineTo(X(x + w - r), Y(y));
    path.absarc(X(x + w - r), Y(y + r), r * s, Math.PI / 2, 0, true);
    path.lineTo(X(x + w), Y(y + h - r));
    path.absarc(X(x + w - r), Y(y + h - r), r * s, 0, -Math.PI / 2, true);
    path.lineTo(X(x + r), Y(y + h));
    path.absarc(X(x + r), Y(y + h - r), r * s, -Math.PI / 2, -Math.PI, true);
    path.lineTo(X(x), Y(y + r));
    path.absarc(X(x + r), Y(y + r), r * s, Math.PI, Math.PI / 2, true);
    return path;
  };
  const shape = (x: number, y: number, w: number, h: number, r: number) => round(new THREE.Shape(), x, y, w, h, r);
  /* the frame: a ring, the head's outline 40 wide */
  const frame = shape(44, 164, 424, 330, 102);
  frame.holes.push(round(new THREE.Path(), 84, 204, 344, 250, 62));
  const ball = new THREE.Shape().absarc(X(256), Y(92), 26 * s, 0, Math.PI * 2, false);
  return {
    head: [
      frame,
      shape(12, 280, 40, 90, 18), shape(460, 280, 40, 90, 18), // the ears
      shape(246, 112, 20, 60, 8), ball, // the antenna
    ],
    eyes: [shape(140, 276, 104, 110, 34), shape(268, 276, 104, 110, 34)],
  };
}

export function createRealm(uRunes: { value: THREE.Texture | null }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030303');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const uTime = { value: 0 }, uGlow = { value: new THREE.Color('#ffa63d') };

  /* dim: low from the upper left, raking across the wall so every stone and joint shows; a faint fill from where you stand */
  const key = new THREE.DirectionalLight('#e6d6cc', 2.6);
  key.position.set(-6, 4, 3);
  scene.add(key, new THREE.HemisphereLight('#5a4648', '#0a0405', 0.35));
  const fill = new THREE.DirectionalLight('#d8ccc8', 0.3);
  fill.position.set(0, 1, 6);
  scene.add(fill);

  /* the wall, square on, finely divided so its height map can shape it */
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(18, 11, 640, 390), wallMaterial(uRunes, uGlow, uTime));
  wall.position.set(0, 0, -4.5);
  scene.add(wall);

  /* Lito's head, one piece of layered rock, set into the wall left of the middle; its eyes; the socket it leaves */
  const DEPTH = 0.22, s = litoShapes(1.7 / 512);
  const extrude = (shapes: THREE.Shape[], depth: number) =>
    new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2, curveSegments: 14 });
  const head = new THREE.Mesh(extrude(s.head, DEPTH), headMaterial());
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#120a04', emissive: new THREE.Color('#ff8a2a'), emissiveIntensity: 0, roughness: 0.6 });
  /* the eyes burn brightest at their hearts, darker towards the rim, with a flicker of embers */
  eyeMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEye;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvEye = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE3}\nvarying vec2 vEye; uniform float uTime;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float ed = length(vec2(abs(vEye.x) - .2125, vEye.y + .103) * vec2(1., .95));
totalEmissiveRadiance *= .25 + 1.6 * smoothstep(.17, .02, ed) * (.8 + .4 * n3(vec3(vEye * 30., uTime * 1.5)));`);
  };
  const eyes = new THREE.Mesh(extrude(s.eyes, DEPTH * 0.5), eyeMat);
  eyes.position.z = DEPTH * 0.3;
  head.add(eyes);
  const seat = new THREE.Vector3(-1.25, 0.1, 0);
  const holder = new THREE.Group();
  holder.position.copy(seat);
  holder.add(head);
  /* the eyes' light falls on the wall around */
  const eyeLight = new THREE.PointLight(uGlow.value, 0, 5, 1.6);
  eyeLight.position.set(0, -0.1, 1.1);
  holder.add(eyeLight);
  wall.add(holder);
  const socketMat = new THREE.MeshBasicMaterial({ color: '#020202', transparent: true, opacity: 0, depthWrite: false });
  const socket = new THREE.Mesh(new THREE.ShapeGeometry([...s.head, ...s.eyes], 14), socketMat);
  socket.position.copy(seat).setZ(0.004);
  wall.add(socket);

  /*
   * the head's way out, in seconds from arriving: a moment of stillness, then it grinds out of the rock with the view
   * shaking, cracks free, comes away from the wall turning towards you, its eyes lighting, and hangs there, breathing
   */
  const WAIT = 0.9, OUT = 2.4, FREE = 1.8;
  let since = 0, cue = 0;
  const toCam = new THREE.Vector3(), inv = new THREE.Quaternion(), shake = new THREE.Vector3(), seatWorld = new THREE.Vector3();
  /** Arriving: everything back in the rock, to come out again. */
  const enter = () => { since = 0; cue = 0; };

  const gaze = new THREE.Vector2();
  /** `ndc`: the pointer, -1 to 1; the view drifts a little after it. */
  const update = (dt: number, ndc: THREE.Vector2, t: number) => {
    since += dt;
    uTime.value = t;
    const ease = (k: number) => k * k * (3 - 2 * k);
    const out = ease(THREE.MathUtils.clamp((since - WAIT) / OUT, 0, 1));
    const free = ease(THREE.MathUtils.clamp((since - WAIT - OUT) / FREE, 0, 1));
    if (cue === 0 && since > WAIT) { cue = 1; sound.charge(OUT); }
    if (cue === 1 && since > WAIT + OUT) { cue = 2; sound.crack(-0.3); sound.hit(0.5, -0.3); }

    gaze.lerp(ndc, Math.min(1, dt * 2));
    const grind = out > 0 && out < 1 ? 1 : 0;
    shake.set(Math.sin(t * 47), Math.sin(t * 59 + 1.3), 0).multiplyScalar(grind * 0.012);
    camera.position.set(gaze.x * 0.4, gaze.y * 0.25, 0).add(shake);
    camera.lookAt(gaze.x * 0.8, gaze.y * 0.5, -4);
    camera.updateMatrixWorld();

    /* pushed out of the wall along its face, grinding (a shiver while it moves) */
    head.position.set((Math.random() - 0.5) * 0.012 * grind, (Math.random() - 0.5) * 0.012 * grind, -DEPTH - 0.04 + out * (DEPTH + 0.04));
    /* then away from the wall, towards you, turning to face you */
    wall.updateMatrixWorld();
    seatWorld.copy(seat).applyMatrix4(wall.matrixWorld);
    toCam.copy(camera.position).sub(seatWorld).normalize().applyQuaternion(inv.copy(wall.quaternion).invert());
    holder.position.copy(seat).addScaledVector(toCam, free * 0.45);
    holder.position.z += free * 0.25;
    holder.position.y += free * Math.sin(t * 1.4) * 0.04;
    /* only half way round: turned full on it would face away from the light */
    holder.rotation.y = free * Math.atan2(toCam.x, toCam.z) * 0.45;
    holder.rotation.z = free * Math.sin(t * 0.9) * 0.03;
    socketMat.opacity = Math.min(1, free * 3) * 0.92;
    /* the eyes light as it comes free, and keep a slow pulse */
    const lit = free * (0.85 + 0.15 * Math.sin(t * 1.7));
    eyeMat.emissiveIntensity = lit * 0.8;
    eyeLight.intensity = lit * 0.5;
  };
  const resize = (aspect: number) => { camera.aspect = aspect; camera.updateProjectionMatrix(); };

  return { scene, camera, update, resize, enter };
}
