import * as THREE from 'three';
import { createLito } from './lito';
import { createRuneLogo } from './runeLogo';
import { NEIGHBOURS, thin } from './skeleton';
import { NOISE3 } from './glsl';
import { GLYPHS, RUNE_FONT } from './textures';
import { createStory, type Story } from './tengri';

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
 * Teŋri hangs above everything, over the projects and the crescent and star, seen when the view leans up to the sky:
 * its letters side by side as one word, read right to left as in the inscriptions, centred over the crescent (the
 * camera looks about 6.5° to the left of straight ahead, its three-quarter view).
 */
const CONSTELLATIONS: { glyph: number; az: number; el: number; size: number }[] = [
  { glyph: 0x45, az: 2.2, el: 22.8, size: 5 },
  { glyph: 0x2d, az: -3.6, el: 22.8, size: 5 },
  { glyph: 0x3c, az: -9.4, el: 22.8, size: 5 },
  { glyph: 0x03, az: -15.2, el: 22.8, size: 5 },
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
  /* deep night, a little less dark towards the horizon; and down at the horizon the haze the ground fades into */
  vec3 col = mix(vec3(.014, .016, .021), vec3(.003, .0035, .006), smoothstep(-.06, .25, el));
  col = mix(col, vec3(.021, .023, .032), exp(-max(el, 0.) * 9.) * smoothstep(-.12, -.02, el) + (1. - smoothstep(-.12, -.02, el)));
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
  col += vec3(.85, .88, 1.) * stars * smoothstep(.0, .14, el);
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
  thin(on, S, S);
  const N = NEIGHBOURS;
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
export type SkyProject = { glyph: number; az: number; el: number; name: string; logo?: string; color?: string; face?: 'lito' };

/*
 * a nebula: soft, uneven cloud of colour, brighter in the middle and fading out to nothing at the edge. Opened
 * (uOpen), it swells and thickens, and the project's logo condenses out of it from the middle outwards, a glowing
 * silhouette with its own light where the logo is bright (a face on a screen) and a halo around it
 */
const NEBULA_FRAG = /* glsl */ `
${NOISE3}
uniform vec3 uColor; uniform float uLit; uniform float uShow; uniform float uTime;
uniform float uOpen; uniform float uFade; uniform sampler2D uLogo; uniform float uAspect; uniform float uHasLogo; uniform float uSeed;
varying vec2 vUv;
float logoA(vec2 lp) { return all(greaterThan(lp, vec2(0.))) && all(lessThan(lp, vec2(1.))) ? texture2D(uLogo, lp).a : 0.; }
void main() {
  vec2 p = vUv * 2. - 1.;
  float r = length(p);
  /* each cloud its own (uSeed): turned and drawn out its own way, its own grain and twist, some soft and puffed,
     some drawn into filaments, some crossed by dark lanes of dust, the brightest part off the middle */
  float ang = uSeed * 1.7;
  vec2 sp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p * vec2(1. + .3 * fract(uSeed * .37), 1. - .2 * fract(uSeed * .61));
  float r2 = length(sp);
  vec3 q = vec3(sp * (1.7 + 1.1 * fract(uSeed * .53)), uTime * .02 + uSeed * 9.);
  float n = fbm3(q + fbm3(q * 1.7 + 3. + uSeed) * (.55 + .6 * fract(uSeed * .29)));
  n = mix(n, (1. - abs(2. * n - 1.)) * .9, step(.5, fract(uSeed * .71)) * .55);
  float lanes = smoothstep(.55, .78, fbm3(q * 2.3 + 7. + uSeed)) * step(.4, fract(uSeed * .43)) * .6;
  float wisps = smoothstep(.22 - uOpen * .08, .8, n) * (1. - smoothstep(.2, 1., r2)) * (1. - lanes);
  vec2 off = (vec2(fract(uSeed * .13), fract(uSeed * .19)) - .5) * .35;
  float core = exp(-dot(p - off, p - off) * (2.4 + 1.6 * fract(uSeed * .83)));
  float a = (wisps + core * (.45 - uOpen * .3)) * (.16 + uLit * .64) * uFade * uShow;
  vec3 col = mix(uColor * .6, uColor + .2, smoothstep(.45, .9, n));
  vec3 rgb = col * a * 1.05;

  /* the logo, about half the cloud, wavering like gas until it has fully formed */
  float reveal = smoothstep(.3, 1., uOpen);
  vec2 lp = (vUv - .5) / .48;
  lp.x /= uAspect;
  lp += .5 + (vec2(n, fbm3(q + 7.)) - .5) * .05 * (1. - reveal);
  vec4 L = texture2D(uLogo, lp);
  float body = logoA(lp);
  float halo = 0.;
  for (int i = 0; i < 12; i++) {
    float t = float(i) * .5236;
    halo += logoA(lp + vec2(cos(t), sin(t)) * (.025 + .02 * fract(float(i) * .618)));
  }
  halo /= 12.;
  float rr = length(lp - .5) * 1.3 + (n - .5) * .6;
  float show = clamp((reveal * 1.9 - .2 - rr) / .3, 0., 1.) * uHasLogo * uShow;
  float lum = dot(L.rgb, vec3(.3, .59, .11));
  float shimmer = .88 + .12 * sin(uTime * 1.7 + n * 9.);
  /* made of the same gas: patchy, thinner where the cloud is thin, brightest at its own light */
  float gas = .55 + .6 * smoothstep(.3, .8, fbm3(q * 2.5 + 11.));
  vec3 logoCol = mix(uColor, L.rgb, .7) * (.3 + lum * 1.6) * shimmer * gas;
  /* the cloud thins behind it, so what is dark in the logo (Lito's glass) reads dark */
  rgb *= 1. - body * show * .45;
  rgb += logoCol * body * show + uColor * halo * (1. - body) * show * .3;
  gl_FragColor = vec4(rgb, a + (body + halo * .5) * show);
}
`;

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
 * Sample a logo's outline into points (about unit height, centred): the edge of its opaque shape and any sharp change
 * of brightness inside it (a face on a screen, eyes), one point per small cell so the outline reads as an even line of
 * stars. Loaded once per logo.
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
        const lum = (x: number, y: number) => { const i = (y * W + x) * 4; return (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) / 255; };
        const edge = (x: number, y: number) => {
          if (!(on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1))) return true;
          const l = lum(x, y);
          return Math.abs(l - lum(x + 1, y)) > 0.3 || Math.abs(l - lum(x, y + 1)) > 0.3;
        };
        const cell = 4, taken = new Set<number>(), pts: [number, number][] = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!on(x, y) || !edge(x, y)) continue;
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
  /* the project under the pointer, the one last in play (its stars come back out of its cloud), and one being closed */
  let hovered = -1, lastActive = -1, closing = -1;
  const uDim = { value: 0 };
  /* the constellations stay hidden until the visitor begins, then fade in */
  const uShow = { value: 0 };
  let showTarget = 0;
  const centres = ALL.map((k) => onSky(k.az, k.el));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uShow, uDim, uFocus: { value: -1 }, uLit: { value: lit.map((l) => l.value) }, uTengri: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aK; uniform float uLit[${N}]; uniform float uFocus; uniform float uDim; uniform float uVanish; uniform float uTengri;
      varying float vLit; varying float vMelt;
      void main() {
        float mine = abs(aK - uFocus) < .5 || (aK < 3.5 && uTengri > .5) ? 1. : 0.;
        vLit = uLit[int(aK)] * (mine > .5 ? 1. : 1. - uDim);
        vMelt = mine * uVanish;
        gl_PointSize = 5. + vLit * 3.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRune; uniform float uShow; uniform float uDim; varying float vLit; varying float vMelt;
      void main() {
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5, .05, d) * (.8 + vLit * .2) * uShow * (1. - uDim * .55 * (1. - vLit)) * (1. - vMelt * .9);
        gl_FragColor = vec4(mix(vec3(.92, .95, 1.), uRune * 1.4 + .35, .35 + vLit * .65) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uShow, uDim, uFocus: starMat.uniforms.uFocus, uLit: starMat.uniforms.uLit, uTengri: starMat.uniforms.uTengri },
    vertexShader: `attribute float aK; uniform float uLit[${N}]; uniform float uFocus; uniform float uDim; uniform float uTengri; varying float vLit; varying float vMine;
      void main() { vMine = abs(aK - uFocus) < .5 || (aK < 3.5 && uTengri > .5) ? 1. : 0.; vLit = uLit[int(aK)] * (vMine > .5 ? 1. : 1. - uDim); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    /* always faintly drawn, bright when lit; while one is open the others fade */
    fragmentShader: 'uniform vec3 uRune; uniform float uShow; uniform float uDim; uniform float uVanish; varying float vLit; varying float vMine; void main() { float a = (.42 + vLit * .58) * uShow * mix(1. - uDim * .7, 1. - uVanish, vMine); gl_FragColor = vec4(uRune * a, a); }',
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
  const flagHide = { value: 0 };
  const flagCentre = onSky(FLAG.az, FLAG.el);
  const flagPointMat = new THREE.ShaderMaterial({
    uniforms: { uShow, uLit: flagLit, uHide: flagHide },
    vertexShader: 'uniform float uLit; void main() { gl_PointSize = 3. + uLit * 1.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uShow; uniform float uLit; uniform float uHide; void main() { float a = smoothstep(.5, .05, length(gl_PointCoord - .5)) * (.4 + uLit * .3) * uShow * (1. - uHide); gl_FragColor = vec4(vec3(1., .97, .95) * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const flagLineMat = new THREE.ShaderMaterial({
    uniforms: { uShow, uLit: flagLit, uHide: flagHide },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uShow; uniform float uLit; uniform float uHide; void main() { float a = (.11 + uLit * .25) * uShow * (1. - uHide); gl_FragColor = vec4(vec3(1., .96, .94) * a, a); }',
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

  /* Teŋri: the word under the pointer (its four letters light together), and opened, with its story written beneath */
  let tengriHover = false, tengriOpen = false;
  const STORY = { az: -6.5, el: 12.6, width: 31 };
  const story = createStory(2 * R * 0.96 * Math.tan(THREE.MathUtils.degToRad(STORY.width / 2)));
  story.mesh.position.copy(onSky(STORY.az, STORY.el)).multiplyScalar(R * 0.96);
  story.mesh.lookAt(0, 0, 0);
  group.add(story.mesh);

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

  /* behind each project with a colour of its own, a nebula of that colour, waking as the pointer comes near */
  const nebulae = projects.map((p, i) => {
    if (!p.color) return null;
    const ki = ALL.findIndex((k) => k.project === i), k = ALL[ki];
    const uniforms = {
      uColor: { value: new THREE.Color(p.color) }, uLit: { value: 0 }, uShow, uTime,
      uOpen: { value: 0 }, uFade: { value: 1 }, uSeed: { value: 1.3 + i * 3.17 }, uLogo: { value: null as THREE.Texture | null }, uAspect: { value: 1 }, uHasLogo: { value: 0 },
    };
    /* what comes alive in the nebula, drawn afresh every frame: Lito's face, or the logo written in letters */
    const face = p.face === 'lito' ? createLito() : p.logo ? createRuneLogo(p.logo, p.color) : null;
    if (face) { uniforms.uLogo.value = face.texture; uniforms.uHasLogo.value = 1; }
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: NEBULA_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    });
    const size = R * Math.tan(THREE.MathUtils.degToRad(k.size * 2));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.position.copy(onSky(k.az, k.el)).multiplyScalar(R * 0.99);
    mesh.lookAt(0, 0, 0);
    mesh.renderOrder = -9.5;
    group.add(mesh);
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    return { ki, mat, mesh, face, ax, ay, span: size / (R * 0.99), wanted: false };
  });
  const rel = new THREE.Vector2();
  /* while a nebula is open, its constellation melts into it */
  const uVanish = { value: 0 };
  starMat.uniforms.uVanish = uVanish;
  lineMat.uniforms.uVanish = uVanish;

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
      const want = i === focused || (i < 4 && (tengriOpen || tengriHover)) ? 1 : near;
      lit[i].value += (want - lit[i].value) * Math.min(1, dt * (want > lit[i].value ? 3 : 0.8));
      starMat.uniforms.uLit.value[i] = lit[i].value;
    });
    uDim.value += ((focused >= 0 || tengriOpen ? 1 : 0) - uDim.value) * Math.min(1, dt * 2);
    starMat.uniforms.uTengri.value = tengriOpen ? 1 : 0;
    flagHide.value += ((tengriOpen ? 1 : 0) - flagHide.value) * Math.min(1, dt * 2);
    story.update(dt);
    /* an open nebula takes about two seconds to swell and give up its logo, and closes quicker */
    uVanish.value = 0;
    /* the one in play: the open project, or else the one under the pointer; its stars melt into its cloud */
    const active = focused >= 0 ? focused : hovered;
    if (active >= 0) lastActive = active;
    starMat.uniforms.uFocus.value = lastActive;
    nebulae.forEach((n) => {
      if (!n) return;
      const u = n.mat.uniforms, want = n.ki === active ? 1 : 0;
      /* waking when the pointer comes onto it (or it is opened), saying goodbye when it goes */
      if (want && !n.wanted) n.face?.stay();
      if (!want && n.wanted) n.face?.farewell();
      n.wanted = !!want;
      /* a face saying goodbye holds its cloud open until it has gone */
      const hold = !want && !!n.face?.leaving();
      /* while another project is open, the other clouds fall back */
      u.uFade.value = want || hold ? 1 : 1 - uDim.value * 0.8;
      if (!hold) u.uOpen.value = want ? Math.min(1, u.uOpen.value + dt * 0.5) : Math.max(0, u.uOpen.value - dt * 0.9);
      const o = u.uOpen.value, e = o * o * (3 - 2 * o);
      u.uLit.value = Math.max(lit[n.ki].value, e);
      n.mesh.scale.setScalar(1 + e * 0.5);
      if (n.face) {
        if (o > 0) {
          /* where the pointer is across the face (the logo is .48 of the cloud, the head about .9 of the logo) */
          const half = 0.24 * n.span * (1 + e * 0.5);
          const p = pointerDir ? rel.set(pointerDir.dot(n.ax) / half, pointerDir.dot(n.ay) / half) : null;
          n.face.update(dt, p, !!p && want === 1 && p.length() < 0.85);
        } else n.face.reset();
      }
      uVanish.value = Math.max(uVanish.value, Math.min(1, o * 2));
    });
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
      /* an opened cloud is bigger than its stars: the pointer stays on it anywhere over its logo; and the one already
         under the pointer holds on a little further out, so its edge doesn't flicker on and off */
      const neb = nebulae.find((n) => n && n.ki === i);
      const reach = neb && neb.mat.uniforms.uOpen.value > 0.3 ? 0.13 : i === hovered ? 0.1 : 0.075;
      const d = pointerDir.dot(centres[i]);
      if (d > Math.max(bestDot, Math.cos(reach)) || (d > Math.cos(reach) && best < 0)) { bestDot = d; best = k.project; }
    });
    return best;
  };

  /** Whether the pointer is on Teŋri's word (any of its four letters). */
  const pickTengri = (pointerDir: THREE.Vector3 | null) => {
    if (!pointerDir || uShow.value < 0.5) return false;
    return centres.slice(0, 4).some((c) => pointerDir.dot(c) > Math.cos(tengriHover ? 0.075 : 0.06));
  };
  /** Teŋri under the pointer: its letters light together. */
  const hoverTengri = (on: boolean) => { tengriHover = on; };
  /** Open Teŋri (its story is written under it, the rest of the sky steps back), or close it. */
  const openTengri = (on: boolean) => { tengriOpen = on; story.open(on); };
  /** Where to look to see Teŋri and its story under it. */
  const gazeTengri = () => onSky(-6.5, 16.8);
  /** Teŋri's story, in the language chosen. */
  const tellTengri = (s: Story) => story.set(s);

  /** The project under the pointer, or -1: its cloud opens and its logo forms, as a foretaste of opening it. */
  const hover = (project: number) => {
    hovered = project < 0 ? -1 : ALL.findIndex((k) => k.project === project);
  };

  /** Open a project's constellation (it shines and writes its name; the rest dim), or close it with -1. */
  const focus = (project: number) => {
    const was = focused;
    focused = project < 0 ? -1 : ALL.findIndex((k) => k.project === project);
    /* the one closed now says goodbye with the camera still on it */
    closing = focused < 0 ? was : -1;
    /* a project with a nebula shows its logo in the cloud instead of writing it in stars */
    if (focused >= 0 && !projects[project]?.color) { void writeName(focused); nameTarget = 1; } else nameTarget = 0;
  };

  /** A touch on the open project: true when something there answers it (Lito cheers). */
  const poke = () => {
    const n = nebulae.find((m) => m && m.ki === (focused >= 0 ? focused : hovered));
    if (!n?.face) return false;
    n.face.poke();
    return true;
  };

  /** A face is still saying goodbye: the camera stays on it. */
  const leaving = () => closing >= 0 && !!nebulae.find((n) => n && n.ki === closing)?.face?.leaving();

  /** How far a nebula is open (0 to 1): the camera leans in on it. */
  const opened = () => nebulae.reduce((m, n) => Math.max(m, n && (n.ki === focused || n.ki === closing) ? n.mat.uniforms.uOpen.value : 0), 0);

  /** Where to look to see a project's constellation and the name under it. */
  const gazeAt = (project: number) => {
    const k = ALL.find((c) => c.project === project);
    /* a little to the right of it, so it sits left of the panel that opens on the right; a nebula, at its middle */
    if (k && projects[project]?.color) return onSky(k.az + 6, k.el);
    return k ? onSky(k.az + 8, k.el - k.size * 0.55) : null;
  };

  return { group, update, rebuild: build, show: () => { showTarget = 1; }, pick, hover, focus, gazeAt, opened, poke, leaving, pickTengri, hoverTengri, openTengri, gazeTengri, tellTengri };
}
