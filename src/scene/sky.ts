import * as THREE from 'three';
import { NOISE3 } from './glsl';
import { GLYPHS, RUNE_FONT } from './textures';

/*
 * The night sky: a dark dome that meets the fog at the horizon, faint stars in two layers, a whisper of the Milky Way,
 * a shooting star now and then, and four constellations that write 𐱅𐰭𐰼𐰃, Teŋri, the sky god, across the sky in
 * Orkhon letters, right to left. Their shapes come from the letters of the Old Turkic font; the constellations
 * themselves are this site's invention. They are always faintly drawn in rune light; bring the pointer near one and
 * it lights up. At the very top, seen only when looking up, the crescent and star of the Turkish flag. The sky holds still.
 */

const R = 70;
/*
 * runes for the constellations, and where they hang: azimuth (0 = straight ahead, +right) and elevation, in degrees.
 * The camera sees only about 11° above the horizon on a wide screen, so they hang low; and it looks about 6.5° to the
 * left of straight ahead (its three-quarter view), so the word is centred there.
 */
const CONSTELLATIONS: { glyph: number; az: number; el: number; size: number }[] = [
  { glyph: 0x45, az: 12.5, el: 6.4, size: 5.4 },
  { glyph: 0x2d, az: 0, el: 7.2, size: 5 },
  { glyph: 0x3c, az: -13, el: 6.9, size: 5.2 },
  { glyph: 0x03, az: -25.5, el: 6.2, size: 5 },
];

const SKY_FRAG = /* glsl */ `
${NOISE3}
uniform float uTime; uniform vec3 uBandN; uniform vec3 uCore;
varying vec3 vDir;
float starLayer(vec3 d, float scale, float density, float size) {
  vec3 p = d * scale, c = floor(p);
  float h = h3(c);
  vec3 o = vec3(h3(c + 11.), h3(c + 23.), h3(c + 37.)) * .7 + .15;
  float dist = length(p - c - o);
  /* never smaller than a pixel, or a star blinks as the camera moves; a star drawn bigger is dimmed to match */
  float px = (fwidth(p.x) + fwidth(p.y)) * .5;
  float r = max(size, px * .9);
  float s = smoothstep(r + px * .5, r * .3, dist) * step(1. - density, h) * min(1., (size / r) * (size / r) * 2.6);
  return s * (.3 + .7 * fract(h * 17.));
}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  /* deep night, a little less dark towards the horizon where it meets the fog */
  vec3 col = mix(vec3(.014, .016, .021), vec3(.003, .0035, .006), smoothstep(-.06, .25, el));
  /* the Milky Way, corner to corner across the sky: violet dusty clouds, a warmer glow towards its core low on the right,
     dark lanes of dust down its middle, and a wide faint haze around it all; it wanders a little, as the real one does */
  float bd = dot(d, uBandN) + (fbm3(d * 3. + 2.) - .5) * .08;
  float band = exp(-pow(bd / .15, 2.)), haze = exp(-pow(bd / .32, 2.));
  float core = pow(max(dot(d, uCore), 0.), 30.);
  float clouds = fbm3(d * 7.) * .6 + fbm3(d * 19. + 3.) * .4;
  float lanes = smoothstep(.47, .7, fbm3(d * 11. + 9.)) * exp(-pow(bd / .06, 2.));
  vec3 tint = mix(vec3(.017, .015, .03), vec3(.04, .028, .03), min(1., core * 1.3));
  vec3 mw = tint * (band * smoothstep(.3, .75, clouds) * 1.1 + haze * .15) * (1. + core * 1.2) * (1. - lanes * .75);
  col += mw * smoothstep(-.06, .08, el);
  /* stars: many faint ones, fewer brighter ones, and a dense dust of tiny ones along the band; none down in the haze */
  float stars = starLayer(d, 260., .05 + band * .2, .07) * .45 + starLayer(d, 520., band * .35 * (1. - lanes), .07) * .4
              + starLayer(d, 90., .03, .06) * .9;
  col += vec3(.85, .88, 1.) * stars * smoothstep(-.07, .03, el);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * A rune as a constellation that follows its real strokes: the letter is drawn with the Old Turkic font, thinned to a
 * one-pixel skeleton (Zhang-Suen), and the skeleton traced into strokes; stars go at the stroke ends, joints and bends,
 * lines along the strokes. Points are in about unit size, centred, y up.
 */
function runeGraph(glyph: string) {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#fff';
  c.font = `${S * 0.78}px ${RUNE_FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(glyph, S / 2, S / 2);
  const img = c.getImageData(0, 0, S, S).data;
  const on = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) on[i] = img[i * 4 + 3] > 110 ? 1 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : on[y * S + x]);
  /* Zhang-Suen thinning */
  const N = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const kill: number[] = [];
      for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
        if (!on[y * S + x]) continue;
        const v = N.map(([dx, dy]) => at(x + dx, y + dy));
        const b = v.reduce((a, q) => a + q, 0);
        let t = 0;
        for (let k = 0; k < 8; k++) if (!v[k] && v[(k + 1) % 8]) t++;
        const [p2, , p4, , p6, , p8] = v;
        const ok = pass === 0 ? !(p2 && p4 && p6) && !(p4 && p6 && p8) : !(p2 && p4 && p8) && !(p2 && p6 && p8);
        if (b >= 2 && b <= 6 && t === 1 && ok) kill.push(y * S + x);
      }
      for (const i of kill) on[i] = 0;
      if (kill.length) changed = true;
    }
  }
  /* trace the skeleton: nodes are ends and joints, strokes run between them */
  const nb = (i: number) => N.map(([dx, dy]) => (i % S + dx) + (Math.floor(i / S) + dy) * S)
    .filter((j) => j >= 0 && j < S * S && Math.abs((j % S) - (i % S)) <= 1 && on[j]);
  const pix: number[] = [];
  for (let i = 0; i < S * S; i++) if (on[i]) pix.push(i);
  const isNode = (i: number) => nb(i).length !== 2;
  const seen = new Set<string>(), strokes: number[][] = [], covered = new Set<number>();
  const walk = (from: number, next: number) => {
    const path = [from];
    let prev = from, cur = next;
    while (true) {
      path.push(cur);
      if (isNode(cur) || cur === from) break;
      const n = nb(cur).filter((j) => j !== prev);
      if (!n.length) break;
      prev = cur; cur = n[0];
    }
    const key = [Math.min(path[0], path[path.length - 1]), Math.max(path[0], path[path.length - 1]), path[1]].join();
    const back = [Math.min(path[0], path[path.length - 1]), Math.max(path[0], path[path.length - 1]), path[path.length - 2]].join();
    if (seen.has(key) || seen.has(back)) return;
    seen.add(key);
    for (const i of path) covered.add(i);
    strokes.push(path);
  };
  for (const i of pix) if (isNode(i)) for (const j of nb(i)) walk(i, j);
  /* closed loops have no ends or joints: start them anywhere */
  for (const i of pix) if (!covered.has(i) && nb(i).length === 2) walk(i, nb(i)[0]);
  /* simplify each stroke to its bends (Douglas-Peucker), so stars sit at the corners */
  const xy = (i: number): [number, number] => [i % S, Math.floor(i / S)];
  const simplify = (p: [number, number][], eps: number): [number, number][] => {
    if (p.length < 3) return p;
    const [a, b] = [p[0], p[p.length - 1]];
    let far = 0, fd = 0;
    for (let k = 1; k < p.length - 1; k++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[k][1]) - (a[0] - p[k][0]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
      if (d > fd) { fd = d; far = k; }
    }
    return fd > eps ? [...simplify(p.slice(0, far + 1), eps).slice(0, -1), ...simplify(p.slice(far), eps)] : [a, b];
  };
  const pts: [number, number][] = [], lines: [number, number][] = [];
  /* nearby points (a joint is a few pixels wide) become one star */
  const star = ([x, y]: [number, number]) => {
    const k = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 7);
    if (k >= 0) return k;
    pts.push([x, y]);
    return pts.length - 1;
  };
  for (const s of strokes) {
    if (s.length < 4) continue;
    /* long straight runs get stars along them too, so each stroke reads as a line of stars */
    const bends = simplify(s.map(xy), 3.2), run: [number, number][] = [bends[0]];
    for (let k = 1; k < bends.length; k++) {
      const [a, b] = [bends[k - 1], bends[k]], n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 22);
      for (let m = 1; m <= n; m++) run.push([a[0] + ((b[0] - a[0]) * m) / (n + 1), a[1] + ((b[1] - a[1]) * m) / (n + 1)]);
      run.push(b);
    }
    const ids = run.map(star);
    for (let k = 1; k < ids.length; k++) if (ids[k] !== ids[k - 1]) lines.push([ids[k - 1], ids[k]]);
  }
  return { pts: pts.map(([x, y]) => [x / S - 0.5, 0.5 - y / S] as [number, number]), lines };
}

/**
 * The crescent and star of the Turkish flag, as a constellation: points along the outlines and the lines between them,
 * in the flag law's proportions (outer circle 1/2, inner circle 2/5 offset 1/16, star circle 1/4 of the flag's height),
 * opening to the right, about unit size, centred.
 */
function crescentAndStar() {
  const pts: [number, number][] = [], lines: [number, number][] = [], dots: number[] = [];
  /* lines run through every point, so curves are smooth; stars sit only on every `every`-th point */
  const add = (path: [number, number][], closed: boolean, every: number) => {
    const base = pts.length;
    pts.push(...path);
    for (let i = 1; i < path.length; i++) lines.push([base + i - 1, base + i]);
    if (closed) lines.push([base + path.length - 1, base]);
    path.forEach((_, i) => { if (i % every === 0) dots.push(base + i); });
  };
  /* the crescent: the outer circle's arc round the left, then the inner circle's arc back */
  const r1 = 0.25, cx2 = 0.0625, r2 = 0.2;
  const ix = (r1 * r1 - r2 * r2 + cx2 * cx2) / (2 * cx2), iy = Math.sqrt(r1 * r1 - ix * ix);
  const a1 = Math.atan2(iy, ix), a2 = Math.atan2(iy, ix - cx2), crescent: [number, number][] = [];
  for (let k = 0; k <= 48; k++) { const a = a1 + ((Math.PI * 2 - 2 * a1) * k) / 48; crescent.push([Math.cos(a) * r1, Math.sin(a) * r1]); }
  for (let k = 39; k >= 1; k--) { const a = a2 + ((Math.PI * 2 - 2 * a2) * k) / 40; crescent.push([cx2 + Math.cos(a) * r2, Math.sin(a) * r2]); }
  add(crescent, true, 5);
  /* the star: five points, one aimed back at the crescent */
  const sx = cx2 + r2 + 0.0833 + 0.125 * 0.62, sr = 0.125, star: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI + (k * Math.PI) / 5, r = k % 2 ? sr * 0.382 : sr;
    star.push([sx + Math.cos(a) * r, Math.sin(a) * r]);
  }
  add(star, true, 1);
  const mid = (-r1 + sx + sr) / 2;
  return { pts: pts.map(([x, y]) => [(x - mid) * 2, y * 2] as [number, number]), lines, dots };
}

/** A direction on the sky from azimuth and elevation in degrees, `x`, `y` offsets in the plane facing it. */
function onSky(az: number, el: number, x = 0, y = 0) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  const fwd = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  const right = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const up = new THREE.Vector3().crossVectors(right, fwd);
  return fwd.addScaledVector(right, x).addScaledVector(up, y).normalize();
}

/** A project's constellation in the upper sky, to click: its initial rune, where it hangs, and the name it writes. */
export type SkyProject = { glyph: number; az: number; el: number; name: string; logo?: string };

/** Sample a word into points (about unit height, centred), for writing it in stars. */
function wordPoints(word: string) {
  const H = 64, cv = document.createElement('canvas'), c = cv.getContext('2d', { willReadFrequently: true })!;
  const font = `800 ${H}px "Inter Tight", sans-serif`;
  c.font = font;
  c.letterSpacing = `${H * 0.12}px`;
  cv.width = Math.ceil(c.measureText(word).width) + 16;
  cv.height = H + 16;
  c.font = font;
  c.letterSpacing = `${H * 0.12}px`;
  c.fillStyle = '#fff';
  c.textBaseline = 'middle';
  c.fillText(word, 8, cv.height / 2);
  const img = c.getImageData(0, 0, cv.width, cv.height).data, pts: [number, number][] = [];
  for (let y = 0; y < cv.height; y += 5) for (let x = (y / 5) % 2 ? 2 : 0; x < cv.width; x += 5) {
    if (img[(y * cv.width + x) * 4 + 3] > 140) pts.push([(x - cv.width / 2) / H, (cv.height / 2 - y) / H]);
  }
  return pts;
}

/**
 * Sample a logo's outline into points (about unit height, centred): the edge of its opaque shape, one point per
 * small cell so the outline reads as an even line of stars. Loaded once per logo.
 */
const logoCache = new Map<string, Promise<[number, number][]>>();
function logoPoints(url: string) {
  let p = logoCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const H = 120, W = Math.round((img.width / img.height) * H) || H;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const c = cv.getContext('2d', { willReadFrequently: true })!;
        c.drawImage(img, 0, 0, W, H);
        const a = c.getImageData(0, 0, W, H).data, on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] > 128;
        const cell = 4, taken = new Set<number>(), pts: [number, number][] = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!on(x, y) || (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1))) continue;
          const k = Math.floor(x / cell) + Math.floor(y / cell) * 1000;
          if (taken.has(k)) continue;
          taken.add(k);
          pts.push([(x - W / 2) / H, (H / 2 - y) / H]);
        }
        resolve(pts);
      };
      img.onerror = () => resolve([]);
      img.src = url;
    });
    logoCache.set(url, p);
  }
  return p;
}

export function createSky(uRune: { value: THREE.Color }, projects: SkyProject[] = []) {
  /* the Teŋri word first, then one constellation per project */
  const ALL = [
    ...CONSTELLATIONS.map((k) => ({ ...k, project: -1 })),
    ...projects.map((p, i) => ({ glyph: p.glyph, az: p.az, el: p.el, size: 4.6, project: i })),
  ];
  const N = ALL.length;
  const group = new THREE.Group();
  const uTime = { value: 0 };

  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      /* the band runs through these two points of the sky (upper left to lower right); its core is low on the right */
      uBandN: { value: new THREE.Vector3().crossVectors(onSky(-40, 26), onSky(32, -3)).normalize() },
      uCore: { value: onSky(16, 3) },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  }));
  dome.renderOrder = -10;
  group.add(dome);

  /* the constellations (drawn in the transparent pass, so they test depth and stay behind the stones): their stars as points, their letters as lines, each lit by how near the pointer is */
  const lit = ALL.map(() => ({ value: 0 }));
  /* the constellation opened, if any: it shines, the rest dim */
  let focused = -1;
  const uDim = { value: 0 };
  /* the constellations stay hidden until the visitor begins, then fade in */
  const uShow = { value: 0 };
  let showTarget = 0;
  const centres = ALL.map((k) => onSky(k.az, k.el));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uShow, uDim, uFocus: { value: -1 }, uLit: { value: lit.map((l) => l.value) } },
    vertexShader: /* glsl */ `
      attribute float aK; uniform float uLit[${N}]; uniform float uFocus; uniform float uDim;
      varying float vLit;
      void main() {
        vLit = uLit[int(aK)] * (abs(aK - uFocus) < .5 ? 1. : 1. - uDim);
        gl_PointSize = 5. + vLit * 3.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRune; uniform float uShow; uniform float uDim; varying float vLit;
      void main() {
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5, .05, d) * (.8 + vLit * .2) * uShow * (1. - uDim * .55 * (1. - vLit));
        gl_FragColor = vec4(mix(vec3(.92, .95, 1.), uRune * 1.4 + .35, .35 + vLit * .65) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uShow, uDim, uFocus: starMat.uniforms.uFocus, uLit: starMat.uniforms.uLit },
    vertexShader: `attribute float aK; uniform float uLit[${N}]; uniform float uFocus; uniform float uDim; varying float vLit; varying float vMine;
      void main() { vMine = abs(aK - uFocus) < .5 ? 1. : 0.; vLit = uLit[int(aK)] * (vMine > .5 ? 1. : 1. - uDim); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    /* always faintly drawn, bright when lit; while one is open the others fade */
    fragmentShader: 'uniform vec3 uRune; uniform float uShow; uniform float uDim; varying float vLit; varying float vMine; void main() { float a = (.42 + vLit * .58) * uShow * mix(1. - uDim * .7, 1., vMine); gl_FragColor = vec4(uRune * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const stars = new THREE.Points(new THREE.BufferGeometry(), starMat);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  stars.renderOrder = lines.renderOrder = -9;
  group.add(stars, lines);

  /* at the very top of the sky the camera can look up to, the crescent and star, in faint white starlight: there to be
     found, not to stand out */
  const FLAG = { az: -6.5, el: 15.5, size: 6 };
  const flagLit = { value: 0 };
  const flagCentre = onSky(FLAG.az, FLAG.el);
  const flagPointMat = new THREE.ShaderMaterial({
    uniforms: { uShow, uLit: flagLit },
    vertexShader: 'uniform float uLit; void main() { gl_PointSize = 3. + uLit * 1.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uShow; uniform float uLit; void main() { float a = smoothstep(.5, .05, length(gl_PointCoord - .5)) * (.4 + uLit * .3) * uShow; gl_FragColor = vec4(vec3(1., .97, .95) * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const flagLineMat = new THREE.ShaderMaterial({
    uniforms: { uShow, uLit: flagLit },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uShow; uniform float uLit; void main() { float a = (.11 + uLit * .25) * uShow; gl_FragColor = vec4(vec3(1., .96, .94) * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  {
    const { pts, lines: fl, dots } = crescentAndStar(), scale = Math.tan(THREE.MathUtils.degToRad(FLAG.size));
    const at = pts.map(([x, y]) => onSky(FLAG.az, FLAG.el, x * scale, y * scale).multiplyScalar(R * 0.98));
    const pg = new THREE.BufferGeometry().setFromPoints(dots.map((i) => at[i]));
    const lg = new THREE.BufferGeometry().setFromPoints(fl.flatMap(([i, j]) => [at[i], at[j]]));
    const fp = new THREE.Points(pg, flagPointMat), fs = new THREE.LineSegments(lg, flagLineMat);
    fp.renderOrder = fs.renderOrder = -9;
    group.add(fp, fs);
  }

  /** Lay the constellations out again; call once the rune font has loaded, since the shapes come from it. */
  const build = () => {
    const sp: number[] = [], sk: number[] = [], lp: number[] = [], lk: number[] = [];
    ALL.forEach((k, ki) => {
      const { pts, lines: strokes } = runeGraph(GLYPHS[k.glyph]), scale = Math.tan(THREE.MathUtils.degToRad(k.size));
      const at = pts.map(([x, y]) => onSky(k.az, k.el, x * scale, y * scale).multiplyScalar(R * 0.98));
      at.forEach((v) => { sp.push(v.x, v.y, v.z); sk.push(ki); });
      for (const [i, j] of strokes) { lp.push(at[i].x, at[i].y, at[i].z, at[j].x, at[j].y, at[j].z); lk.push(ki, ki); }
    });
    stars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    stars.geometry.setAttribute('aK', new THREE.Float32BufferAttribute(sk, 1));
    lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lines.geometry.setAttribute('aK', new THREE.Float32BufferAttribute(lk, 1));
  };
  build();

  /* a shooting star: a short bright streak, now and then */
  const meteorGeo = new THREE.BufferGeometry();
  meteorGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  meteorGeo.setAttribute('aT', new THREE.Float32BufferAttribute([0, 1], 1));
  const meteorMat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 } },
    vertexShader: 'attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uFade; varying float vT; void main() { float a = vT * vT * uFade; gl_FragColor = vec4(vec3(.9, .95, 1.) * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const meteor = new THREE.Line(meteorGeo, meteorMat);
  meteor.renderOrder = -9;
  group.add(meteor);
  let meteorT = -1, meteorNext = 20 + Math.random() * 30;
  const mFrom = new THREE.Vector3(), mDir = new THREE.Vector3();

  /* a project's name, written in stars that fly out of its constellation and settle beneath it */
  const nameMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uT: { value: 0 }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aFrom; attribute float aDelay; uniform float uT; varying float vK;
      void main() {
        float k = clamp((uT - aDelay) / 1.1, 0., 1.);
        vK = k;
        k = k * k * (3. - 2. * k);
        vec3 p = mix(aFrom, position, k) + normalize(position) * sin(k * 3.14159) * -1.2;
        gl_PointSize = 2.6 + (1. - k) * 2.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: 'uniform vec3 uRune; uniform float uFade; varying float vK; void main() { float a = smoothstep(.5, .05, length(gl_PointCoord - .5)) * uFade * (.35 + vK * .65); gl_FragColor = vec4(mix(uRune * 1.5 + .2, vec3(1., .98, .95), vK) * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const nameStars = new THREE.Points(new THREE.BufferGeometry(), nameMat);
  nameStars.renderOrder = -9;
  nameStars.frustumCulled = false;
  group.add(nameStars);
  let nameTarget = 0;
  const writeName = async (ki: number) => {
    const k = ALL[ki], project = projects[k.project], word = project?.name ?? '';
    /* a logo's outline if it has one (drawn larger), else its name */
    const logo = project?.logo ? await logoPoints(project.logo) : [];
    if (focused !== ki) return;
    const shape = logo.length ? logo : wordPoints(word), height = logo.length ? 4.2 : 2.1;
    const from = (stars.geometry.attributes.position?.array ?? []) as ArrayLike<number>;
    const aK = stars.geometry.attributes.aK?.array as ArrayLike<number> | undefined;
    const mine: THREE.Vector3[] = [];
    if (aK) for (let i = 0; i < aK.length; i++) if (aK[i] === ki) mine.push(new THREE.Vector3(from[i * 3], from[i * 3 + 1], from[i * 3 + 2]));
    const scale = Math.tan(THREE.MathUtils.degToRad(height)), to: number[] = [], fr: number[] = [], dl: number[] = [];
    shape.forEach(([x, y], i) => {
      const v = onSky(k.az, k.el - k.size * 0.5 - height * 0.62, x * scale, y * scale).multiplyScalar(R * 0.975);
      const f = mine.length ? mine[i % mine.length] : v;
      to.push(v.x, v.y, v.z); fr.push(f.x, f.y, f.z); dl.push((x + 3) * 0.12 + Math.random() * 0.25);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(to, 3));
    g.setAttribute('aFrom', new THREE.Float32BufferAttribute(fr, 3));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(dl, 1));
    nameStars.geometry.dispose();
    nameStars.geometry = g;
    nameMat.uniforms.uT.value = 0;
  };

  const ray = new THREE.Vector3(), world = new THREE.Vector3();
  /** Keep the sky around the camera, turn it, light the constellations near `pointerDir` (null when no pointer). */
  const update = (dt: number, camera: THREE.Camera, pointerDir: THREE.Vector3 | null) => {
    uTime.value += dt;
    uShow.value += (showTarget - uShow.value) * Math.min(1, dt * 0.6);
    group.position.copy(camera.position);
    {
      const near = pointerDir ? THREE.MathUtils.smoothstep(ray.copy(pointerDir).dot(flagCentre), Math.cos(0.14), Math.cos(0.06)) : 0;
      flagLit.value += (near - flagLit.value) * Math.min(1, dt * (near > flagLit.value ? 3 : 0.8));
    }
    centres.forEach((c, i) => {
      world.copy(c);
      const near = pointerDir ? THREE.MathUtils.smoothstep(ray.copy(pointerDir).dot(world), Math.cos(0.11), Math.cos(0.05)) : 0;
      const want = i === focused ? 1 : near;
      lit[i].value += (want - lit[i].value) * Math.min(1, dt * (want > lit[i].value ? 3 : 0.8));
      starMat.uniforms.uLit.value[i] = lit[i].value;
    });
    uDim.value += ((focused >= 0 ? 1 : 0) - uDim.value) * Math.min(1, dt * 2);
    nameMat.uniforms.uT.value += dt;
    nameMat.uniforms.uFade.value += (nameTarget - nameMat.uniforms.uFade.value) * Math.min(1, dt * (nameTarget ? 2 : 4));
    /* shooting star */
    meteorNext -= dt;
    if (meteorNext <= 0 && meteorT < 0) {
      meteorT = 0;
      meteorNext = 35 + Math.random() * 50;
      mFrom.copy(onSky(-22 + Math.random() * 44, 7 + Math.random() * 4)).multiplyScalar(R * 0.97);
      mDir.set(Math.random() < 0.5 ? -1 : 1, -0.25 - Math.random() * 0.2, 0).normalize();
    }
    if (meteorT >= 0) {
      meteorT += dt / 0.9;
      const head = mFrom.clone().addScaledVector(mDir, meteorT * 9), tail = head.clone().addScaledVector(mDir, -3);
      const p = meteorGeo.attributes.position as THREE.BufferAttribute;
      p.setXYZ(0, tail.x, tail.y, tail.z); p.setXYZ(1, head.x, head.y, head.z); p.needsUpdate = true;
      meteorMat.uniforms.uFade.value = Math.sin(Math.min(1, meteorT) * Math.PI) * 0.9;
      if (meteorT >= 1) { meteorT = -1; meteorMat.uniforms.uFade.value = 0; }
    }
  };

  /** The project whose constellation is under `pointerDir`, or -1. */
  const pick = (pointerDir: THREE.Vector3 | null) => {
    if (!pointerDir || uShow.value < 0.5) return -1;
    let best = -1, bestDot = Math.cos(0.075);
    ALL.forEach((k, i) => {
      if (k.project < 0) return;
      const d = pointerDir.dot(centres[i]);
      if (d > bestDot) { bestDot = d; best = k.project; }
    });
    return best;
  };

  /** Open a project's constellation (it shines and writes its name; the rest dim), or close it with -1. */
  const focus = (project: number) => {
    focused = project < 0 ? -1 : ALL.findIndex((k) => k.project === project);
    starMat.uniforms.uFocus.value = focused;
    if (focused >= 0) { void writeName(focused); nameTarget = 1; } else nameTarget = 0;
  };

  /** Where to look to see a project's constellation and the name under it. */
  const gazeAt = (project: number) => {
    const k = ALL.find((c) => c.project === project);
    /* a little to the right of it, so it sits left of the panel that opens on the right */
    return k ? onSky(k.az + 8, k.el - k.size * 0.55) : null;
  };

  return { group, update, rebuild: build, show: () => { showTarget = 1; }, pick, focus, gazeAt };
}
