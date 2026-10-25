import * as THREE from 'three';
import { STONE_COLOR, STONE_EMISSIVE, STONE_RELIEF, STONE_SHAPE, STONE_VERTEX, NOISE3 } from './glsl';
import { GLYPHS, RUNE_FONT, createBackdrop, createEnvironment, createInscription, createLeafTexture, createRuneAtlas } from './textures';
import { layStones, type Shape, type StoneSpot } from './shapes';
import { StoneField, type Pointer } from './stones';

const MAX_STONES = 1200;
const MAX_LEAVES = 6000;
const MAX_STEMS = 16000;
/** the rune and crack light when a shape names no colour: gök (sky) turquoise */
const RUNE_COLOR = '#7cf4ea';
const CAM_Z = 14;
/* three's lights are physically based; the look was tuned on the old "artist" scale, which is π lower */
const PI = Math.PI;

export type RuinsOptions = {
  /** asked to move one scene forward (+1) or back (-1) by wheel, keys or a touch swipe */
  onStep: (dir: 1 | -1) => void;
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
  private readonly floor: THREE.Mesh;
  private readonly lamp = new THREE.PointLight(0x40e0d0, 0, 4.5, 2);
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aHome: THREE.InstancedBufferAttribute;
  private readonly aMisc: THREE.InstancedBufferAttribute;
  private readonly runes = createRuneAtlas();
  private readonly inscription = createInscription();
  private readonly uni = {
    uRunes: { value: this.runes.texture as THREE.Texture },
    uInscription: { value: this.inscription.texture as THREE.Texture },
    uView: { value: new THREE.Vector2(1, 1) },
    uMouse: { value: new THREE.Vector3() },
    uHas: { value: 0 },
    uTime: { value: 0 },
    uSweep: { value: 0 },
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
  private seqIndex = 0;
  private seqTimer = 0;
  private time = 0;
  private sweep = 0;
  private swept = false;
  private held = false;
  private raf = 0;
  private last = 0;
  private pointer: Pointer = { has: false, x: 0, y: 0 };
  private ndc = new THREE.Vector2();
  private press: { x: number; y: number; timer: number } | null = null;
  private wheelLock = 0;
  private readonly camBase = new THREE.Vector3(1.6, 0.9, CAM_Z);
  private readonly look = new THREE.Vector3(0, -0.1, 0);

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, first: Shape[], opts: RuinsOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.field = new StoneField(this.reduced);
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
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.ShadowMaterial({ opacity: 0.45 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    scene.add(this.floor);

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
          uniform sampler2D uRunes; uniform sampler2D uInscription; uniform vec2 uView; uniform vec3 uMouse; uniform float uHas; uniform float uTime; uniform float uSweep; uniform vec3 uRune;
          varying vec3 vLocal; varying vec3 vSize; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vHome;`)
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
    this.assign(first[0], true);
    this.uni.uRune.value.copy(this.runeTarget);
    this.bind();
    document.fonts?.ready.then(() => Promise.all([
      document.fonts.load('800 100px "Inter Tight"'),
      document.fonts.load(`40px ${RUNE_FONT}`, GLYPHS[0x22]),
    ])).then(() => {
      this.runes.redraw();
      this.layouts.clear();
      this.assign(this.sequence[this.seqIndex], this.time < 1.2);
    }).catch(() => { /* fonts are optional; the system fallbacks still draw */ });
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Float the stones into a shape; several shapes take turns every few seconds. */
  show(shapes: Shape[]) {
    this.sequence = shapes;
    this.seqIndex = 0;
    this.seqTimer = 0;
    this.held = false;
    this.assign(shapes[0]);
    this.swept = false;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.renderer.dispose();
  }

  private assign(shape: Shape, intro = false) {
    this.runeTarget.set(shape.runeColor ?? RUNE_COLOR);
    const spots = this.layout(shape);
    /* a slab's inscription is painted to fit the slab's face */
    if ('slab' in shape && spots[0]) this.inscription.paint(shape.slab, spots[0].w / spots[0].h);
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
    this.floor.position.y = -this.hh * 0.96 - 0.02;
    this.field.setView(this.hw, this.hh);
    this.layouts.clear();
  };

  private resizeTimer = 0;
  private readonly onResize = () => {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => { this.resize(); this.assign(this.sequence[this.seqIndex]); }, 200);
  };

  private readonly onMove = (e: PointerEvent) => {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.pointer.has = true;
    if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 14) clearTimeout(this.press.timer);
  };
  private readonly onLeave = () => { this.pointer.has = false; };
  private readonly onDown = (e: PointerEvent) => {
    const timer = window.setTimeout(() => { this.held = true; this.canvas.classList.add('held'); this.field.crumble(); }, e.pointerType === 'mouse' ? 140 : 280);
    this.press = { x: e.clientX, y: e.clientY, timer };
  };
  private readonly onUp = (e: PointerEvent) => {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    const dy = e.clientY - this.press.y, dx = e.clientX - this.press.x;
    if (!this.held && e.pointerType !== 'mouse' && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) this.opts.onStep(dy < 0 ? 1 : -1);
    if (this.held) { this.held = false; this.field.rebuild(); }
    this.press = null;
    this.canvas.classList.remove('held');
    if (e.pointerType !== 'mouse') this.pointer.has = false;
  };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const now = performance.now();
    if (now < this.wheelLock || Math.abs(e.deltaY) < 6) return;
    this.wheelLock = now + 1500;
    this.opts.onStep(e.deltaY > 0 ? 1 : -1);
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) this.opts.onStep(1);
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) this.opts.onStep(-1);
    if (e.key === ' ' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') {
      e.preventDefault();
      this.held = !this.held;
      if (this.held) this.field.crumble(); else this.field.rebuild();
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
        this.swept = false;
      }
    }
    if (!this.swept && this.field.settled) { this.swept = true; this.sweep = 1; }
    this.sweep = Math.max(0, this.sweep - dt / 1.4);

    if (this.pointer.has) {
      this.ray.setFromCamera(this.ndc, this.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) { this.pointer.x = this.hit.x; this.pointer.y = this.hit.y; }
    }
    this.field.step(dt * 0.5, this.time, this.pointer);
    this.field.step(dt * 0.5, this.time, this.pointer);

    /* write instances */
    const stones = this.field.stones;
    let nl = 0, ns = 0;
    stones.forEach((st, i) => {
      const sp = st.spot;
      const w = sp ? sp.w : 1, h = sp ? sp.h : 1, d = sp ? sp.d : 1;
      this.q.setFromEuler(st.r);
      this.s.set(w * st.alive, h * st.alive, d * st.alive);
      this.m.compose(st.p, this.q, this.s);
      this.stoneMesh.setMatrixAt(i, this.m);
      this.aHome.setXYZ(i, sp ? sp.x : st.p.x, sp ? sp.y : st.p.y, 0);
      this.aSize.setXYZ(i, w, h, d);
      this.aMisc.setXY(i, sp ? sp.glyph : 0, st.seed);
      if (sp?.vine && st.alive > 0.05) {
        this.m2.compose(st.p, this.q, this.s.setScalar(st.alive));
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

    const u = this.uni;
    u.uTime.value = this.time;
    u.uSweep.value = this.sweep;
    u.uRune.value.lerp(this.runeTarget, Math.min(1, dt * 2.5));
    this.lamp.color.copy(u.uRune.value);
    u.uHas.value = this.pointer.has ? 1 : 0;
    u.uMouse.value.set(this.pointer.x, this.pointer.y, 0);
    this.lamp.position.set(this.pointer.x, this.pointer.y, 1.4);
    this.lamp.intensity += ((this.pointer.has ? 1.8 * PI : 0) - this.lamp.intensity) * Math.min(1, dt * 5);

    /* camera: a slight three-quarter view that follows the pointer, plus a little shake when stones land */
    this.field.shake = Math.max(0, this.field.shake - dt * 0.5);
    const shake = this.field.shake, par = this.reduced ? 0 : 1;
    this.camera.position.set(
      this.camBase.x + this.ndc.x * 1.4 * par + (Math.random() - 0.5) * shake,
      this.camBase.y + this.ndc.y * 0.8 * par + (Math.random() - 0.5) * shake,
      this.camBase.z,
    );
    this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
  };
}
