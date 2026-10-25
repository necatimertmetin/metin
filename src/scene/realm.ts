import * as THREE from 'three';
import { NOISE3 } from './glsl';
import { GLYPHS, RUNE_FONT } from './textures';
import { changing, inscribe, resample, traceRoundRect, writeRunes, type Rune } from './inscription';
import { createRuneLogo } from './runeLogo';
import type { SkyProject } from './sky';
import { sound } from './sound';
import { traceImage } from './trace';

/*
 * Another place, reached through a project's nebula: nothing but a sheer wall filling the view, square on, dim. It is a
 * wall of natural stones (a photographed one, ambientCG's Rocks001, CC0), its colour turned to near black steeped in
 * the project's own colour, dark and quiet, and its surface truly shaped by its height map, so the joints are deep. Old
 * Turkic letters are cut into some of the stones' faces, burning from inside in that colour's light, which bleeds into
 * the stone around them; embers glint in the joints. Out of Lito's wall its head pushes itself free, one piece of
 * layered rock (Rock061): not a block but its lines (the frame, the ears, the antenna), and as it comes away and turns
 * to you its eyes light up. Out of the others' walls their logos come the same way, traced from the picture into a
 * piece of stone. A light waits behind each piece: it leaks out round the edges as the stone grinds free, flares as it
 * breaks loose, and fills the hole it leaves, a real hollow going back into the wall, bright at the bottom.
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
 * instead the realm's colour (`uTint`), steeping every stone a little and the warm ones and patches deeply. `WINE`
 * scales how much.
 */
const GRADE = /* glsl */ `
{
  vec3 src = diffuseColor.rgb;
  float L = dot(src, vec3(.3, .59, .11));
  float warm = smoothstep(.02, .12, src.r - src.b) * smoothstep(.35, .7, n3(vec3(vStone * .9, 3.)));
  diffuseColor.rgb = L * L * 1.4 * mix(mix(vec3(.5, .47, .5), uTint * .45, .3), uTint, (.2 + .8 * warm) * WINE);
}
`;

/*
 * A realm's colours from its project's: the stone's tint the colour made quiet (less saturated, a middle lightness,
 * scaled so its brightest channel is just under one), and the light in its letters the
 * colour lifted towards white. Mystical, not bright.
 */
function realmColours(colour: string) {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(colour).getHSL(hsl);
  const tint = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.45), 0.36);
  tint.multiplyScalar(0.95 / Math.max(tint.r, tint.g, tint.b));
  const glow = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9 + 0.1), 0.6);
  return { tint, glow };
}

/* the wall's stone, with its letters and embers, all fixed to where on the wall they are (`vStone`, in world units) */
function wallMaterial(uRunes: { value: THREE.Texture | null }, uGlow: { value: THREE.Color }, uTint: { value: THREE.Color }, uTime: { value: number }, hole: HoleUniforms, card: CardUniforms) {
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
    Object.assign(sh.uniforms, { uRunes, uGlow, uTint, uTime, uDisp: { value: disp } }, hole, card);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStone; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone = position.xy;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define WINE 1.\n${NOISE3}\nvarying vec2 vStone; varying vec3 vWP; uniform sampler2D uRunes; uniform sampler2D uDisp; uniform vec3 uGlow; uniform vec3 uTint; uniform float uTime;\nuniform sampler2D uHoleMask; uniform vec3 uHoleRect; uniform float uHoleOn;\nuniform sampler2D uText; uniform vec4 uTextRect; uniform float uTextLight;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
/* the hole the piece left: no wall there, so the hollow behind it shows */
{
  vec2 hu = (vStone - uHoleRect.xy) / uHoleRect.z + .5;
  if (uHoleOn > .5 && hu.x > 0. && hu.y > 0. && hu.x < 1. && hu.y < 1. && texture2D(uHoleMask, hu).r > .5) discard;
}
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
/*
 * the project's words, cut right through the stones as hollows, like the hole a piece leaves: dark at the mouth, the
 * inner walls showing as you look in at a slant, the floor deep down burning in the realm's colour (white hot where
 * a letter has just been cut, cooling)
 */
vec2 wuv = (vStone - uTextRect.xy) / uTextRect.zw + .5;
bool onWords = wuv.x > 0. && wuv.y > 0. && wuv.x < 1. && wuv.y < 1.;
vec4 wt = onWords ? texture2D(uText, wuv) : vec4(0.);
float mouth = wt.a;
/* looking in: the floor lies a little way back, so it is seen shifted against the mouth */
vec3 look = normalize(cameraPosition - vWP);
vec2 deep = -look.xy / max(look.z, .35) * .04 / uTextRect.zw;
float floorSeen = 0., wallLit = 0., wHeat = 0.;
if (mouth > .01) {
  vec4 fl = texture2D(uText, wuv + deep);
  /* the lit floor where it shows through the mouth; along one side the inner wall, darker, gives the depth */
  floorSeen = mouth * mix(fl.a, 1., .25);
  wallLit = mouth * (1. - fl.a);
  wHeat = fl.g * floorSeen;
}
/* no stone face inside a letter: only the dark of the hollow */
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.006), mouth);
/* embers deep in the joints */
vec2 eq = vStone * 30., ec = floor(eq);
float eh = h3(vec3(ec, 12.));
float fleck = step(.99, eh) * smoothstep(.4, .05, length(fract(eq) - .5)) * smoothstep(.3, .12, hgt) * (.55 + .45 * sin(uTime * 2. + eh * 50.));
float pulse = .7 + .3 * sin(uTime * 1.1 + rid * 40.);
float flare = smoothstep(.92, 1., sin(uTime * .37 + rid * 91.));
vec3 seep = uGlow * ((cut * 1.8 + halo * .55) * (pulse + flare * 1.4) + fleck * 2.4) + (uGlow * (floorSeen * 1.5 + wallLit * .18) + vec3(.06) * floorSeen) * uTextLight
  + vec3(1., .9, .72) * wHeat * 2.4;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += seep;');
  };
  return mat;
}

/*
 * The piece that comes out of the wall: layered rock, near black, a little of the realm's colour in it. A logo's piece
 * carries the logo written in letters on its face, as it was written in the sky: the same letters along the logo's
 * middle line (`uLogo`, a live picture of them, `uLogoSpan` across), cut into the stone and burning in its colour;
 * `uRuneLight` wakes them as it comes out. Lito's head carries letters along its lines the same way.
 */
type PieceUniforms = { uLogo: { value: THREE.Texture | null }; uLogoSpan: { value: number }; uGlow: { value: THREE.Color }; uPic: { value: THREE.Texture | null }; uPicSize: { value: THREE.Vector2 }; uRuneOn: { value: number }; uRuneLight: { value: number } };
function headMaterial(uTint: { value: THREE.Color }, pu: PieceUniforms) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex('rock061_color', 0.7, 0.7, true),
    normalMap: tex('rock061_normalgl', 0.7, 0.7),
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: tex('rock061_roughness', 0.7, 0.7),
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTint }, pu);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStone; varying float vFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone = position.xy;\nvFace = step(.7, normal.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define WINE .35\n${NOISE3}\nvarying vec2 vStone; varying float vFace; uniform vec3 uTint;
uniform sampler2D uLogo; uniform float uLogoSpan; uniform vec3 uGlow; uniform float uRuneOn; uniform float uRuneLight;\nuniform sampler2D uPic; uniform vec2 uPicSize;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${GRADE}
/* the logo's letters, laid over the face exactly where the logo's lines run */
vec2 luv = vStone / uLogoSpan + .5;
vec4 lt = uRuneOn > .5 && vFace > .5 && luv.x > 0. && luv.y > 0. && luv.x < 1. && luv.y < 1. ? texture2D(uLogo, luv) : vec4(0.);
diffuseColor.rgb *= 1. - lt.a * .7;
/* the logo's own bright parts (Padoboard's lit pads), where they lie on the stone */
vec2 puv = vStone / uPicSize + .5;
/* read softened (a coarser level of the picture), so the colour reaches over the edges and down the sides too */
vec4 pic = uRuneOn > .5 && puv.x > 0. && puv.y > 0. && puv.x < 1. && puv.y < 1. ? texture2D(uPic, puv, 3.) : vec4(0.);
float bright = smoothstep(.5, .8, dot(pic.rgb, vec3(.3, .59, .11)) / max(pic.a, .01)) * smoothstep(.2, .5, pic.a);
/* the stone itself takes the logo's colour there (Padoboard's lit pads are green stone) */
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .35 + pic.rgb / max(pic.a, .01) * .2, bright * .9);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
/* burning in the realm's colour, a little of the letters' own brightness at their hearts */
totalEmissiveRadiance += (uGlow * .85 + lt.rgb * .15) * lt.a * uRuneLight + uGlow * bright * .05 * uRuneLight;`);
  };
  return mat;
}

/*
 * Letters along Lito's lines, as the logos' pieces carry theirs: round the frame, down the ears, up the antenna, one
 * on its light. Painted in the same 512 wide design space as its shapes, so they sit exactly on its stone (the canvas
 * covers the design from y 44 to 556, the head's middle at its middle); `update` lets them breathe and change.
 */
function litoRunes() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const c = cv.getContext('2d')!;
  const texture = new THREE.CanvasTexture(cv);
  const parts: { runes: Rune[]; size: number }[] = [
    { runes: inscribe(traceRoundRect(64, 184, 384, 290, 82), 34), size: 32 },
    { runes: inscribe(resample([[32, 294], [32, 358]], false), 30), size: 24 },
    { runes: inscribe(resample([[480, 294], [480, 358]], false), 30), size: 24 },
    { runes: inscribe(resample([[256, 120], [256, 168]], false), 26), size: 20 },
    { runes: [{ x: 256, y: 92, a: 0, g: 0x2f, ph: 0, flare: 0 }], size: 36 },
  ];
  const swap = changing(parts.flatMap((p) => p.runes));
  let t = 0;
  let acc = 1;
  const update = (dt: number) => {
    t += dt;
    swap(dt);
    /* fifteen times a second is plenty for letters that breathe slowly */
    acc += dt;
    if (acc < 1 / 15) return;
    acc = 0;
    c.setTransform(1, 0, 0, 1, 0, -44);
    c.clearRect(0, 44, 512, 512);
    c.fillStyle = c.strokeStyle = '#fff';
    c.lineJoin = 'round';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const p of parts) writeRunes(c, p.runes, p.size, 1, t, 0);
    texture.needsUpdate = true;
  };
  update(0);
  return { texture, update };
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

/*
 * The light behind a carved piece, painted from its shapes (in the wall's units, centred, across `span`): soft and
 * wide where it spills out round the edges, brighter close in, so it hugs the outline from behind.
 */
function haloTexture(shapes: THREE.Shape[], span: number, fill = false) {
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d')!;
  const P = (v: THREE.Vector2) => [(v.x / span + 0.5) * N, (0.5 - v.y / span) * N] as const;
  if (fill) {
    /* the shapes filled, each with its own holes cut out, biggest first so pieces inside another's hole land on top */
    const path = (loop: THREE.Vector2[]) => {
      c.beginPath();
      loop.forEach((v, i) => { const [x, y] = P(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.closePath();
    };
    const size = (sh: THREE.Shape) => { const b = new THREE.Box2().setFromPoints(sh.getPoints(8)); return (b.max.x - b.min.x) * (b.max.y - b.min.y); };
    c.fillStyle = '#fff';
    for (const sh of [...shapes].sort((a, b) => size(b) - size(a))) {
      c.globalCompositeOperation = 'source-over';
      path(sh.getPoints(24)); c.fill();
      c.globalCompositeOperation = 'destination-out';
      for (const h of sh.holes) { path(h.getPoints(24)); c.fill(); }
    }
    return new THREE.CanvasTexture(cv);
  }
  const trace = () => {
    c.beginPath();
    for (const sh of shapes) {
      for (const loop of [sh.getPoints(24), ...sh.holes.map((h) => h.getPoints(24))]) {
        loop.forEach((v, i) => { const [x, y] = P(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
        c.closePath();
      }
    }
  };
  c.strokeStyle = '#fff';
  c.lineJoin = 'round';
  for (const [blur, width, alpha] of [[44, 34, 0.55], [18, 16, 0.8], [6, 6, 1]] as const) {
    c.filter = `blur(${blur}px)`;
    c.globalAlpha = alpha;
    c.lineWidth = width;
    trace();
    c.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

/** What a project's wall says. */
export type Card = { kicker: string; title: string; role: string; body: string; close: string; link?: { label: string; href: string } };

type Box = { x: number; y: number; w: number; h: number };
/* one letter of the words: where it goes, in what font, when it is cut (seconds from arriving), and, for the title,
   the Old Turkic letter it shows first and when it turns into its own */
type Glyph = { ch: string; x: number; y: number; w: number; size: number; font: string; at: number; rune?: string; turn?: number };
type Layout = { glyphs: Glyph[]; link: Box | null; underline: { x: number; y: number; w: number; at: number } | null; end: number };

/*
 * The words, laid out on a picture `TW` × `TH` pixels for cutting into the wall: a small line above, the title, the
 * role, the description wrapped, the link. Cinzel, from Roman inscriptions in stone, for all of it, at its heaviest
 * so the letters hold up as hollows in rough stone. Each letter gets its moment: the title first stands in Old Turkic
 * letters and turns, letter by letter, into its own; the rest opens line by line, the stone breaking away here and
 * there along each line rather than left to right.
 */
const TW = 1024, TH = 1320, M = 84;
const measure = document.createElement('canvas').getContext('2d')!;
function layoutCard(card: Card): Layout {
  const glyphs: Glyph[] = [];
  const run = (text: string, x: number, y: number, font: string, gap: number, at: number, step: number) => {
    measure.font = font;
    const size = parseFloat(/(\d+)px/.exec(font)?.[1] ?? '30');
    [...text].forEach((ch, i) => {
      const w = measure.measureText(ch).width;
      glyphs.push({ ch, x, y, w, size, font, at: at + i * step });
      x += w + gap;
    });
    return x;
  };
  let y = M;
  run(card.kicker.toUpperCase(), M, y, '900 30px "Cinzel", serif', 7, 0.3, 0.025);
  y += 66;
  /* the title: each letter first an Old Turkic one, turning into itself in turn */
  const tf = '900 100px "Cinzel", serif';
  measure.font = tf;
  let x = M - 4;
  [...card.title].forEach((ch, i) => {
    glyphs.push({ ch, x, y, w: measure.measureText(ch).width, size: 100, font: tf, at: 0.5 + i * 0.05, rune: GLYPHS[(ch.charCodeAt(0) * 7 + i * 13) % GLYPHS.length], turn: 1.4 + i * 0.09 });
    x += measure.measureText(ch).width;
  });
  y += 124;
  let t = 1.6 + card.title.length * 0.09;
  if (card.role) { const e = run(card.role.toUpperCase(), M, y, '900 27px "Cinzel", serif', 5, t, 0.015); t += (e - M) / 900; y += 70; } else y += 20;
  /* the description, cut word by word along its lines */
  const bf = '900 33px "Cinzel", serif', SPACE = 2.5;
  measure.font = bf;
  let line: string[] = [];
  const flush = () => {
    const text = line.join(' ');
    run(text, M, y, bf, SPACE, t, 0);
    /* within the line the stone gives way here and there, not left to right */
    for (let k = glyphs.length - text.length; k < glyphs.length; k++) glyphs[k].at = t + Math.random() * 0.55;
    t += 0.28;
    y += 62;
    line = [];
  };
  for (const word of card.body.split(/\s+/).filter(Boolean)) {
    /* the room a line takes, its letters' spacing counted in */
    const next = [...line, word].join(' ');
    if (line.length && measure.measureText(next).width + next.length * SPACE > TW - M * 2) flush();
    line.push(word);
  }
  if (line.length) flush();
  let link: Box | null = null, underline: Layout['underline'] = null;
  if (card.link) {
    y += 34;
    const e = run(`${card.link.label.toUpperCase()} ↗`, M, y, '900 30px "Cinzel", serif', 5, t + 0.2, 0.03);
    underline = { x: M, y: y + 44, w: e - M - 4, at: t + 0.2 };
    link = { x: M - 10, y: y - 14, w: e - M + 20, h: 70 };
    t += 0.6;
  }
  return { glyphs, link, underline, end: t + 1.5 };
}

/*
 * The words at `t` seconds from arriving, painted for the wall: alpha where the stone is cut; red always; green how
 * hot a letter still is from being cut (it cools to the realm's colour).
 */
function drawCard(c: CanvasRenderingContext2D, l: Layout, t: number) {
  c.clearRect(0, 0, TW, TH);
  c.textBaseline = 'top';
  const hot = (since: number) => Math.round(255 * Math.exp(-Math.max(0, since) * 2.2));
  for (const g of l.glyphs) {
    if (t < g.at) continue;
    if (g.rune && g.turn !== undefined && t < g.turn) {
      c.font = `92px ${RUNE_FONT}`;
      c.fillStyle = `rgb(255, ${Math.max(90, hot(t - g.at))}, 0)`;
      c.fillText(g.rune, g.x + 6, g.y + 4);
      continue;
    }
    c.font = g.font;
    c.fillStyle = `rgb(255, ${hot(t - (g.turn ?? g.at))}, 0)`;
    c.fillText(g.ch, g.x, g.y);
  }
  if (l.underline && t > l.underline.at) {
    const k = Math.min(1, (t - l.underline.at) / 0.6);
    c.fillStyle = `rgb(255, ${hot(t - l.underline.at)}, 0)`;
    c.fillRect(l.underline.x, l.underline.y, l.underline.w * k, 3);
  }
}

/* where the project's words are written on the wall: their picture, the rectangle they cover there, and their light */
type CardUniforms = { uText: { value: THREE.Texture | null }; uTextRect: { value: THREE.Vector4 }; uTextLight: { value: number } };

/* where the wall is cut away for a piece's hole: its mask, its middle and span on the wall, and whether it is open */
type HoleUniforms = { uHoleMask: { value: THREE.Texture | null }; uHoleRect: { value: THREE.Vector3 }; uHoleOn: { value: number } };

/*
 * The hollow behind a piece, seen from inside: its walls and floor, lit from the bottom by the light that waits there,
 * dark at the mouth, bright deep down, with the rock's unevenness in it.
 */
function hollowMaterial(uGlow: { value: THREE.Color }, uLight: { value: number }, depth: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uGlow, uLight },
    vertexShader: `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `${NOISE3}
uniform vec3 uGlow; uniform float uLight; varying vec3 vP;
void main() {
  float deep = 1. - clamp(vP.z / ${depth.toFixed(3)}, 0., 1.);
  float rock = .7 + .6 * n3(vP * 9.);
  gl_FragColor = vec4(uGlow * (.04 + 1.7 * pow(deep, 1.8)) * rock * uLight, 1.);
}`,
    side: THREE.BackSide,
  });
}

export function createRealm(uRunes: { value: THREE.Texture | null }) {
  let projects: SkyProject[] = [];
  let current = -1;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030303');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const uTime = { value: 0 }, uGlow = { value: new THREE.Color('#ffa63d') }, uTint = { value: new THREE.Color(1.2, 0.3, 0.36) };

  /* dim: low from the upper left, raking across the wall so every stone and joint shows; a faint fill from where you stand */
  const key = new THREE.DirectionalLight('#e6d6cc', 2.6);
  key.position.set(-6, 4, 3);
  scene.add(key, new THREE.HemisphereLight('#5a4648', '#0a0405', 0.35));
  const fill = new THREE.DirectionalLight('#d8ccc8', 0.3);
  fill.position.set(0, 1, 6);
  scene.add(fill);

  /* the wall, square on, finely divided so its height map can shape it */
  const hole: HoleUniforms = { uHoleMask: { value: null }, uHoleRect: { value: new THREE.Vector3(0, 0, 1) }, uHoleOn: { value: 0 } };
  /* the project's words, to be written on the wall's stones on the right: no card, the wall itself says it */
  const CW = 2.15, CH = (CW * TH) / TW, CX = 1.32, CY = 0.05;
  const cardCanvas = document.createElement('canvas');
  const cardTex = new THREE.CanvasTexture(cardCanvas);
  cardTex.anisotropy = 8;
  const cardU: CardUniforms = { uText: { value: cardTex }, uTextRect: { value: new THREE.Vector4(CX, CY, CW, CH) }, uTextLight: { value: 0 } };
  cardCanvas.width = TW; cardCanvas.height = TH;
  const cardCtx = cardCanvas.getContext('2d')!;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(18, 11, 640, 390), wallMaterial(uRunes, uGlow, uTint, uTime, hole, cardU));
  wall.position.set(0, 0, -4.5);
  scene.add(wall);

  /*
   * The piece that comes out of the wall, set in left of the middle: Lito's head with its eyes, or a project's logo
   * traced into stone. Its geometry is swapped for each realm; everything about how it comes out is shared.
   */
  const DEPTH = 0.22, HOLLOW = 0.7, SPAN = 2.6;
  const seat = new THREE.Vector3(-1.05, 0.1, 0);
  const extrude = (shapes: THREE.Shape[], depth: number) =>
    new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2, curveSegments: 14 });
  type Piece = { head: THREE.BufferGeometry; eyes: THREE.BufferGeometry | null; hollow: THREE.BufferGeometry; halo: THREE.Texture; mask: THREE.Texture };
  const makePiece = (shapes: THREE.Shape[], eyeShapes: THREE.Shape[] | null): Piece => {
    const all = eyeShapes ? [...shapes, ...eyeShapes] : shapes;
    return {
      head: extrude(shapes, DEPTH),
      eyes: eyeShapes ? extrude(eyeShapes, DEPTH * 0.5) : null,
      hollow: new THREE.ExtrudeGeometry(all, { depth: HOLLOW, bevelEnabled: false, curveSegments: 14 }),
      halo: haloTexture(all, SPAN),
      mask: haloTexture(all, SPAN, true),
    };
  };
  const pieces = new Map<number, Promise<Piece | null>>();
  const pieceOf = (project: number): Promise<Piece | null> => {
    let pr = pieces.get(project);
    if (!pr) {
      const p = projects[project];
      if (p?.face === 'lito') { const ls = litoShapes(1.7 / 512); pr = Promise.resolve(makePiece(ls.head, ls.eyes)); }
      else if (p?.logo) pr = traceImage(p.logo, LOGO).then((sh) => (sh.length ? makePiece(sh, null) : null));
      else pr = Promise.resolve(null);
      pieces.set(project, pr);
    }
    return pr;
  };

  /* a logo's piece is traced at 1.6 across; its letters' picture holds the logo in 440 of its 560 pixels */
  const LOGO = 1.6;
  const pieceU: PieceUniforms = { uLogo: { value: null }, uLogoSpan: { value: (LOGO * 560) / 440 }, uGlow, uPic: { value: null }, uPicSize: { value: new THREE.Vector2(LOGO, LOGO) }, uRuneOn: { value: 0 }, uRuneLight: { value: 0 } };
  const runeLogos = new Map<number, ReturnType<typeof createRuneLogo>>();
  const litoLetters = litoRunes();
  const head = new THREE.Mesh(new THREE.BufferGeometry(), headMaterial(uTint, pieceU));
  const uLook = { value: new THREE.Vector2() };
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#06090a', emissive: uGlow.value, emissiveIntensity: 0, roughness: 0.6 });
  /* Lito's eyes burn brightest at their hearts, darker towards the rim, with a flicker of embers */
  eyeMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uLook = uLook;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEye;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvEye = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE3}\nvarying vec2 vEye; uniform float uTime; uniform vec2 uLook;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
/* the glow in each eye leans towards the pointer */
vec2 eyeAt = vec2(sign(vEye.x) * .2125, -.103) + uLook;
float ed = length((vEye - eyeAt) * vec2(1., .95));
totalEmissiveRadiance *= .25 + 1.6 * smoothstep(.17, .02, ed) * (.8 + .4 * n3(vec3(vEye * 30., uTime * 1.5)));`);
  };
  const eyes = new THREE.Mesh(new THREE.BufferGeometry(), eyeMat);
  eyes.position.z = DEPTH * 0.3;
  head.add(eyes);
  const holder = new THREE.Group();
  holder.position.copy(seat);
  holder.add(head);
  /* the eyes' light falls on the wall around */
  const eyeLight = new THREE.PointLight(uGlow.value, 0, 5, 1.6);
  eyeLight.position.set(0, -0.1, 1.1);
  holder.add(eyeLight);
  wall.add(holder);
  /* the hollow behind the piece, going back into the wall from its face */
  const uLight = { value: 0 };
  const hollow = new THREE.Mesh(new THREE.BufferGeometry(), hollowMaterial(uGlow, uLight, HOLLOW));
  hollow.position.copy(seat).setZ(-HOLLOW);
  wall.add(hollow);
  /* the light behind the stone, leaking out round its edges */
  const haloMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, SPAN), haloMat);
  halo.position.copy(seat).setZ(0.008);
  wall.add(halo);
  const holeLight = new THREE.PointLight(uGlow.value, 0, 4.5, 1.5);
  holeLight.position.copy(seat).setZ(0.25);
  wall.add(holeLight);
  hole.uHoleRect.value.set(seat.x, seat.y, SPAN);
  let ready = false;

  let card: Card | null = null, cardHit: Layout | null = null, carved = Infinity;
  /** What the wall says (painted again when it changes, as when the language does). */
  const setCard = (next: Card | null) => {
    card = next;
    cardHit = null;
    cardCtx.clearRect(0, 0, TW, TH);
    cardTex.needsUpdate = true;
    if (!next) return;
    /* laid out once its fonts are here (measured in another font, the letters would land wrong); then cut in afresh */
    void Promise.all(['900 100px "Cinzel"', '900 33px "Cinzel"'].map((f) => document.fonts.load(f))).catch(() => null).then(() => {
      if (card !== next) return;
      cardHit = layoutCard(next);
      carved = 0;
    });
  };
  /*
   * The way back: a round stone above the words' right edge, a cross cut into its face glowing in the realm's colour, a
   * ring of light round it. It grinds out of the wall with the piece and breaks free with it; under the pointer it
   * stands out further and its light swells; pressed, it goes back into its place with a knock.
   */
  /* a little in from the corner, clear of the language switch above it */
  const BTN = new THREE.Vector3(CX + CW / 2 - 0.3, CY + CH / 2 - 0.42, 0);
  const btnShape = new THREE.Shape().absarc(0, 0, 0.14, 0, Math.PI * 2, false);
  const button = new THREE.Mesh(
    new THREE.ExtrudeGeometry(btnShape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 4, curveSegments: 32 }),
    headMaterial(uTint, { uLogo: { value: null }, uLogoSpan: { value: 1 }, uGlow, uPic: { value: null }, uPicSize: { value: new THREE.Vector2(1, 1) }, uRuneOn: { value: 0 }, uRuneLight: { value: 0 } }),
  );
  button.position.copy(BTN);
  wall.add(button);
  const crossCv = document.createElement('canvas');
  crossCv.width = crossCv.height = 128;
  {
    const xc = crossCv.getContext('2d')!;
    xc.strokeStyle = '#fff'; xc.lineCap = 'round'; xc.lineWidth = 13;
    xc.beginPath(); xc.moveTo(40, 40); xc.lineTo(88, 88); xc.moveTo(88, 40); xc.lineTo(40, 88); xc.stroke();
  }
  const crossMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(crossCv), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), crossMat);
  cross.position.z = 0.112;
  button.add(cross);
  const btnRingMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const btnRing = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), btnRingMat);
  btnRing.position.copy(BTN).setZ(0.01);
  wall.add(btnRing);
  {
    const rc = document.createElement('canvas');
    rc.width = rc.height = 128;
    const c2 = rc.getContext('2d')!, g = c2.createRadialGradient(64, 64, 20, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = g; c2.fillRect(0, 0, 128, 128);
    btnRingMat.map = new THREE.CanvasTexture(rc);
  }
  let btnHot = 0, btnPress = -1;
  /** The way back pressed: the stone sinks in with a knock. */
  const pressClose = () => { btnPress = 0; sound.hit(0.35, 0.4, 0.6); };

  const ray = new THREE.Raycaster(), local = new THREE.Vector3();
  const within = (r: { x: number; y: number; w: number; h: number } | null, px: number, py: number) => !!r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  /** What of the words on the wall is under the pointer (`ndc`, -1 to 1): the close seal, the link, or nothing. */
  const hit = (ndc: THREE.Vector2): 'close' | 'link' | null => {
    const what = touch(ndc);
    hotClose = what === 'close';
    return what;
  };
  const touch = (ndc: THREE.Vector2): 'close' | 'link' | null => {
    if (!card) return null;
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(button, false).length) return 'close';
    if (!cardHit) return null;
    const h = ray.intersectObject(wall, false)[0];
    if (!h) return null;
    wall.worldToLocal(local.copy(h.point));
    const px = ((local.x - CX) / CW + 0.5) * TW, py = (0.5 - (local.y - CY) / CH) * TH;
    if (within(cardHit.link, px, py)) return 'link';
    return null;
  };
  const linkHref = () => card?.link?.href ?? null;

  /*
   * the piece's way out, in seconds from arriving: a moment of stillness, then it grinds out of the rock with the view
   * shaking, cracks free, comes away from the wall turning towards you, and hangs there, breathing
   */
  const WAIT = 0.9, OUT = 2.4, FREE = 1.8;
  let since = 0, cue = 0;
  const toCam = new THREE.Vector3(), inv = new THREE.Quaternion(), shake = new THREE.Vector3(), seatWorld = new THREE.Vector3();
  /* what flies when a piece breaks free: chips of its stone, a cloud of dust, a ring of light running out over the wall */
  const CHIPS = 70, DUST = 60;
  const chipMat = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.95 });
  const chips = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), chipMat, CHIPS);
  chips.count = 0;
  chips.frustumCulled = false;
  wall.add(chips);
  const chip = Array.from({ length: CHIPS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 0 }));
  const dustCv = document.createElement('canvas');
  dustCv.width = dustCv.height = 64;
  {
    const dc = dustCv.getContext('2d')!, g = dc.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    dc.fillStyle = g; dc.fillRect(0, 0, 64, 64);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  const dustMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dustCv), size: 0.5, transparent: true, opacity: 0, depthWrite: false, color: '#8a827a' });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  wall.add(dust);
  const dustV = Array.from({ length: DUST }, () => new THREE.Vector3());
  const ringCv = document.createElement('canvas');
  ringCv.width = ringCv.height = 256;
  {
    const rc = ringCv.getContext('2d')!, g = rc.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    rc.fillStyle = g; rc.fillRect(0, 0, 256, 256);
  }
  const ringMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ringCv), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
  ring.position.copy(seat).setZ(0.05);
  wall.add(ring);
  let broke = -1;
  const burst = () => {
    broke = 0;
    chips.count = CHIPS;
    for (const c of chip) {
      const a = Math.random() * Math.PI * 2, d = 0.3 + Math.random() * 0.6;
      c.p.set(seat.x + Math.cos(a) * d, seat.y + Math.sin(a) * d * 0.8, 0.05);
      c.v.set(Math.cos(a) * (0.8 + Math.random() * 1.8), Math.sin(a) * (0.6 + Math.random() * 1.4) + 0.8, 1.2 + Math.random() * 2.8);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      c.s = 0.015 + Math.random() * 0.05;
    }
    const pos = dustGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < DUST; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 0.7;
      pos.setXYZ(i, seat.x + Math.cos(a) * d, seat.y + Math.sin(a) * d * 0.8, 0.1 + Math.random() * 0.2);
      dustV[i].set(Math.cos(a) * (0.2 + Math.random() * 0.6), Math.sin(a) * 0.3 + 0.15, 0.2 + Math.random() * 0.6);
    }
    pos.needsUpdate = true;
  };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3();
  /*
   * where a letter opens, its stone breaks off and falls: a couple of small chips from each letter, dropping down the
   * face of the wall and fading, from a pool reused as letters open
   */
  const GRIT = 260;
  /* pale stone crumbs, lit from within in the realm's colour like sparks from the letter */
  const gritMat = new THREE.MeshStandardMaterial({ color: '#b3a796', roughness: 0.8, emissive: uGlow.value.clone(), emissiveIntensity: 0.9 });
  const grit = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), gritMat, GRIT);
  grit.count = GRIT;
  grit.frustumCulled = false;
  wall.add(grit);
  const grain = Array.from({ length: GRIT }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 0, life: 0 }));
  let gritNext = 0;
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < GRIT; i++) grit.setMatrixAt(i, hide);
  const crumbleAt = (x: number, y: number, w: number, h: number) => {
    for (let k = 0; k < 2; k++) {
      const g = grain[gritNext];
      gritNext = (gritNext + 1) % GRIT;
      g.p.set(x + (Math.random() - 0.5) * w, y + (Math.random() - 0.5) * h, 0.02);
      g.v.set((Math.random() - 0.5) * 0.25, Math.random() * 0.15, 0.25 + Math.random() * 0.45);
      g.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      g.w.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      g.s = (0.4 + Math.random() * 0.6) * Math.min(0.026, h * 0.4);
      g.life = 1.6;
    }
  };
  const fallGrit = (dt: number) => {
    let any = false;
    grain.forEach((g, i) => {
      if (g.life <= 0) return;
      any = true;
      g.life -= dt;
      g.v.y -= 4 * dt;
      g.p.addScaledVector(g.v, dt);
      g.r.x += g.w.x * dt; g.r.y += g.w.y * dt; g.r.z += g.w.z * dt;
      grit.setMatrixAt(i, g.life > 0 ? m4.compose(g.p, q4.setFromEuler(g.r), s4.setScalar(g.s * Math.min(1, g.life / 0.5))) : hide);
    });
    if (any) grit.instanceMatrix.needsUpdate = true;
  };
  const flyBits = (dt: number) => {
    if (broke < 0) return;
    broke += dt;
    if (broke > 3) { broke = -1; chips.count = 0; dustMat.opacity = 0; ringMat.opacity = 0; return; }
    chip.forEach((c, i) => {
      c.v.y -= 7 * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      const fade = Math.min(1, (3 - broke) / 0.8);
      chips.setMatrixAt(i, m4.compose(c.p, q4.setFromEuler(c.r), s4.setScalar(c.s * fade)));
    });
    chips.instanceMatrix.needsUpdate = true;
    const pos = dustGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < DUST; i++) {
      dustV[i].multiplyScalar(1 - dt * 0.8);
      pos.setXYZ(i, pos.getX(i) + dustV[i].x * dt, pos.getY(i) + dustV[i].y * dt, pos.getZ(i) + dustV[i].z * dt);
    }
    pos.needsUpdate = true;
    dustMat.size = 0.4 + broke * 0.5;
    dustMat.opacity = Math.min(1, broke * 6) * Math.max(0, 1 - broke / 3) * 0.8;
    const k = Math.min(1, broke / 0.9);
    ring.scale.setScalar(0.6 + k * 4.5);
    ringMat.opacity = (1 - k) * (1 - k) * 1.4;
  };

  /** The projects the realms belong to. */
  const useProjects = (list: SkyProject[]) => { projects = list; };

  /** Arriving at `project`'s wall: its colours, its piece, and everything back in the rock, to come out again. */
  const enter = (project: number) => {
    since = 0; cue = 0; current = project; ready = false; btnPress = -1;
    const p = projects[project];
    const c = realmColours(p?.color ?? '#c27b4a');
    uTint.value.copy(c.tint);
    uGlow.value.copy(c.glow);
    /* materials and lights keep their own copy of a colour, so they are told too */
    eyeMat.emissive.copy(c.glow);
    eyeLight.color.copy(c.glow);
    haloMat.color.copy(c.glow);
    gritMat.emissive.copy(c.glow);
    holeLight.color.copy(c.glow);
    holder.visible = hollow.visible = halo.visible = holeLight.visible = false;
    hole.uHoleOn.value = 0;
    void pieceOf(project).then((pc) => {
      if (!pc || current !== project) return;
      head.geometry = pc.head;
      eyes.visible = !!pc.eyes;
      /* Lito's frame carries letters along its lines too, its picture 1.7 across as its shapes are */
      pieceU.uRuneOn.value = 1;
      pieceU.uLogoSpan.value = pc.eyes ? 1.7 : (LOGO * 560) / 440;
      if (pc.eyes) { pieceU.uLogo.value = litoLetters.texture; pieceU.uPic.value = null; }
      if (!pc.eyes && p?.logo) {
        let l = runeLogos.get(project);
        if (!l) { l = createRuneLogo(p.logo, `#${c.glow.getHexString()}`); runeLogos.set(project, l); }
        pieceU.uLogo.value = l.texture;
        /* the picture itself, the same size as the traced piece (its longer side `LOGO` across) */
        new THREE.TextureLoader().load(p.logo, (pic) => {
          if (current !== project) return;
          pic.colorSpace = THREE.SRGBColorSpace;
          const w = pic.image.width, h = pic.image.height, m = Math.max(w, h);
          pieceU.uPic.value = pic;
          pieceU.uPicSize.value.set((LOGO * w) / m, (LOGO * h) / m);
        });
      }
      if (pc.eyes) eyes.geometry = pc.eyes;
      hollow.geometry = pc.hollow;
      haloMat.map = pc.halo;
      haloMat.needsUpdate = true;
      hole.uHoleMask.value = pc.mask;
      holder.visible = hollow.visible = halo.visible = holeLight.visible = true;
      ready = true;
    });
  };

  const look = new THREE.Vector2();
  let hotClose = false, carveAcc = 1;
  /** `ndc`: the pointer, -1 to 1; the view drifts a little after it. */
  const update = (dt: number, ndc: THREE.Vector2, t: number) => {
    since += dt;
    uTime.value = t;
    const ease = (k: number) => k * k * (3 - 2 * k);
    const out = ease(THREE.MathUtils.clamp((since - WAIT) / OUT, 0, 1));
    const free = ease(THREE.MathUtils.clamp((since - WAIT - OUT) / FREE, 0, 1));
    if (ready && cue === 0 && since > WAIT) { cue = 1; sound.awaken(OUT, -0.3); }
    if (ready && cue === 1 && since > WAIT + OUT) { cue = 2; sound.hit(1, -0.3, 1); sound.crack(-0.3); burst(); }

    const grind = ready && out > 0 && out < 1 ? 1 : 0;
    /* the grinding shivers the view; the break jolts it hard */
    const jolt = broke >= 0 ? Math.exp(-broke * 5) * 0.06 : 0;
    shake.set(Math.sin(t * 47), Math.sin(t * 59 + 1.3), 0).multiplyScalar(grind * 0.012 + jolt);
    /* the view does not follow the pointer here (what you reach for, the close stone, would move away from it): it
       only sways a little on its own */
    camera.position.set(Math.sin(t * 0.21) * 0.05, Math.sin(t * 0.17 + 1) * 0.03, 0).add(shake);
    camera.lookAt(Math.sin(t * 0.21) * 0.08, Math.sin(t * 0.17 + 1) * 0.05, -4);
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
    /* breaking loose, the piece itself shudders, hard at first and settling */
    if (broke >= 0) {
      const tremor = Math.exp(-broke * 4) * 0.035;
      holder.position.x += (Math.random() - 0.5) * tremor;
      holder.position.y += (Math.random() - 0.5) * tremor;
      holder.rotation.z += (Math.random() - 0.5) * tremor * 1.5;
      holder.rotation.x = (Math.random() - 0.5) * tremor;
    } else holder.rotation.x = 0;
    /* the light behind: rising with the grinding, flickering; a flare as it breaks free; then a slow breath */
    const breath = 0.8 + 0.2 * Math.sin(t * 1.6);
    const flicker = 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.1);
    const flare = Math.exp(-Math.pow((since - WAIT - OUT) / 0.25, 2));
    const leak = out * (grind ? flicker : 1) * (1 - free) + free * breath * 0.85 + flare * 1.6;
    haloMat.opacity = Math.min(1.6, leak) * 0.9;
    holeLight.intensity = leak * 1.8;
    /* the wall opens round the piece as it starts to move, and the hollow behind it fills with light */
    hole.uHoleOn.value = ready && out > 0 ? 1 : 0;
    uLight.value = (out * 0.6 + free * 0.5) * breath + flare * 0.8;
    /* the words on the wall light up as you arrive */
    cardU.uTextLight.value = THREE.MathUtils.smoothstep(since, 0.4, 2) * (0.9 + 0.1 * Math.sin(t * 1.1));
    /* a logo's letters wake as it comes out, and burn full once it is free */
    pieceU.uRuneLight.value = out * 0.45 + free * 0.55 + flare * 0.6;
    if (eyes.visible) litoLetters.update(dt);
    else if (pieceU.uRuneOn.value) runeLogos.get(current)?.update(dt, null, false);
    /* Lito's eyes light as it comes free, and keep a slow pulse */
    const lit = free * (0.85 + 0.15 * Math.sin(t * 1.7));
    eyeMat.emissiveIntensity = lit * 0.8;
    eyeLight.intensity = eyes.visible ? lit * 0.5 : 0;
    /* the glow in Lito's eyes follows the pointer */
    uLook.value.lerp(look.set(ndc.x * 0.06, ndc.y * 0.05), Math.min(1, dt * 6));
    flyBits(dt);
    /* the words open where the stone breaks away and falls, then are left as they are */
    fallGrit(dt);
    if (cardHit && carved <= cardHit.end) {
      const was = carved;
      carved += dt;
      for (const g of cardHit.glyphs) {
        const at = g.turn ?? g.at;
        if (at > was && at <= carved && g.ch.trim()) {
          const px = g.x + g.w / 2, py = g.y + g.size * 0.55;
          crumbleAt(CX + (px / TW - 0.5) * CW, CY + (0.5 - py / TH) * CH, (g.w / TW) * CW, ((g.size * 0.8) / TH) * CH);
        }
      }
      carveAcc += dt;
      /* the picture is big: cut in two dozen times a second, which is all the eye needs */
      if (carveAcc >= 1 / 24 || carved > cardHit.end) {
        carveAcc = 0;
        drawCard(cardCtx, cardHit, carved);
        cardTex.needsUpdate = true;
      }
    }
    /* the button: rising under the pointer, sinking when pressed, its cross and ring burning brighter as it rises */
    btnHot += ((hotClose ? 1 : 0) - btnHot) * Math.min(1, dt * 10);
    if (btnPress >= 0) btnPress += dt;
    const sink = btnPress >= 0 ? Math.sin(Math.min(1, btnPress / 0.35) * Math.PI) : 0;
    /* out of the wall with the piece (hidden in the stone until then), back into its place once pressed */
    const back = btnPress >= 0 ? THREE.MathUtils.smoothstep(btnPress, 0, 0.45) : 0;
    const btnOut = ready ? out : THREE.MathUtils.smoothstep(since, WAIT, WAIT + OUT);
    button.position.z = BTN.z - 0.2 + (btnOut * 0.2 + btnHot * 0.05) * (1 - back) - sink * 0.02;
    const tremor = broke >= 0 ? Math.exp(-broke * 4) * 0.012 : 0;
    button.position.x = BTN.x + (Math.random() - 0.5) * (grind * 0.004 + tremor);
    button.position.y = BTN.y + (Math.random() - 0.5) * (grind * 0.004 + tremor);
    const btnLight = btnOut * (1 - back) * (0.55 + 0.15 * Math.sin(t * 2) + btnHot * 0.9 + (broke >= 0 ? Math.exp(-broke * 3) * 1.2 : 0));
    crossMat.color.copy(uGlow.value).multiplyScalar(btnLight * 1.4);
    btnRingMat.color.copy(uGlow.value);
    btnRingMat.opacity = btnLight * 0.7;
  };
  const resize = (aspect: number) => { camera.aspect = aspect; camera.updateProjectionMatrix(); };

  return { scene, camera, update, resize, enter, useProjects, setCard, hit, linkHref, pressClose };
}
