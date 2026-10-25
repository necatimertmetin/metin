import * as THREE from 'three';
import { GROUND_COLOR, GROUND_EMISSIVE, GROUND_FN, GROUND_RELIEF, STONE_COLOR, STONE_EMISSIVE, STONE_RELIEF, STONE_SHAPE, STONE_VERTEX, NOISE3 } from './glsl';
import { createGroundGeometry } from './ground';
import { createSky } from './sky';
import { GLYPHS, HOLES_D, HOLES_MAX_DEPTH, HOLES_W, HOLES_Z0, RUNE_FONT, createBackdrop, createEnvironment, createHoleMask, createLeafTexture, createRuneAtlas } from './textures';
import { layStones, type Shape, type StoneSpot } from './shapes';
import { StoneField, type Pointer } from './stones';
import { sound } from './sound';
import { growVine } from './vines';
import type { StonePhysics } from './physics';

const MAX_STONES = 1200;
const MAX_LEAVES = 6000;
const MAX_STEMS = 16000;
const MAX_PITS = 2400;
/** the rune and crack light when a shape names no colour: gök (sky) turquoise */
const RUNE_COLOR = '#7cf4ea';
const CAM_Z = 14;
/* three's lights are physically based; the look was tuned on the old "artist" scale, which is π lower */
const PI = Math.PI;

export type RuinsOptions = {
  /** asked to move one scene forward (+1) or back (-1) by wheel, keys or a touch swipe */
  onStep: (dir: 1 | -1) => void;
  /** the visitor has begun (by the opening stone, or Enter / Space) */
  onStart: () => void;
};

/**
 * Words and shapes built from floating ancient stones, each cut with a Göktürk rune.
 * The pointer lights runes and cracks; holding drops the stones; `show` floats them into any new shape:
 * text, an SVG path or a canvas drawing (see `Shape`).
 */
export class RuinsScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  private readonly field: StoneField;
  private readonly stoneMesh: THREE.InstancedMesh;
  private readonly leafMesh: THREE.InstancedMesh;
  private readonly stemMesh: THREE.InstancedMesh;
  private readonly pitMesh: THREE.InstancedMesh;
  private readonly floor: THREE.Mesh;
  private readonly sky: ReturnType<typeof createSky>;
  private readonly lamp = new THREE.PointLight(0x40e0d0, 0, 4.5, 2);
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aHome: THREE.InstancedBufferAttribute;
  private readonly aMisc: THREE.InstancedBufferAttribute;
  private readonly runes = createRuneAtlas();
  private readonly holes = createHoleMask();
  private readonly uni = {
    uRunes: { value: this.runes.texture as THREE.Texture },
    uView: { value: new THREE.Vector2(1, 1) },
    uMouse: { value: new THREE.Vector3() },
    uHas: { value: 0 },
    uTime: { value: 0 },
    uSweep: { value: 0 },
    /** how charged the opening stone's rune is as it rises to strike, 0 to 1 */
    uGate: { value: 0 },
    uRune: { value: new THREE.Color(RUNE_COLOR) },
  };
  /** the rune colour the current shape asks for; `uRune` eases towards it */
  private readonly runeTarget = new THREE.Color(RUNE_COLOR);
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly opts: RuinsOptions;

  private hw = 1;
  private hh = 1;
  private layouts = new Map<Shape, StoneSpot[]>();
  private sequence: Shape[];
  /** the opening is waiting on a single stone until the visitor begins; nothing else happens before */
  private started = false;
  /** seconds into the opening stone's strike (rise, then slam), or -1 when it isn't striking */
  private strikeT = -1;
  /** the shock wave across the ground from the strike: x, z of the impact, seconds since it (-1 before), strength */
  private readonly wave = { value: new THREE.Vector4(0, 0, -1, 0) };
  private seqIndex = 0;
  private seqTimer = 0;
  private time = 0;
  private sweep = 0;
  private swept = false;
  private held = false;
  /** the opening is over: every stone has come out of the ground and reached its place once; only then can they be dropped */
  private introDone = false;
  /** the rigid-body physics for dropped stones, once its engine has loaded; until then (or if it can't) they fall the simple way */
  private physics: StonePhysics | null = null;
  private raf = 0;
  private last = 0;
  private pointer: Pointer = { has: false, x: 0, y: 0 };
  private ndc = new THREE.Vector2();
  /** where the camera is looking, easing after the pointer */
  private readonly gaze = new THREE.Vector2();
  private press: { x: number; y: number; timer: number } | null = null;
  private wheelLock = 0;
  private readonly camBase = new THREE.Vector3(1.6, 0.9, CAM_Z);
  private readonly look = new THREE.Vector3(0, -0.1, 0);

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, first: Shape[], opts: RuinsOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.field = new StoneField(this.reduced);
    /* a stone breaking out of the ground leaves its hole behind */
    this.field.onBreak = (x, y, z, w, d, depth, angle) => { this.addPit(x, y, z, w, d, depth, angle); sound.crack(x / this.hw); };
    this.field.onLand = (strength, x) => sound.hit(strength, x / this.hw);
    this.field.onHome = (x) => sound.tick(x / this.hw);
    this.sequence = first;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;

    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x0a0b0d, 0.018);
    scene.background = createBackdrop();
    scene.environment = createEnvironment(r);

    /* daylight: a warm sun high and in front to the left, sky and ground bounce, a cool fill and a warm rim from behind */
    scene.add(new THREE.HemisphereLight(0xcfdcf2, 0x6a5a46, 0.28 * PI));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2 * PI);
    sun.position.set(-7, 11, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 9, bottom: -9, near: 1, far: 40 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    /* sky light still reaches into a stone's shadow, so it never goes black */
    sun.shadow.intensity = 0.7;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffcf96, 1.2 * PI);
    rim.position.set(-8, 10, -5);
    const fill = new THREE.DirectionalLight(0xa9bcff, 0.3 * PI);
    fill.position.set(7, 1, 9);
    scene.add(rim, fill, this.lamp);
    /* the ground: the one great rock the stones break away from */
    /* little sky reflection: seen at a slant it would wash the dark rock out to a pale sand */
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.12 });
    groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.uHoles = { value: this.holes.texture };
      sh.uniforms.uRunes = this.uni.uRunes;
      sh.uniforms.uRune = this.uni.uRune;
      sh.uniforms.uWave = this.wave;
      sh.uniforms.uHolesRect = { value: new THREE.Vector4(HOLES_W / 2, HOLES_Z0, HOLES_W, HOLES_D) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE3}\nvarying vec3 vGPos; uniform sampler2D uHoles; uniform vec4 uHolesRect; uniform sampler2D uRunes; uniform vec3 uRune; uniform vec4 uWave;\n${GROUND_FN}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_COLOR}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(.88, .72, gmoss) + gcrack * .08;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GROUND_RELIEF}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${GROUND_EMISSIVE}`);
    };
    this.floor = new THREE.Mesh(createGroundGeometry(), groundMat);
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    /* the night sky over it all */
    this.sky = createSky(this.uni.uRune);
    scene.add(this.sky.group);


    /* stones: one subdivided cube, shaped per instance in the vertex shader */
    const geo = new THREE.BoxGeometry(1, 1, 1, 10, 10, 10);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STONES * 3), 3);
    this.aHome = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STONES * 3), 3);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STONES * 2), 2);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aHome', this.aHome);
    geo.setAttribute('aMisc', this.aMisc);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${STONE_SHAPE}\nvarying vec3 vLocal; varying vec3 vSize; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vHome;`)
        .replace('#include <beginnormal_vertex>', `${STONE_VERTEX}\nvec3 objectNormal = sn;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = sp0;\nvLocal = position; vSize = aSize; vMisc = aMisc; vHome = aHome;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE3}
          uniform sampler2D uRunes; uniform vec2 uView; uniform vec3 uMouse; uniform float uHas; uniform float uTime; uniform float uSweep; uniform vec3 uRune; uniform float uGate;
          varying vec3 vLocal; varying vec3 vSize; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vHome;\n${GROUND_FN}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${STONE_COLOR}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = .9 + crack * .08;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${STONE_RELIEF}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${STONE_EMISSIVE}`);
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${STONE_SHAPE}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = stoneP(position, normal);');
    };
    this.stoneMesh = new THREE.InstancedMesh(geo, mat, MAX_STONES);
    this.stoneMesh.castShadow = true; this.stoneMesh.receiveShadow = false;
    this.stoneMesh.customDepthMaterial = depth;
    this.stoneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stoneMesh.frustumCulled = false;
    this.stoneMesh.count = 0;
    scene.add(this.stoneMesh);

    /* vines ride on the stones: a thin stem of instanced segments, and leaves */
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3d4a22, roughness: 0.85, metalness: 0 });
    this.stemMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), stemMat, MAX_STEMS);
    this.stemMesh.castShadow = this.stemMesh.receiveShadow = true;
    this.stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stemMesh.frustumCulled = false;
    this.stemMesh.count = 0;
    scene.add(this.stemMesh);

    /* pits: the holes stones leave in the ground, boxes seen from inside (only their far walls and floor draw) */
    const pitMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.95, metalness: 0, side: THREE.BackSide });
    pitMat.onBeforeCompile = (sh) => {
      sh.uniforms.uHoles = { value: this.holes.texture };
      sh.uniforms.uHoleDepth = { value: this.holes.depthTexture };
      sh.uniforms.uHolesRect = { value: new THREE.Vector4(HOLES_W / 2, HOLES_Z0, HOLES_W, HOLES_D) };
      sh.uniforms.uHoleMax = { value: HOLES_MAX_DEPTH };
      const vary = 'varying float vShade; varying vec3 vPW; varying vec3 vPN; varying float vTop; varying float vPitDepth;';
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${vary}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvShade = position.y + .5;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
mat4 pitM = modelMatrix * instanceMatrix;
vPW = (pitM * vec4(transformed, 1.)).xyz;
vPN = normalize(mat3(pitM) * normal);
vTop = (pitM * vec4(0., .5, 0., 1.)).y;
vPitDepth = vTop - (pitM * vec4(0., -.5, 0., 1.)).y;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${vary}
uniform sampler2D uHoles; uniform sampler2D uHoleDepth; uniform vec4 uHolesRect; uniform float uHoleMax;
vec2 holeUV(vec2 xz) { return vec2((xz.x + uHolesRect.x) / uHolesRect.z, 1. - (xz.y - uHolesRect.y) / uHolesRect.w); }`)
        /* where pits overlap they open into one another: a wall with another hole just beyond it, at least as deep as
           this point, isn't there, and neither is a floor lying inside a deeper hole. Then darker towards the bottom. */
        .replace('#include <color_fragment>', `#include <color_fragment>
if (abs(vPN.y) < .5) {
  vec2 beyond = holeUV(vPW.xz + vPN.xz * .04);
  if (texture2D(uHoles, beyond).r > .5 && texture2D(uHoleDepth, beyond).r * uHoleMax >= vTop - vPW.y - .01) discard;
} else if (texture2D(uHoleDepth, holeUV(vPW.xz)).r * uHoleMax > vPitDepth + .03) discard;
diffuseColor.rgb *= mix(.12, 1., vShade * vShade);`);
    };
    this.pitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pitMat, MAX_PITS);
    this.pitMesh.receiveShadow = true;
    this.pitMesh.frustumCulled = false;
    this.pitMesh.count = 0;
    scene.add(this.pitMesh);

    const leafTex = createLeafTexture();
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0, envMapIntensity: 0.6 });
    this.leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMat, MAX_LEAVES);
    this.leafMesh.castShadow = this.leafMesh.receiveShadow = true;
    this.leafMesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.45 });
    this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leafMesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < MAX_LEAVES; i++) this.leafMesh.setColorAt(i, col.setHSL(0.2 + Math.random() * 0.08, 0.45 + Math.random() * 0.25, 0.35 + Math.random() * 0.25));
    this.leafMesh.count = 0;
    scene.add(this.leafMesh);

    this.resize();
    /* the physics engine loads in the background, in its own chunk, so it never holds up the opening */
    import('./physics').then((m) => m.StonePhysics.create()).then((p) => {
      p.setGround(-this.hh * 0.96);
      p.onHit = (strength, x) => sound.hit(strength, x / this.hw);
      this.physics = p;
    }).catch(() => { /* no WebAssembly: the simple fall stays */ });
    /* first only the one stone, waiting to be struck */
    this.runeTarget.set(first[0].runeColor ?? RUNE_COLOR);
    this.uni.uRune.value.copy(this.runeTarget);
    this.field.placeAt([this.gateSpot()]);
    this.bind();
    document.fonts?.ready.then(() => Promise.all([
      document.fonts.load('800 100px "Inter Tight"'),
      document.fonts.load(`40px ${RUNE_FONT}`, GLYPHS[0x22]),
    ])).then(() => {
      this.runes.redraw();
      this.sky.rebuild();
      this.layouts.clear();
      if (this.started) this.assign(this.sequence[this.seqIndex]);
    }).catch(() => { /* fonts are optional; the system fallbacks still draw */ });
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Float the stones into a shape; several shapes take turns every few seconds. */
  show(shapes: Shape[]) {
    this.sequence = shapes;
    this.seqIndex = 0;
    this.seqTimer = 0;
    this.held = false;
    this.physics?.release();
    this.assign(shapes[0]);
    sound.whoosh(1.8);
    this.swept = false;
  }

  /**
   * Begin: the waiting stone strikes the ground (this is also the gesture that lets the sound start), and a moment later
   * the stones break out of the rock. The struck stone rises again and takes its place among them.
   */
  start() {
    if (this.started) return;
    this.started = true;
    sound.unlock();
    this.sky.show();
    this.opts.onStart();
    const st = this.field.stones[0];
    if (!st) { this.assign(this.sequence[this.seqIndex], true); return; }
    st.mode = 'script';
    st.restY = st.p.y;
    this.strikeT = 0;
    sound.charge(0.6);
    sound.whoosh(0.9, 0.5);
  }

  /* the strike: the stone rises and its rune charges, then it is driven down into the rock */
  private static readonly RISE = 0.6;
  private static readonly SLAM = 0.16;
  private strike(dt: number) {
    const t = (this.strikeT += dt), st = this.field.stones[0];
    if (!st || st.mode !== 'script') { this.strikeT = -1; return; }
    const top = st.restY + this.hh * 0.22;
    if (t < RuinsScene.RISE) {
      const k = t / RuinsScene.RISE, e = 1 - (1 - k) ** 3;
      st.p.y = st.restY + (top - st.restY) * e;
      st.r.set(Math.sin(t * 60) * 0.025 * k, st.r.y + dt * 2.5 * k, (st.spot?.tilt ?? 0) + Math.sin(t * 47) * 0.025 * k);
      this.uni.uGate.value = k;
      return;
    }
    /* driven into the rock, a fifth of its height */
    const k = Math.min(1, (t - RuinsScene.RISE) / RuinsScene.SLAM), floor = this.field.floorAt(st.p.x, st.p.z) + st.size.y * 0.3;
    st.p.y = top + (floor - top) * k * k * k;
    if (k < 1) return;
    /* impact: the stone stays sunk where it hit, the ground shakes, a wave of rune light runs out across the rock,
       and the stones begin to break free of it */
    this.strikeT = -1;
    st.mode = 'rest';
    st.restY = st.p.y;
    st.q.setFromEuler(st.r);
    st.v.set(0, 0, 0);
    st.w.set(0, 0, 0);
    /* it leaves its hole in the rock when it rises again */
    const ground = this.field.floorAt(st.p.x, st.p.z), depth = ground - (st.p.y - st.size.y / 2);
    this.addPit(st.p.x, ground - depth / 2, st.p.z, st.size.x * 1.02, st.size.z * 1.02, depth, st.r.y);
    this.wave.value.set(st.p.x, st.p.z, 0, 1);
    this.field.shake = 0.35;
    sound.boom();
    window.setTimeout(() => this.assign(this.sequence[this.seqIndex], true), 250);
  }

  /** The opening stone: one stone hovering in the middle, ivy over it, a rune like a target cut in it (𐰧, Yenisei ENT). */
  private gateSpot(): StoneSpot {
    const s = this.hh * 0.3;
    return { x: 0, y: this.hh * 0.06, z: 0, w: s, h: s * 1.08, d: s * 0.72, tilt: 0.06, glyph: 0x27, vine: growVine(s, s * 1.08, s * 0.72, s / 3) };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.renderer.dispose();
  }

  /** Drop the stones: real physics if its engine is ready, else the field's simple fall. */
  private drop() {
    this.field.crumble();
    this.physics?.drop(this.field.stones.filter((s) => s.mode === 'fall'));
  }

  /** Lift the stones from wherever they lie and send them back into the shape. */
  private rise() {
    this.physics?.release();
    this.field.rebuild();
    sound.whoosh(1.4, 0.8);
  }

  /** Open a hole in the ground where a stone lay: cut it out of the ground and set a pit of the stone's size under it. */
  private addPit(x: number, y: number, z: number, w: number, d: number, depth: number, angle: number) {
    if (this.pitMesh.count >= MAX_PITS) return;
    this.holes.add(x, z, w, d, angle, depth);
    /* y is the stone's centre as it lay, flush with the surface; the pit is the room it took up */
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), this.s.set(w, depth, d));
    this.pitMesh.setMatrixAt(this.pitMesh.count++, this.m);
    this.pitMesh.instanceMatrix.needsUpdate = true;
  }

  private assign(shape: Shape, intro = false) {
    this.runeTarget.set(shape.runeColor ?? RUNE_COLOR);
    const spots = this.layout(shape);
    this.field.assign(spots, intro);
  }

  private layout(shape: Shape) {
    let l = this.layouts.get(shape);
    if (!l) { l = layStones(shape, this.hw, this.hh, MAX_STONES); this.layouts.set(shape, l); }
    return l;
  }

  private readonly resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 46 : 30;
    this.camera.updateProjectionMatrix();
    this.hh = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAM_Z * 0.82;
    this.hw = this.hh * this.camera.aspect;
    this.uni.uView.value.set(this.hw, this.hh);
    this.floor.position.y = -this.hh * 0.96;
    this.physics?.setGround(-this.hh * 0.96);
    this.field.setView(this.hw, this.hh);
    this.layouts.clear();
  };

  private resizeTimer = 0;
  private readonly onResize = () => {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resize();
      if (this.started) this.assign(this.sequence[this.seqIndex]); else this.field.placeAt([this.gateSpot()]);
    }, 200);
  };

  private readonly onMove = (e: PointerEvent) => {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.pointer.has = true;
    if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 14) clearTimeout(this.press.timer);
  };
  private readonly onLeave = () => { this.pointer.has = false; };
  private readonly onDown = (e: PointerEvent) => {
    const timer = window.setTimeout(() => { if (!this.introDone) return; this.held = true; this.canvas.classList.add('held'); this.drop(); }, e.pointerType === 'mouse' ? 140 : 280);
    this.press = { x: e.clientX, y: e.clientY, timer };
  };
  private readonly onUp = (e: PointerEvent) => {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    const dy = e.clientY - this.press.y, dx = e.clientX - this.press.x;
    if (this.started && !this.held && e.pointerType !== 'mouse' && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) this.opts.onStep(dy < 0 ? 1 : -1);
    if (this.held) { this.held = false; this.rise(); }
    this.press = null;
    this.canvas.classList.remove('held');
    if (e.pointerType !== 'mouse') this.pointer.has = false;
  };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.started) return;
    const now = performance.now();
    if (now < this.wheelLock || Math.abs(e.deltaY) < 6) return;
    this.wheelLock = now + 1500;
    this.opts.onStep(e.deltaY > 0 ? 1 : -1);
  };
  /* audio may only start from a gesture, so any press anywhere on the page can be the one */
  private readonly onAnyPress = () => sound.unlock();
  private readonly onVisibility = () => sound.setVisible(document.visibilityState === 'visible');
  private readonly onKey = (e: KeyboardEvent) => {
    sound.unlock();
    if (!this.started) {
      if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') { e.preventDefault(); this.start(); }
      return;
    }
    if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) this.opts.onStep(1);
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) this.opts.onStep(-1);
    if (e.key === ' ' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') {
      e.preventDefault();
      if (!this.introDone) return;
      this.held = !this.held;
      if (this.held) this.drop(); else this.rise();
    }
  };

  private bind() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pointerdown', this.onAnyPress);
  }
  private unbind() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointerdown', this.onAnyPress);
  }

  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly hit = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.033, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.time += dt;

    /* shapes that take turns (MERHABA / HELLO) */
    if (this.sequence.length > 1 && !this.held) {
      this.seqTimer += dt;
      if (this.seqTimer > 4.2 && this.field.settled) {
        this.seqTimer = 0;
        this.seqIndex = (this.seqIndex + 1) % this.sequence.length;
        this.assign(this.sequence[this.seqIndex]);
        sound.whoosh(1.6, 0.7);
        this.swept = false;
      }
    }
    if (!this.swept && this.field.settled) { this.swept = true; this.sweep = 1; }
    if (this.started && this.field.settled) this.introDone = true;
    this.sweep = Math.max(0, this.sweep - dt / 1.4);

    if (this.pointer.has) {
      this.ray.setFromCamera(this.ndc, this.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) { this.pointer.x = this.hit.x; this.pointer.y = this.hit.y; }
    }
    if (this.strikeT >= 0) this.strike(dt);
    else this.uni.uGate.value *= Math.exp(-dt * 3);
    if (this.wave.value.z >= 0 && this.wave.value.z < 10) this.wave.value.z += dt;
    this.physics?.step(dt);
    this.field.step(dt * 0.5, this.time, this.pointer);
    this.field.step(dt * 0.5, this.time, this.pointer);

    /* write instances */
    const stones = this.field.stones;
    let nl = 0, ns = 0;
    stones.forEach((st, i) => {
      const sp = st.spot;
      const w = st.size.x || 1, h = st.size.y || 1, d = st.size.z || 1;
      this.q.setFromEuler(st.r);
      this.s.set(w * st.alive, h * st.alive, d * st.alive);
      this.m.compose(st.p, this.q, this.s);
      this.stoneMesh.setMatrixAt(i, this.m);
      this.aHome.setXYZ(i, sp ? sp.x : st.p.x, sp ? sp.y : st.p.y, st.bury);
      this.aSize.setXYZ(i, w, h, d);
      this.aMisc.setXY(i, sp ? sp.glyph : 0, st.seed);
      if (sp?.vine && st.alive > 0.05) {
        /* vines only show once the stone is out of the ground */
        /* and grow with the stone while it changes size */
        const k = st.alive * (1 - st.bury);
        this.m2.compose(st.p, this.q, this.s.set(k * w / sp.w, k * h / sp.h, k * d / sp.d));
        for (const sm of sp.vine.stem) {
          if (ns >= MAX_STEMS) break;
          this.stemMesh.setMatrixAt(ns++, this.m.multiplyMatrices(this.m2, sm));
        }
        for (const lm of sp.vine.leaves) {
          if (nl >= MAX_LEAVES) break;
          this.leafMesh.setMatrixAt(nl++, this.m.multiplyMatrices(this.m2, lm));
        }
      }
    });
    this.stoneMesh.count = stones.length;
    this.stoneMesh.instanceMatrix.needsUpdate = true;
    this.aHome.needsUpdate = this.aSize.needsUpdate = this.aMisc.needsUpdate = true;
    this.leafMesh.count = nl;
    this.leafMesh.instanceMatrix.needsUpdate = true;
    this.stemMesh.count = ns;
    this.stemMesh.instanceMatrix.needsUpdate = true;
    this.holes.flush();

    const u = this.uni;
    u.uTime.value = this.time;
    u.uSweep.value = this.sweep;
    u.uRune.value.lerp(this.runeTarget, Math.min(1, dt * 2.5));
    this.lamp.color.copy(u.uRune.value);
    u.uHas.value = this.pointer.has ? 1 : 0;
    u.uMouse.value.set(this.pointer.x, this.pointer.y, 0);
    this.lamp.position.set(this.pointer.x, this.pointer.y, 1.4);
    this.lamp.intensity += ((this.pointer.has ? 1.8 * PI : 0) - this.lamp.intensity) * Math.min(1, dt * 5);

    /*
     * camera: a slight three-quarter view that looks where the pointer goes (up towards the sky, out to the sides),
     * easing after it, with only a little sway of its own, plus a little shake when stones land
     */
    this.field.shake = Math.max(0, this.field.shake - dt * 0.5);
    const shake = this.field.shake, par = this.reduced ? 0 : 1;
    this.gaze.lerp(this.ndc, Math.min(1, dt * 3));
    this.camera.position.set(
      /* the shake is a smooth wobble, not a fresh random jolt every frame, so the far sky doesn't flicker */
      this.camBase.x + this.gaze.x * 0.6 * par + Math.sin(this.time * 41) * shake * 0.5,
      this.camBase.y + this.gaze.y * 0.25 * par + Math.sin(this.time * 53 + 1.7) * shake * 0.5,
      this.camBase.z,
    );
    this.camera.lookAt(this.look.x + this.gaze.x * 1.6 * par, this.look.y + this.gaze.y * 2.6 * par, this.look.z);
    this.camera.updateMatrixWorld();
    this.sky.update(dt, this.camera, this.pointer.has ? this.ray.ray.direction : null);
    this.renderer.render(this.scene, this.camera);
  };
}
