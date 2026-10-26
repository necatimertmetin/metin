import * as THREE from "three";
import {
  GROUND_COLOR,
  GROUND_EMISSIVE,
  GROUND_FN,
  GROUND_RELIEF,
  STONE_COLOR,
  STONE_EMISSIVE,
  STONE_RELIEF,
  STONE_SHAPE,
  STONE_VERTEX,
  NOISE3,
} from "./glsl";
import { createGroundGeometry } from "./ground";
import { createEnclosure, type Site } from "./gobekli";
import { createDerinkuyu, DERIN } from "./derinkuyu";
import { LOOKS, RIDGE, regionOf, type Region } from "./regions";
import { createRealm, type Card } from "./realm";
import { createSky, type SkyProject } from "./sky";
import type { Story } from "./tengri";
import {
  GLYPHS,
  HOLES_D,
  HOLES_MAX_DEPTH,
  HOLES_W,
  HOLES_Z0,
  RUNE_FONT,
  createBackdrop,
  createEnvironment,
  createHoleMask,
  createRuneAtlas,
} from "./textures";
import { layStones, type Shape, type StoneSpot } from "./shapes";
import { StoneField, type Pointer } from "./stones";
import { sound } from "./sound";
import { growVine } from "./vines";
import type { Pit, StonePhysics } from "./physics";

const MAX_STONES = 1200;

/* where the six leaves lie in the ivy picture (its pixels, 1024 across): left, top, right, bottom */
const IVY_LEAVES: [number, number, number, number][] = [
  [52, 17, 389, 333], [635, 55, 893, 323], [65, 378, 414, 694], [641, 405, 930, 652], [606, 707, 919, 1000], [46, 710, 440, 1011],
];

/*
 * The grain of real stone (ambientCG's Rock030, CC0), packed in one picture: R its light and dark, G its height, B its
 * roughness. The stones take only their texture from it; their colour stays their own.
 */
function loadDetail() {
  const t = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}stone/rock030_detail.jpg`,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const MAX_LEAVES = 6000;
const MAX_STEMS = 16000;
const MAX_PITS = 2400;
/** the rune and crack light when a shape names no colour: gök (sky) turquoise */
const RUNE_COLOR = "#7cf4ea";
const CAM_Z = 14;
/* three's lights are physically based; the look was tuned on the old "artist" scale, which is π lower */
const PI = Math.PI;

export type RuinsOptions = {
  /** asked to move one scene forward (+1) or back (-1) by wheel, keys or a touch swipe */
  onStep: (dir: 1 | -1) => void;
  /** the visitor has begun (by the opening stone, or Enter / Space) */
  onStart: () => void;
  /** the project constellations in the sky */
  projects?: SkyProject[];
  /** a project constellation was touched (its index), or the open one closed (-1) */
  onProject?: (project: number) => void;
  /** the monuments the first scene raises (or Derinkuyu, which it opens), if any */
  site?: Site | "derinkuyu";
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
    uDetail: { value: loadDetail() },
  };
  /** the rune colour the current shape asks for; `uRune` eases towards it */
  private readonly runeTarget = new THREE.Color(RUNE_COLOR);
  private readonly reduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
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
  /* the jolt a landing boulder gives the view, and how fast it is moving; a spring brings it back */
  private readonly kick = new THREE.Vector2();
  private readonly kickV = new THREE.Vector2();
  /* every pit opened in the ground, for the physics */
  private readonly pits: Pit[] = [];
  private press: { x: number; y: number; timer: number } | null = null;
  /** the scene leans the camera up towards the sky (the projects scene) */
  private lookUp = false;
  /** the project constellation under the pointer, the one pressed on, and the one open (-1 for none) */
  private hoverProject = -1;
  private pressProject = -1;
  private openProject = -1;
  /* Teŋri's word in the sky: under the pointer, pressed on, open (its story written under it) */
  private tengriHover = false;
  private pressTengri = false;
  private tengriOpen = false;
  /** where the camera turns to see the open project, and where it is looking now (easing between) */
  private focusDir: THREE.Vector3 | null = null;
  private baseFov = 30;
  /*
   * Lito's own place, a wall of rock (a trial): opening Lito leans into its nebula, and in a flash of light the view is
   * there instead; closing comes back the same way. 0 is here, 1 is there, the flash at the middle.
   */
  private readonly realm = createRealm(this.uni.uRunes);
  private realmWant = false;
  private realmT = 0;
  private wasThere = false;
  private realmProject = -1;
  /* coming back from a wall the view is still turning: the constellations take no pointer until this time */
  private skyQuietUntil = 0;
  /* where it last looked, kept while what was there says goodbye */
  private lastFocus: THREE.Vector3 | null = null;
  private readonly lookCur = new THREE.Vector3(0, -0.1, 0);
  private readonly lookWant = new THREE.Vector3();
  private readonly gazeWant = new THREE.Vector2();
  private wheelLock = 0;
  private readonly camBase = new THREE.Vector3(1.6, 0.9, CAM_Z);
  /* Göbeklitepe's pillars and the Orkhon steles, each raised out of the ground in its own scene */
  private readonly monuments = new Map<Site, ReturnType<typeof createEnclosure>>();
  private site: Site | "derinkuyu" | undefined;
  /* Derinkuyu: the cover slides off an air shaft and the view comes over it to look down into the underground city */
  private readonly derin: ReturnType<typeof createDerinkuyu>;
  /* the shaft's mouth in the ground: x, z of its middle, its half width, and whether it is there */
  private readonly shaft = { value: new THREE.Vector4(DERIN.SX, DERIN.SZ, DERIN.A, 0) };
  /* how far the view has gone over to the shaft, 0 to 1 */
  private derinView = 0;
  private readonly torch = new THREE.Vector3();
  private readonly tmpKick = new THREE.Vector3();
  /*
   * The places: the one the view is in, and the flight to another (0 to 1, -1 when not flying), like a drone: leaving
   * a place with monuments it first comes down to them and sweeps half round them, close, then turns away and climbs
   * a little, the ground running by under it as one place turns into the next, and comes down in the other.
   * `flightH` is how high it cruises; `from` the place it left; `orbit` whether it goes round monuments first.
   */
  private region: Region = "home";
  private from: Region = "home";
  private flightT = -1;
  private flightDur = 2.6;
  private flightH = 6;
  private flightV = 26;
  private orbit = false;
  private readonly basePos = new THREE.Vector3();
  private readonly baseLook = new THREE.Vector3();
  private readonly dronePos = new THREE.Vector3();
  private readonly droneDir = new THREE.Vector3();
  private travel0 = 0;
  private swapped = false;
  private readonly look2 = new THREE.Vector3();
  private readonly fogA = new THREE.Color();
  private readonly regionU = {
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uHome: { value: 1 },
    uGrass: { value: 0 },
    uHoleOn: { value: 1 },
    uTravel: { value: new THREE.Vector2() },
    uRidge: { value: new THREE.Vector2() },
  };
  private readonly tmpLook = new THREE.Vector3();
  private readonly level = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private monumentTimer = 0;
  private lastGrind = 0;
  private readonly look = new THREE.Vector3(0, -0.1, 0);

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, first: Shape[], opts: RuinsOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.realm.useProjects(opts.projects ?? []);
    /* the walls' shaders are made ready in the background, so the first visit to one doesn't stall */
    window.setTimeout(() => this.renderer.compile(this.realm.scene, this.realm.camera), 2500);
    this.field = new StoneField(this.reduced);
    /* a stone breaking out of the ground leaves its hole behind */
    this.field.onBreak = (x, y, z, w, d, depth, angle) => {
      this.addPit(x, y, z, w, d, depth, angle);
      sound.crack(x / this.hw);
    };
    this.field.onLand = (strength, x, size) => this.land(strength, x, size);
    this.field.onHome = (x) => sound.tick(x / this.hw);
    this.sequence = first;
    this.site = opts.site;
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;

    const scene = this.scene;
    /* night air: the distance fades into a faint blue-grey haze rather than staying sharp, as it would on the Moon */
    scene.fog = new THREE.FogExp2(0x161a21, 0.034);
    scene.background = createBackdrop();
    scene.environment = createEnvironment(r);

    /* daylight: a warm sun high and in front to the left, sky and ground bounce, a cool fill and a warm rim from behind */
    scene.add(new THREE.HemisphereLight(0xcfdcf2, 0x6a5a46, 0.28 * PI));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2 * PI);
    sun.position.set(-7, 11, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -12,
      right: 12,
      top: 9,
      bottom: -9,
      near: 1,
      far: 40,
    });
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
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.12,
    });
    groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.uHoles = { value: this.holes.texture };
      sh.uniforms.uRunes = this.uni.uRunes;
      sh.uniforms.uDetail = this.uni.uDetail;
      sh.uniforms.uRune = this.uni.uRune;
      sh.uniforms.uWave = this.wave;
      sh.uniforms.uShaft = this.shaft;
      Object.assign(sh.uniforms, this.regionU);
      sh.uniforms.uHolesRect = {
        value: new THREE.Vector4(HOLES_W / 2, HOLES_Z0, HOLES_W, HOLES_D),
      };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vGPos;\n${NOISE3}\n${RIDGE}`)
        /* the far land of the place, raised out of the ground, and its slopes lit as slopes */
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y += ridgeAt(position.xz);")
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nif (uRidge.x > 0.) { float r0 = ridgeAt(position.xz); float rx = ridgeAt(position.xz + vec2(.35, 0.)) - r0, rz = ridgeAt(position.xz + vec2(0., .35)) - r0; objectNormal = normalize(objectNormal + vec3(-rx, 0., -rz) / .35); }",
        )
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n${NOISE3}\nvarying vec3 vGPos; uniform sampler2D uHoles; uniform vec4 uHolesRect; uniform sampler2D uRunes; uniform vec3 uRune; uniform vec4 uWave; uniform vec4 uShaft; uniform vec3 uTint; uniform float uHome; uniform float uGrass; uniform float uHoleOn; uniform vec2 uTravel;\n${GROUND_FN}`,
        )
        /* Derinkuyu: the air shaft's mouth */
        .replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nif (uShaft.w > .5 && abs(vGPos.x - uShaft.x) < uShaft.z && abs(vGPos.z - uShaft.y) < uShaft.z) discard;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>\n${GROUND_COLOR}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor = mix(.88, .72, gmoss) + gcrack * .08;",
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\n${GROUND_RELIEF}`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>\n${GROUND_EMISSIVE}`,
        );
    };
    this.floor = new THREE.Mesh(createGroundGeometry(), groundMat);
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    /* Göbeklitepe's pillars and the Orkhon steles, under the ground until their scene comes */
    const events = {
      /* each heaves up out of the earth (the ring's ones quieter, and not two at once, or it would be a din) */
      onGrind: (x: number, big: boolean, dur: number) => {
        if (!big && this.time - this.lastGrind < 0.3) return;
        this.lastGrind = this.time;
        sound.emerge(dur, x / this.hw, big);
      },
      /* and settles with a boulder's weight; the two great ones shake the view */
      onLand: (x: number, big: boolean) => {
        if (big) this.land(1, x, this.hh * 0.4);
        else sound.hit(0.45, x / this.hw, 0.85);
      },
    };
    this.derin = createDerinkuyu(this.uni.uDetail, this.uni.uTime, {
      /* the cover grinds off the curb, and comes down on the ground with a boulder's weight */
      onOpen: () => sound.emerge(1.9, 0.3, true),
      onOpened: () => this.land(0.75, 3, this.hh * 0.4),
      onRoll: (x) => sound.emerge(1.1, x / this.hw, false),
    });
    scene.add(this.derin.group);
    for (const site of ["gobekli", "orkhon"] as const) {
      const m = createEnclosure(this.uni.uDetail, this.uni.uRune, this.uni.uTime, events, site);
      this.monuments.set(site, m);
      scene.add(m.group);
    }

    /* the night sky over it all */
    this.sky = createSky(this.uni.uRune, opts.projects ?? []);
    scene.add(this.sky.group);

    /* stones: one subdivided cube, shaped per instance in the vertex shader */
    const geo = new THREE.BoxGeometry(1, 1, 1, 10, 10, 10);
    this.aSize = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_STONES * 3),
      3,
    );
    this.aHome = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_STONES * 3),
      3,
    );
    this.aMisc = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_STONES * 2),
      2,
    );
    geo.setAttribute("aSize", this.aSize);
    geo.setAttribute("aHome", this.aHome);
    geo.setAttribute("aMisc", this.aMisc);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\n${STONE_SHAPE}\nvarying vec3 vLocal; varying vec3 vSize; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vHome; varying vec3 vSN;`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `${STONE_VERTEX}\nvec3 objectNormal = sn;\nvSN = snW;`,
        )
        .replace(
          "#include <begin_vertex>",
          "vec3 transformed = sp0;\nvLocal = position; vSize = aSize; vMisc = aMisc; vHome = aHome;",
        )
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;",
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n${NOISE3}
          uniform sampler2D uRunes; uniform vec2 uView; uniform vec3 uMouse; uniform float uHas; uniform float uTime; uniform float uSweep; uniform vec3 uRune; uniform float uGate;
          varying vec3 vLocal; varying vec3 vSize; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vHome; varying vec3 vSN;\n${GROUND_FN}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>\n${STONE_COLOR}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor = mix(.72, 1., stoneTex.b) + crack * .08;",
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\n${STONE_RELIEF}`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>\n${STONE_EMISSIVE}`,
        );
    };
    const depth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    depth.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${STONE_SHAPE}`)
        .replace(
          "#include <begin_vertex>",
          "vec3 transformed = stoneP(position, normal);",
        );
    };
    this.stoneMesh = new THREE.InstancedMesh(geo, mat, MAX_STONES);
    this.stoneMesh.castShadow = true;
    this.stoneMesh.receiveShadow = false;
    this.stoneMesh.customDepthMaterial = depth;
    this.stoneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stoneMesh.frustumCulled = false;
    this.stoneMesh.count = 0;
    scene.add(this.stoneMesh);

    /* vines ride on the stones: a thin stem of instanced segments, and leaves */
    /* ivy's stems are woody: brown going green, rough */
    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x45391f,
      roughness: 0.92,
      metalness: 0,
    });
    this.stemMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 5, 1, true),
      stemMat,
      MAX_STEMS,
    );
    this.stemMesh.castShadow = this.stemMesh.receiveShadow = true;
    this.stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stemMesh.frustumCulled = false;
    this.stemMesh.count = 0;
    scene.add(this.stemMesh);

    /* pits: the holes stones leave in the ground, boxes seen from inside (only their far walls and floor draw) */
    const pitMat = new THREE.MeshStandardMaterial({
      color: 0x2a2620,
      roughness: 0.95,
      metalness: 0,
      side: THREE.BackSide,
    });
    pitMat.onBeforeCompile = (sh) => {
      sh.uniforms.uHoles = { value: this.holes.texture };
      sh.uniforms.uHoleDepth = { value: this.holes.depthTexture };
      sh.uniforms.uHolesRect = {
        value: new THREE.Vector4(HOLES_W / 2, HOLES_Z0, HOLES_W, HOLES_D),
      };
      sh.uniforms.uHoleMax = { value: HOLES_MAX_DEPTH };
      const vary =
        "varying float vShade; varying vec3 vPW; varying vec3 vPN; varying float vTop; varying float vPitDepth;";
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${vary}`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\nvShade = position.y + .5;`,
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
mat4 pitM = modelMatrix * instanceMatrix;
vPW = (pitM * vec4(transformed, 1.)).xyz;
vPN = normalize(mat3(pitM) * normal);
vTop = (pitM * vec4(0., .5, 0., 1.)).y;
vPitDepth = vTop - (pitM * vec4(0., -.5, 0., 1.)).y;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n${vary}
uniform sampler2D uHoles; uniform sampler2D uHoleDepth; uniform vec4 uHolesRect; uniform float uHoleMax;
vec2 holeUV(vec2 xz) { return vec2((xz.x + uHolesRect.x) / uHolesRect.z, 1. - (xz.y - uHolesRect.y) / uHolesRect.w); }`,
        )
        /* where pits overlap they open into one another: a wall with another hole just beyond it, at least as deep as
           this point, isn't there, and neither is a floor lying inside a deeper hole. Then darker towards the bottom. */
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
if (abs(vPN.y) < .5) {
  vec2 beyond = holeUV(vPW.xz + vPN.xz * .04);
  if (texture2D(uHoles, beyond).r > .5 && texture2D(uHoleDepth, beyond).r * uHoleMax >= vTop - vPW.y - .01) discard;
} else if (texture2D(uHoleDepth, holeUV(vPW.xz)).r * uHoleMax > vPitDepth + .03) discard;
diffuseColor.rgb *= mix(.12, 1., vShade * vShade);`,
        );
    };
    this.pitMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      pitMat,
      MAX_PITS,
    );
    this.pitMesh.receiveShadow = true;
    this.pitMesh.frustumCulled = false;
    this.pitMesh.count = 0;
    scene.add(this.pitMesh);

    /*
     * real ivy leaves (ambientCG's LeafSet017, CC0): six photographed leaves in one picture; each leaf in the scene
     * takes one of them, fitted into its square without stretching, stalk down, so it grows out from the stem
     */
    const leafTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}vine/ivy_color.png`);
    leafTex.colorSpace = THREE.SRGBColorSpace;
    leafTex.anisotropy = 4;
    const leafNormal = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}vine/ivy_normal.jpg`);
    const leafRects = IVY_LEAVES.map(([x0, y0, x1, y1]) => {
      const side = Math.max(x1 - x0, y1 - y0), sx = (x0 + x1 - side) / 2, sy = Math.max(0, y1 - side);
      return new THREE.Vector4(sx / 1024, 1 - (sy + side) / 1024, side / 1024, side / 1024);
    });
    const leafUv = (sh: THREE.WebGLProgramParametersWithUniforms) => {
      sh.uniforms.uLeafRect = { value: leafRects };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\nattribute float aCell; uniform vec4 uLeafRect[${IVY_LEAVES.length}];`)
        .replace("#include <uv_vertex>", `#include <uv_vertex>
vec4 leafR = uLeafRect[int(aCell)];
vec2 leafUv = leafR.xy + uv * leafR.zw;
#ifdef USE_MAP
vMapUv = leafUv;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = leafUv;
#endif`);
    };
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      normalMap: leafNormal,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0,
      envMapIntensity: 0.4,
    });
    leafMat.onBeforeCompile = leafUv;
    const leafGeo = new THREE.PlaneGeometry(1, 1);
    const cells = new Float32Array(MAX_LEAVES);
    for (let i = 0; i < MAX_LEAVES; i++) cells[i] = Math.floor(Math.random() * IVY_LEAVES.length);
    leafGeo.setAttribute("aCell", new THREE.InstancedBufferAttribute(cells, 1));
    this.leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, MAX_LEAVES);
    this.leafMesh.castShadow = this.leafMesh.receiveShadow = true;
    const leafDepth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: leafTex,
      alphaTest: 0.5,
    });
    leafDepth.onBeforeCompile = leafUv;
    this.leafMesh.customDepthMaterial = leafDepth;
    this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leafMesh.frustumCulled = false;
    /* the photographs carry their own colour, deepened for the night: each leaf a little darker or lighter, a touch
       yellower or bluer */
    const col = new THREE.Color();
    for (let i = 0; i < MAX_LEAVES; i++) {
      const v = 0.42 + Math.random() * 0.25;
      this.leafMesh.setColorAt(i, col.setRGB(v * (0.7 + Math.random() * 0.15), v, v * (0.55 + Math.random() * 0.15)));
    }
    this.leafMesh.count = 0;
    scene.add(this.leafMesh);

    this.resize();
    /* the physics engine loads in the background, in its own chunk, so it never holds up the opening */
    import("./physics")
      .then((m) => m.StonePhysics.create())
      .then((p) => {
        p.setGround(-this.hh * 0.96);
        p.onHit = (strength, x, size) => this.land(strength, x, size);
        this.physics = p;
      })
      .catch(() => {
        /* no WebAssembly: the simple fall stays */
      });
    /* first only the one stone, waiting to be struck */
    this.runeTarget.set(first[0].runeColor ?? RUNE_COLOR);
    this.uni.uRune.value.copy(this.runeTarget);
    this.field.placeAt([this.gateSpot()]);
    this.bind();
    document.fonts?.ready
      .then(() =>
        Promise.all([
          document.fonts.load('800 100px "Inter Tight"'),
          document.fonts.load(`40px ${RUNE_FONT}`, GLYPHS[0x22]),
        ]),
      )
      .then(() => {
        this.runes.redraw();
        this.sky.rebuild();
        this.layouts.clear();
        if (this.started) this.assign(this.sequence[this.seqIndex]);
      })
      .catch(() => {
        /* fonts are optional; the system fallbacks still draw */
      });
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Float the stones into a shape; several shapes take turns every few seconds. */
  show(shapes: Shape[], lookUp = false, site?: Site | "derinkuyu") {
    this.setTengri(false);
    this.lookUp = lookUp;
    this.site = site;
    this.sequence = shapes;
    this.seqIndex = 0;
    this.seqTimer = 0;
    this.held = false;
    this.physics?.release();
    this.swept = false;
    /* a scene in another place: the stones and the monuments here go, the view flies there, and they come once it lands */
    if (this.started && (regionOf(site) !== this.region || this.flightT >= 0)) {
      this.runeTarget.set(shapes[0].runeColor ?? RUNE_COLOR);
      /* the monuments stay standing: the view leaves them behind */
      this.field.assign([], false);
      if (this.flightT < 0) this.fly(this.region === "home" ? 3.2 : 6.5, 3.4, 30);
      return;
    }
    if (this.started) this.raise(site);
    this.assign(shapes[0]);
    sound.whoosh(1.8);
  }

  /** Fly to the place the scene is in, over `dur` seconds, rising `height`, at up to `speed` units a second. */
  private fly(dur: number, height: number, speed: number) {
    this.flightT = 0;
    this.flightDur = this.reduced ? 0.8 : dur;
    this.flightH = this.reduced ? 0 : height;
    this.flightV = this.reduced ? 0 : speed;
    this.swapped = false;
    this.from = this.region;
    this.orbit = !this.reduced && this.region !== "home";
    this.travel0 = this.regionU.uTravel.value.y;
    /* the holes and pits stay where they are; the ground running by would leave them behind, so they go */
    this.regionU.uHoleOn.value = 0;
    this.pitMesh.visible = false;
    sound.whoosh(dur * 0.9, 0.9);
  }

  /* the flight's course: halfway, behind the cloud, the place changes; landed, its stones and monuments come */
  private flight(dt: number) {
    if (this.flightT < 0) return;
    this.flightT = Math.min(1, this.flightT + dt / this.flightDur);
    const p = this.flightT, to = regionOf(this.site), cs = this.cruiseFrom(), span = 1 - cs;
    /* once it has turned away, the ground runs on beneath, at full speed while it cruises */
    const sp = THREE.MathUtils.smoothstep(p, cs, cs + 0.12) * (1 - THREE.MathUtils.smoothstep(p, 0.8, 0.96));
    this.regionU.uTravel.value.y -= this.flightV * sp * dt;
    /* and on the way the one place becomes the other */
    this.blendRegion(this.from, to, THREE.MathUtils.smoothstep(p, cs + span * 0.25, cs + span * 0.7));
    /* what stood here is carried off with the ground, behind the view */
    if (!this.swapped) this.monuments.forEach((m) => m.slide(this.travel0 - this.regionU.uTravel.value.y));
    if (!this.swapped && p >= cs + span * 0.45) {
      this.swapped = true;
      this.monuments.forEach((m) => m.hide());
      this.region = to;
    }
    if (p < 1) return;
    this.flightT = -1;
    this.setRegion(this.region);
    /* the visitor may have scrolled on meanwhile, to yet another place */
    if (regionOf(this.site) !== this.region) { this.fly(2.4, 3.4, 26); return; }
    this.assign(this.sequence[this.seqIndex]);
    this.raise(this.site);
  }

  /* when the flight stops going round the monuments and sets off */
  private cruiseFrom() {
    return this.orbit ? 0.42 : 0;
  }

  /*
   * The drone's view at `p` of the flight, from the view it would have standing (`basePos` looking at `baseLook`):
   * round the monuments first, if any, looking at them; then turning away to cruise, a little up, looking ahead and
   * down; then down into the standing view.
   */
  private drone(p: number) {
    const U = this.hh / 3.08, g = -this.hh * 0.96, S = THREE.MathUtils.smoothstep;
    const C = this.tmpLook.set(0, g + 1.5 * U, -1.6 * U);
    const cs = this.cruiseFrom();
    const cruise = this.look2.copy(this.basePos).add(this.tmpKick.set(0, this.flightH * U, 0));
    /* round the monuments: from where it stands, closing in to just outside them, low, half way round */
    const round = (o: number, out: THREE.Vector3) => {
      const th0 = Math.atan2(this.basePos.x - C.x, this.basePos.z - C.z), d0 = Math.hypot(this.basePos.x - C.x, this.basePos.z - C.z);
      const e = o * o * (3 - 2 * o), close = S(o, 0, 0.45);
      const r = THREE.MathUtils.lerp(d0, 6.4 * U, close), th = th0 + e * 3.3;
      const y = THREE.MathUtils.lerp(this.basePos.y, g + 1.6 * U, close) + Math.sin(o * Math.PI) * 0.6 * U;
      return out.set(C.x + Math.sin(th) * r, y, C.z + Math.cos(th) * r);
    };
    const pos = this.dronePos;
    let yawA: number, pitchA: number;
    const dirTo = (from: THREE.Vector3, to: THREE.Vector3) => {
      const d = this.droneDir.subVectors(to, from).normalize();
      return [Math.atan2(d.x, -d.z), Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))] as const;
    };
    /* cruising it looks ahead, a little down: the land running at it and the horizon, not the ground under it */
    const fwd = dirTo(new THREE.Vector3(), new THREE.Vector3(0, -1.1, -7));
    let yaw: number, pitch: number;
    if (this.orbit && p < cs) {
      round(p / cs, pos);
      [yaw, pitch] = dirTo(pos, C);
    } else {
      const start = this.orbit ? round(1, new THREE.Vector3()) : this.basePos.clone();
      const q = S(p, cs, cs + 0.22);
      pos.lerpVectors(start, cruise, q);
      [yawA, pitchA] = this.orbit ? dirTo(start, C) : dirTo(this.basePos, this.baseLook);
      /* turn the short way round to look ahead */
      let dy = fwd[0] - yawA;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const t = S(p, cs, cs + (this.orbit ? 0.14 : 0.2));
      yaw = yawA + dy * t;
      pitch = THREE.MathUtils.lerp(pitchA, fwd[1], t);
    }
    /* and down into the standing view at the end */
    const l = S(p, 0.8, 1);
    const [yawB, pitchB] = dirTo(this.basePos, this.baseLook);
    let dl = yawB - yaw;
    dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    yaw += dl * l;
    pitch = THREE.MathUtils.lerp(pitch, pitchB, l);
    pos.lerp(this.basePos, l);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.tmpLook.set(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * Math.cos(pitch)));
    /* a little bank as it sweeps and turns */
    this.camera.rotateZ(Math.sin(p * Math.PI * 2) * 0.05 * (1 - l));
  }

  /** Become another place: the ground's colour, the grass, the haze, the land rising far off. */
  private setRegion(r: Region) {
    this.region = r;
    this.blendRegion(r, r, 1);
    /* the holes stones left are at home */
    this.pitMesh.visible = r === "home";
    this.regionU.uHoleOn.value = r === "home" ? 1 : 0;
  }

  /* the ground's colour, grass, runes and the haze, part way from one place's to another's */
  private blendRegion(a: Region, b: Region, t: number) {
    const A = LOOKS[a], B = LOOKS[b], l = THREE.MathUtils.lerp;
    this.regionU.uTint.value.set(l(A.tint[0], B.tint[0], t), l(A.tint[1], B.tint[1], t), l(A.tint[2], B.tint[2], t));
    this.regionU.uHome.value = l(A.home, B.home, t);
    this.regionU.uGrass.value = l(A.grass, B.grass, t);
    this.regionU.uRidge.value.set(l(A.ridge, B.ridge, t), l(A.peaks, B.peaks, t));
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.fogA.set(A.fog)).lerp(new THREE.Color(B.fog), t);
    fog.density = l(A.density, B.density, t);
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
    if (!st) {
      this.arrive();
      return;
    }
    st.mode = "script";
    st.restY = st.p.y;
    this.strikeT = 0;
    /* it tears itself up out of the rock, grinding, as the boulders do */
    sound.crack(0);
    sound.whoosh(0.9, 0.5);
  }

  /* the strike: the stone rises and its rune charges, then it is driven down into the rock */
  private static readonly RISE = 0.6;
  private static readonly SLAM = 0.16;
  private strike(dt: number) {
    const t = (this.strikeT += dt),
      st = this.field.stones[0];
    if (!st || st.mode !== "script") {
      this.strikeT = -1;
      return;
    }
    const top = st.restY + this.hh * 0.22;
    if (t < RuinsScene.RISE) {
      const k = t / RuinsScene.RISE,
        e = 1 - (1 - k) ** 3;
      st.p.y = st.restY + (top - st.restY) * e;
      st.r.set(
        Math.sin(t * 60) * 0.025 * k,
        st.r.y + dt * 2.5 * k,
        (st.spot?.tilt ?? 0) + Math.sin(t * 47) * 0.025 * k,
      );
      this.uni.uGate.value = k;
      return;
    }
    /* driven into the rock, a fifth of its height */
    const k = Math.min(1, (t - RuinsScene.RISE) / RuinsScene.SLAM),
      floor = this.field.floorAt(st.p.x, st.p.z) + st.size.y * 0.3;
    st.p.y = top + (floor - top) * k * k * k;
    if (k < 1) return;
    /* impact: the stone stays sunk where it hit, the ground shakes, a wave of rune light runs out across the rock,
       and the stones begin to break free of it */
    this.strikeT = -1;
    /* still held by the script: it sinks on from here (see sink) */
    st.mode = "script";
    st.restY = st.p.y;
    st.q.setFromEuler(st.r);
    st.v.set(0, 0, 0);
    st.w.set(0, 0, 0);
    this.wave.value.set(st.p.x, st.p.z, 0, 1);
    this.field.shake = 0.35;
    /* the heaviest landing of all: the boulders' own sound at full weight, and the hardest jolt to the view */
    sound.hit(1, 0, 1);
    if (!this.reduced) {
      this.kickV.x += (Math.random() - 0.5) * 1.2;
      this.kickV.y -= 2.6;
    }
    /* and then it keeps going: the rock takes it in, and leaves no hole */
    this.sinkT = 0;
  }

  /* the struck stone sinks on down into the rock, grinding, and is gone; then the first scene comes */
  private sinkT = -1;
  private sink(dt: number) {
    const t = (this.sinkT += dt),
      st = this.field.stones[0];
    if (t > 0.15 && t - dt <= 0.15) sound.crack(0);
    if (!st) { this.sinkT = -1; return; }
    const k = Math.min(1, Math.max(0, t - 0.15) / 1.1);
    st.p.y = st.restY - k * k * st.size.y * 1.2;
    st.r.x = Math.sin(t * 43) * 0.012 * (1 - k);
    st.r.z = (st.spot?.tilt ?? 0) + Math.sin(t * 37) * 0.012 * (1 - k);
    this.field.shake = Math.max(this.field.shake, 0.06 * (1 - k));
    if (k < 1) return;
    this.sinkT = -1;
    this.field.stones.splice(0, 1);
    this.arrive();
  }

  /* after the opening strike: the stones break out here, or, if the first scene is somewhere else, the view goes there,
     a long climb up into the stars first */
  private arrive() {
    if (regionOf(this.site) !== this.region) this.fly(4, 3.8, 30);
    else {
      this.assign(this.sequence[this.seqIndex], true);
      this.raise(this.site);
    }
  }

  /** The opening stone: one stone hovering in the middle, ivy over it, a rune like a target cut in it (𐰧, Yenisei ENT). */
  /**
   * How big a stone is among the others, for its sound: they are all meant as boulders, so 0.6 for the smallest up to
   * 1 for one as big as the opening stone (sizes are relative to the view).
   */
  /*
   * A boulder lands: its sound, and a jolt to the view of its own, by how big it is and how hard it came down: a drop
   * and a throw to one side at random, which a spring then rocks back out of; and a little rumble after.
   */
  private land(strength: number, x: number, size: number) {
    const z = this.bigness(size);
    sound.hit(strength, x / this.hw, z);
    if (this.reduced) return;
    const m = strength * z * z;
    this.kickV.x += (Math.random() - 0.5) * m * 1.6;
    this.kickV.y -= m * (1.2 + Math.random() * 0.8);
    this.field.shake = Math.min(0.25, this.field.shake + m * 0.05);
  }

  private bigness(size: number) {
    return 0.6 + 0.4 * THREE.MathUtils.clamp(size / (this.hh * 0.38), 0, 1);
  }

  private gateSpot(): StoneSpot {
    const s = this.hh * 0.6;
    return {
      x: 0,
      y: this.hh * 0.06,
      z: 0,
      w: s,
      h: s * 1.08,
      d: s * 0.72,
      tilt: 0.06,
      glyph: 0x27,
      vine: growVine(s, s * 1.08, s * 0.72, s / 3),
    };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.renderer.dispose();
  }

  /** Drop the stones: real physics if its engine is ready, else the field's simple fall. */
  private drop() {
    /* the pits are in the physics' ground too, so stones can fall back into them */
    this.physics?.setPits(this.pits);
    this.field.crumble();
    this.physics?.drop(this.field.stones.filter((s) => s.mode === "fall"));
  }

  /** Lift the stones from wherever they lie and send them back into the shape. */
  private rise() {
    this.physics?.release();
    this.field.rebuild();
    sound.whoosh(1.4, 0.8);
  }

  /** Open a project's constellation (the camera turns to it, it writes its name in stars), or close it with -1. */
  setProject(project: number) {
    if (project >= 0) this.setTengri(false);
    this.openProject = project;
    this.sky.focus(project);
    this.focusDir = project >= 0 ? this.sky.gazeAt(project) : null;
    if (this.focusDir) this.lastFocus = this.focusDir;
    /* any project opened takes you to its own wall */
    const realm = project >= 0;
    if (!realm && this.realmWant) this.skyQuietUntil = this.time + 5;
    if (realm) this.realmProject = project;
    if (realm !== this.realmWant) sound.whoosh(1.6, 0.6);
    this.realmWant = realm;
  }

  /** Open Teŋri's story in the sky (the view turns to it), or close it. */
  setTengri(on: boolean) {
    if (on === this.tengriOpen) return;
    this.tengriOpen = on;
    this.sky.openTengri(on);
    this.focusDir = on ? this.sky.gazeTengri() : this.openProject >= 0 ? this.sky.gazeAt(this.openProject) : null;
    if (this.focusDir) this.lastFocus = this.focusDir;
    /* coming back, the sky takes no pointer for a moment, so the word does not light again under it at once */
    if (!on) this.skyQuietUntil = this.time + 1.2;
    sound.whoosh(1.8, 0.6);
  }

  /** Teŋri's story, in the language chosen. */
  tellTengri(story: Story) {
    this.sky.tellTengri(story);
  }

  /** What the open project's tablet says, at its wall. */
  setCard(card: Card | null) {
    this.realm.setCard(card);
  }

  /**
   * Raise the scene's monuments (or open Derinkuyu) and put the others away. Coming from Derinkuyu the ground has to
   * close first, or what rises would be seen under it.
   */
  private raise(site: Site | "derinkuyu" | undefined) {
    clearTimeout(this.monumentTimer);
    this.derin.set(site === "derinkuyu");
    const up = () => this.monuments.forEach((m, s) => m.set(s === site));
    if (this.derin.open > 0 && site !== "derinkuyu") {
      this.monuments.forEach((m) => m.set(false));
      this.monumentTimer = window.setTimeout(up, 1700);
    } else up();
  }

  /** Open a hole in the ground where a stone lay: cut it out of the ground and set a pit of the stone's size under it. */
  private addPit(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    depth: number,
    angle: number,
  ) {
    if (this.pitMesh.count >= MAX_PITS) return;
    this.holes.add(x, z, w, d, angle, depth);
    this.pits.push({ x, z, w, d, angle, depth });
    /* y is the stone's centre as it lay, flush with the surface; the pit is the room it took up */
    this.m.compose(
      new THREE.Vector3(x, y, z),
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
      this.s.set(w, depth, d),
    );
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
    if (!l) {
      l = layStones(shape, this.hw, this.hh, MAX_STONES);
      this.layouts.set(shape, l);
    }
    return l;
  }

  private readonly resize = () => {
    const w = window.innerWidth,
      h = window.innerHeight;
    /* no more than one and a half pixels per CSS pixel: past that the cost grows faster than anyone can see */
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.realm.resize(w / h);
    this.baseFov = this.camera.fov = w / h < 0.8 ? 46 : 30;
    this.camera.updateProjectionMatrix();
    const px =
      (h * Math.min(window.devicePixelRatio || 1, 1.5)) /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.monuments.forEach((m) => m.resize(px));
    this.derin.resize(px);
    this.hh =
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAM_Z * 0.82;
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
      if (this.started) this.assign(this.sequence[this.seqIndex]);
      else this.field.placeAt([this.gateSpot()]);
    }, 200);
  };

  private readonly onMove = (e: PointerEvent) => {
    this.ndc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    this.pointer.has = true;
    if (
      this.press &&
      Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 14
    )
      clearTimeout(this.press.timer);
  };
  private readonly onLeave = () => {
    this.pointer.has = false;
  };
  private readonly onDown = (e: PointerEvent) => {
    /* on Teŋri, or while its story is open, a press is a click */
    if (this.tengriHover || this.tengriOpen) {
      this.pressTengri = this.tengriHover;
      this.press = { x: e.clientX, y: e.clientY, timer: 0 };
      return;
    }
    /* on a project constellation, or while one is open, a press is a click, never the start of a drop */
    if (this.hoverProject >= 0 || this.openProject >= 0) {
      this.pressProject = this.hoverProject;
      this.press = { x: e.clientX, y: e.clientY, timer: 0 };
      return;
    }
    const timer = window.setTimeout(
      () => {
        if (!this.introDone) return;
        this.held = true;
        this.canvas.classList.add("held");
        this.drop();
      },
      e.pointerType === "mouse" ? 140 : 280,
    );
    this.press = { x: e.clientX, y: e.clientY, timer };
  };
  private readonly onUp = (e: PointerEvent) => {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    const dy = e.clientY - this.press.y,
      dx = e.clientX - this.press.x;
    /* a click on Teŋri opens its story; with it open, a click anywhere closes it */
    if (this.pressTengri || this.tengriOpen) {
      if (Math.hypot(dx, dy) < 14) this.setTengri(!this.tengriOpen && this.pressTengri);
      this.pressTengri = false;
      this.press = null;
      if (e.pointerType !== "mouse") this.pointer.has = false;
      return;
    }
    if (this.pressProject >= 0 || this.openProject >= 0) {
      /* a click opens the constellation pressed on, or anywhere else closes the open one */
      if (Math.hypot(dx, dy) < 14) {
        /* at a project's wall, a click does not take you back: only the tablet's close mark does, or it opens the link */
        if (this.realmWant) {
          const what = this.realmT >= 0.5 ? this.realm.hit(this.ndc) : null;
          if (what === "close") {
            this.realm.pressClose();
            this.opts.onProject?.(-1);
          }
          else if (what === "link") {
            const href = this.realm.linkHref();
            if (href) window.open(href, "_blank", "noopener");
          }
        } else if (
          /* on the open one itself, a touch for whatever lives there (Lito), not a close */
          this.pressProject >= 0 &&
          this.pressProject === this.hoverProject &&
          this.pressProject === this.openProject
        ) {
          if (!this.sky.poke()) this.opts.onProject?.(-1);
        } else if (
          this.pressProject >= 0 &&
          this.pressProject === this.hoverProject
        )
          this.opts.onProject?.(this.pressProject);
        else if (this.openProject >= 0) this.opts.onProject?.(-1);
      }
      this.pressProject = -1;
      this.press = null;
      if (e.pointerType !== "mouse") this.pointer.has = false;
      return;
    }
    if (
      this.started &&
      !this.held &&
      e.pointerType !== "mouse" &&
      Math.abs(dy) > 60 &&
      Math.abs(dy) > Math.abs(dx)
    )
      this.opts.onStep(dy < 0 ? 1 : -1);
    if (this.held) {
      this.held = false;
      this.rise();
    }
    this.press = null;
    this.canvas.classList.remove("held");
    if (e.pointerType !== "mouse") this.pointer.has = false;
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
  private readonly onVisibility = () =>
    sound.setVisible(document.visibilityState === "visible");
  private readonly onKey = (e: KeyboardEvent) => {
    sound.unlock();
    if (e.key === "Escape" && this.tengriOpen) this.setTengri(false);
    if (!this.started) {
      if (
        (e.key === "Enter" || e.key === " ") &&
        (e.target as HTMLElement | null)?.tagName !== "BUTTON"
      ) {
        e.preventDefault();
        this.start();
      }
      return;
    }
    if (["ArrowDown", "ArrowRight", "PageDown"].includes(e.key))
      this.opts.onStep(1);
    if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key))
      this.opts.onStep(-1);
    if (
      e.key === " " &&
      (e.target as HTMLElement | null)?.tagName !== "BUTTON"
    ) {
      e.preventDefault();
      if (!this.introDone) return;
      this.held = !this.held;
      if (this.held) this.drop();
      else this.rise();
    }
  };

  private bind() {
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onMove);
    document.addEventListener("pointerleave", this.onLeave);
    this.canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pointerdown", this.onAnyPress);
  }
  private unbind() {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onMove);
    document.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pointerdown", this.onAnyPress);
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
    if (this.sequence.length > 1 && !this.held && this.flightT < 0) {
      this.seqTimer += dt;
      if (this.seqTimer > 4.2 && this.field.settled) {
        this.seqTimer = 0;
        this.seqIndex = (this.seqIndex + 1) % this.sequence.length;
        this.assign(this.sequence[this.seqIndex]);
        sound.whoosh(1.6, 0.7);
        this.swept = false;
      }
    }
    if (!this.swept && this.field.settled) {
      this.swept = true;
      this.sweep = 1;
    }
    if (this.started && this.field.settled) this.introDone = true;
    this.sweep = Math.max(0, this.sweep - dt / 1.4);

    if (this.pointer.has) {
      this.ray.setFromCamera(this.ndc, this.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.pointer.x = this.hit.x;
        this.pointer.y = this.hit.y;
      }
    }
    if (this.strikeT >= 0) this.strike(dt);
    else if (this.sinkT >= 0) this.sink(dt);
    else this.uni.uGate.value *= Math.exp(-dt * 3);
    if (this.wave.value.z >= 0 && this.wave.value.z < 10)
      this.wave.value.z += dt;
    this.physics?.step(dt);
    this.field.step(dt * 0.5, this.time, this.pointer);
    this.field.step(dt * 0.5, this.time, this.pointer);

    /* write instances */
    const stones = this.field.stones;
    let nl = 0,
      ns = 0;
    stones.forEach((st, i) => {
      const sp = st.spot;
      const w = st.size.x || 1,
        h = st.size.y || 1,
        d = st.size.z || 1;
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
        this.m2.compose(
          st.p,
          this.q,
          this.s.set((k * w) / sp.w, (k * h) / sp.h, (k * d) / sp.d),
        );
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
    this.aHome.needsUpdate =
      this.aSize.needsUpdate =
      this.aMisc.needsUpdate =
        true;
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
    /* over Derinkuyu's shaft the pointer's light is held down into it, a lamp to see the walls by */
    if (this.derinView > 0.5) this.lamp.position.copy(this.torch);
    else this.lamp.position.set(this.pointer.x, this.pointer.y, 1.4);
    this.lamp.intensity +=
      ((this.pointer.has ? 1.8 * PI : 0) - this.lamp.intensity) *
      Math.min(1, dt * 5);

    /*
     * camera: a slight three-quarter view that looks where the pointer goes (up towards the sky, out to the sides),
     * easing after it, with only a little sway of its own, plus a little shake when stones land
     */
    this.field.shake = Math.max(0, this.field.shake - dt * 0.5);
    const shake = this.field.shake,
      par = this.reduced ? 0 : 1;
    /* in the projects scene the gaze leans up, towards the constellations */
    /* and the pointer only nudges it there, so the constellations hold still enough to be aimed at */
    if (this.lookUp)
      this.gazeWant.set(this.ndc.x * 0.25, 1.95 + this.ndc.y * 0.25);
    else this.gazeWant.copy(this.ndc);
    this.gaze.lerp(this.gazeWant, Math.min(1, dt * 3));
    /* the landing jolts, sprung back */
    this.kickV.addScaledVector(this.kick, -160 * dt).multiplyScalar(Math.max(0, 1 - 9 * dt));
    this.kick.addScaledVector(this.kickV, dt);
    this.camera.position.set(
      /* the shake is a smooth wobble, not a fresh random jolt every frame, so the far sky doesn't flicker */
      this.camBase.x +
        this.gaze.x * 0.6 * par +
        Math.sin(this.time * 41) * shake * 0.5 +
        this.kick.x,
      this.camBase.y +
        this.gaze.y * 0.25 * par +
        Math.sin(this.time * 53 + 1.7) * shake * 0.5 +
        this.kick.y,
      this.camBase.z,
    );
    /* with a project open it turns to that constellation instead */
    const focus = this.focusDir ?? (this.sky.leaving() ? this.lastFocus : null);
    if (focus)
      this.lookWant.copy(this.camera.position).addScaledVector(focus, 14);
    else
      this.lookWant.set(
        this.look.x + this.gaze.x * 1.6 * par,
        this.look.y + this.gaze.y * 2.6 * par,
        this.look.z,
      );
    this.lookCur.lerp(this.lookWant, Math.min(1, dt * (focus ? 2.2 : 6)));
    this.camera.lookAt(this.lookCur);
    /* flying to another place: up a little, the gaze dropping to the ground running by ahead, banking, then down */
    this.flight(dt);
    if (this.flightT >= 0) {
      this.basePos.copy(this.camera.position);
      this.baseLook.copy(this.lookCur);
      this.drone(this.flightT);
    }
    /* over Derinkuyu: the view goes over to the shaft's mouth and looks down it */
    this.derinView += ((this.started && this.site === "derinkuyu" ? 1 : 0) - this.derinView) * Math.min(1, dt * 1.3);
    if (this.derinView > 0.001) {
      const f = this.derinView * this.derinView * (3 - 2 * this.derinView);
      const v = this.derin.view(this.gaze, -this.hh * 0.96);
      this.camera.position.lerp(v.pos, f).add(this.tmpKick.set(this.kick.x, this.kick.y, 0).multiplyScalar(f * 0.5));
      this.camera.lookAt(this.tmpLook.copy(this.lookCur).lerp(v.look, f));
      /* the light held down into the shaft, where the pointer points, at the second level's height */
      this.camera.updateMatrixWorld();
      this.ray.setFromCamera(this.ndc, this.camera);
      this.level.constant = this.hh * 0.96 + 3;
      if (this.ray.ray.intersectPlane(this.level, this.torch)) {
        this.torch.x = THREE.MathUtils.clamp(this.torch.x, DERIN.SX - DERIN.A + 0.3, DERIN.SX + DERIN.A - 0.3);
        this.torch.z = THREE.MathUtils.clamp(this.torch.z, DERIN.SZ - DERIN.A + 0.3, DERIN.SZ + DERIN.A - 0.3);
      }
    }
    /* and leans in on an open nebula */
    const fov =
      this.baseFov *
      (1 - 0.3 * THREE.MathUtils.smoothstep(this.sky.opened(), 0, 1));
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.monuments.forEach((m) => m.update(dt, this.hh, this.camera, this.ndc, this.pointer.has, this.reduced));
    this.derin.update(dt, -this.hh * 0.96, this.camera, this.ndc, this.pointer.has, this.reduced);
    this.shaft.value.w = this.derin.group.visible ? 1 : 0;
    this.realmT = THREE.MathUtils.clamp(
      this.realmT + (this.realmWant ? dt : -dt) / 1.6,
      0,
      1,
    );
    const there = this.realmT >= 0.5;
    this.hoverProject =
      this.started && this.pointer.has && !there && this.time > this.skyQuietUntil
        ? this.sky.pick(this.ray.ray.direction)
        : -1;
    /* Teŋri's word, when no project is under the pointer */
    this.tengriHover =
      this.hoverProject < 0 && this.started && this.pointer.has && !there && !this.tengriOpen && this.time > this.skyQuietUntil
        ? this.sky.pickTengri(this.ray.ray.direction)
        : false;
    this.sky.hoverTengri(this.tengriHover);
    this.canvas.classList.toggle("pick", this.hoverProject >= 0 || this.tengriHover);
    this.sky.hover(this.hoverProject);
    if (there) this.canvas.classList.toggle("pick", this.pointer.has && !!this.realm.hit(this.ndc));
    /* at a wall the sky is not seen: it is not worked on either */
    if (!there)
      this.sky.update(
        dt,
        this.camera,
        this.pointer.has ? this.ray.ray.direction : null,
      );
    /* the crossing: the light swells to white and falls away on the other side */
    const flash = Math.max(0, 1 - Math.abs(this.realmT - 0.5) * 2.2);
    this.canvas.style.filter =
      flash > 0.002
        ? `brightness(${1 + flash ** 2 * 9}) saturate(${1 - flash * 0.6})`
        : "";
    if (there) {
      if (!this.wasThere) this.realm.enter(this.realmProject);
      this.realm.update(dt, this.ndc, this.time);
      this.renderer.render(this.realm.scene, this.realm.camera);
    } else this.renderer.render(this.scene, this.camera);
    this.wasThere = there;
  };
}
