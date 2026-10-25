import * as THREE from 'three';
import { NOISE3 } from './glsl';
import { GLYPHS, RUNE_FONT } from './textures';

/*
 * The night sky: a dark dome that meets the fog at the horizon, faint stars in two layers, a whisper of the Milky Way,
 * a shooting star now and then, and six constellations shaped like Orkhon runes, always faintly drawn in rune light;
 * bring the pointer near one and it lights up fully. The sky holds still.
 */

const R = 70;
/*
 * runes for the constellations, and where they hang: azimuth (0 = straight ahead, +right) and elevation, in degrees.
 * The camera sees only about 11° above the horizon on a wide screen, so they hang low.
 */
const CONSTELLATIONS: { glyph: number; az: number; el: number; size: number }[] = [
  { glyph: 0x45, az: -19, el: 5.4, size: 6 },
  { glyph: 0x0b, az: -6, el: 7.2, size: 4.8 },
  { glyph: 0x22, az: 7.5, el: 6.8, size: 5.4 },
  { glyph: 0x3c, az: 20, el: 5.2, size: 5.6 },
  { glyph: 0x1a, az: -31, el: 3.6, size: 5 },
  { glyph: 0x2d, az: 32, el: 3.8, size: 5 },
];

const SKY_FRAG = /* glsl */ `
${NOISE3}
uniform float uTime;
varying vec3 vDir;
float starLayer(vec3 d, float scale, float density, float size) {
  vec3 p = d * scale, c = floor(p);
  float h = h3(c);
  vec3 o = vec3(h3(c + 11.), h3(c + 23.), h3(c + 37.)) * .7 + .15;
  float dist = length(p - c - o);
  float px = fwidth(p.x) + fwidth(p.y);
  float s = smoothstep(size + px, size * .2, dist) * step(1. - density, h);
  return s * (.3 + .7 * fract(h * 17.));
}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  /* deep night, a little less dark towards the horizon where it meets the fog */
  vec3 col = mix(vec3(.014, .016, .021), vec3(.003, .0035, .006), smoothstep(-.06, .25, el));
  /* the Milky Way: a faint dusty band across the sky */
  float band = exp(-pow(dot(d, normalize(vec3(.55, .45, -.7))) * 3.2, 2.));
  float dust = fbm3(d * 6.) * .7 + fbm3(d * 18.) * .3;
  col += vec3(.035, .035, .045) * band * smoothstep(.35, .8, dust);
  col *= 1. - band * smoothstep(.55, .75, fbm3(d * 9. + 4.)) * .5;
  /* stars: many faint ones, fewer brighter ones, more of both along the band; none down in the haze */
  float stars = starLayer(d, 260., .05 + band * .08, .07) * .45 + starLayer(d, 90., .03, .06) * .9;
  col += vec3(.85, .88, 1.) * stars * smoothstep(-.07, .03, el);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The points of a rune: farthest-point samples of its drawn strokes, about 2-D unit size, y up. */
function runePoints(glyph: string, n: number) {
  const s = 96, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#fff';
  c.font = `${s * 0.8}px ${RUNE_FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(glyph, s / 2, s / 2);
  const img = c.getImageData(0, 0, s, s).data, ink: [number, number][] = [];
  for (let y = 0; y < s; y += 2) for (let x = 0; x < s; x += 2) if (img[(y * s + x) * 4 + 3] > 128) ink.push([x, y]);
  if (!ink.length) return [];
  const pts = [ink[0]], best = ink.map(() => Infinity);
  while (pts.length < n) {
    const [lx, ly] = pts[pts.length - 1];
    let far = 0;
    ink.forEach(([x, y], i) => { best[i] = Math.min(best[i], (x - lx) ** 2 + (y - ly) ** 2); if (best[i] > best[far]) far = i; });
    pts.push(ink[far]);
  }
  return pts.map(([x, y]) => [x / s - 0.5, 0.5 - y / s] as [number, number]);
}

/** The shortest set of lines joining all the points (a minimum spanning tree), so the letter reads as strokes. */
function spanningLines(p: [number, number][]) {
  const inTree = [0], lines: [number, number][] = [];
  while (inTree.length < p.length) {
    let bi = -1, bj = -1, bd = Infinity;
    for (const i of inTree) p.forEach((q, j) => {
      if (inTree.includes(j)) return;
      const d = (q[0] - p[i][0]) ** 2 + (q[1] - p[i][1]) ** 2;
      if (d < bd) { bd = d; bi = i; bj = j; }
    });
    lines.push([bi, bj]);
    inTree.push(bj);
  }
  return lines;
}

/** A direction on the sky from azimuth and elevation in degrees, `x`, `y` offsets in the plane facing it. */
function onSky(az: number, el: number, x = 0, y = 0) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  const fwd = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  const right = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const up = new THREE.Vector3().crossVectors(right, fwd);
  return fwd.addScaledVector(right, x).addScaledVector(up, y).normalize();
}

export function createSky(uRune: { value: THREE.Color }) {
  const group = new THREE.Group();
  const uTime = { value: 0 };

  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  }));
  dome.renderOrder = -10;
  group.add(dome);

  /* the constellations (drawn in the transparent pass, so they test depth and stay behind the stones): their stars as points, their letters as lines, each lit by how near the pointer is */
  const lit = CONSTELLATIONS.map(() => ({ value: 0 }));
  const centres = CONSTELLATIONS.map((k) => onSky(k.az, k.el));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uLit: { value: lit.map((l) => l.value) } },
    vertexShader: /* glsl */ `
      attribute float aK; uniform float uLit[6];
      varying float vLit;
      void main() {
        vLit = uLit[int(aK)];
        gl_PointSize = 5. + vLit * 3.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRune; varying float vLit;
      void main() {
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5, .05, d) * (.8 + vLit * .2);
        gl_FragColor = vec4(mix(vec3(.92, .95, 1.), uRune * 1.4 + .35, .35 + vLit * .65) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uRune, uLit: starMat.uniforms.uLit },
    vertexShader: 'attribute float aK; uniform float uLit[6]; varying float vLit; void main() { vLit = uLit[int(aK)]; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    /* always faintly drawn, bright when lit */
    fragmentShader: 'uniform vec3 uRune; varying float vLit; void main() { float a = .42 + vLit * .58; gl_FragColor = vec4(uRune * a, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const stars = new THREE.Points(new THREE.BufferGeometry(), starMat);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  stars.renderOrder = lines.renderOrder = -9;
  group.add(stars, lines);

  /** Lay the constellations out again; call once the rune font has loaded, since the shapes come from it. */
  const build = () => {
    const sp: number[] = [], sk: number[] = [], lp: number[] = [], lk: number[] = [];
    CONSTELLATIONS.forEach((k, ki) => {
      const pts = runePoints(GLYPHS[k.glyph], 12), scale = Math.tan(THREE.MathUtils.degToRad(k.size));
      const at = pts.map(([x, y]) => onSky(k.az, k.el, x * scale, y * scale).multiplyScalar(R * 0.98));
      at.forEach((v) => { sp.push(v.x, v.y, v.z); sk.push(ki); });
      for (const [i, j] of spanningLines(pts)) { lp.push(at[i].x, at[i].y, at[i].z, at[j].x, at[j].y, at[j].z); lk.push(ki, ki); }
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

  const ray = new THREE.Vector3(), world = new THREE.Vector3();
  /** Keep the sky around the camera, turn it, light the constellations near `pointerDir` (null when no pointer). */
  const update = (dt: number, camera: THREE.Camera, pointerDir: THREE.Vector3 | null) => {
    uTime.value += dt;
    group.position.copy(camera.position);
    centres.forEach((c, i) => {
      world.copy(c);
      const near = pointerDir ? THREE.MathUtils.smoothstep(ray.copy(pointerDir).dot(world), Math.cos(0.11), Math.cos(0.05)) : 0;
      lit[i].value += (near - lit[i].value) * Math.min(1, dt * (near > lit[i].value ? 3 : 0.8));
      starMat.uniforms.uLit.value[i] = lit[i].value;
    });
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

  return { group, update, rebuild: build };
}
