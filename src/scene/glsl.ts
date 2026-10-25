/** Value noise and fbm in 3D, shared by the stone vertex and fragment shaders. */
export const NOISE3 = /* glsl */ `
float h3(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * n3(p); p = p * 2.03 + 17.; a *= .5; } return v; }
`;

/**
 * Per-instance stone shape: a unit cube rounded in its own proportions, made lumpy, chipped and bitten.
 * `aSize` is the stone's size in world units, `aMisc.y` its random seed.
 */
export const STONE_SHAPE = /* glsl */ `
attribute vec3 aSize; attribute vec3 aHome; attribute vec2 aMisc;
${NOISE3}
vec3 stoneP(vec3 p, vec3 fn, out vec3 dir){
  vec3 sz = max(aSize, vec3(.001));
  float m = min(min(sz.x, sz.y), sz.z);
  vec3 R = min(vec3(.2) * m / sz, vec3(.45));
  vec3 q = clamp(p, -.5 + R, .5 - R);
  vec3 d = (p - q) / R;
  dir = dot(d, d) > 1e-6 ? normalize(d) : fn;
  vec3 pr = q + dir * R;
  vec3 w = p * sz;
  float lump = fbm3(w * 1.6 + aMisc.y * 31.) - .5;
  float chip = smoothstep(.56, .82, n3(w * 5.5 + aMisc.y * 11.));
  float bite = smoothstep(.62, .9, n3(w * 2.4 + aMisc.y * 7.));
  float amt = m * (lump * .16 - chip * .06 - bite * .12);
  return pr + dir * amt / sz;
}
vec3 stoneP(vec3 p, vec3 fn){ vec3 dir; return stoneP(p, fn, dir); }
`;

/**
 * Displaced position and its normal. The normal measured on the displaced surface is only trusted where it agrees with
 * the rounded box's own normal: GPUs round the noise hash a little differently per call, which can tip the measured
 * normal far off and leave whole faces unlit.
 */
export const STONE_VERTEX = /* glsl */ `
vec3 sDir;
vec3 sp0 = stoneP(position, normal, sDir);
vec3 t1 = abs(normal.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.);
vec3 t2 = normalize(cross(normal, t1)); t1 = cross(t2, normal);
vec3 spA = stoneP(position + t1 * .015, normal), spB = stoneP(position + t2 * .015, normal);
vec3 snW = normalize(cross((spA - sp0) * aSize, (spB - sp0) * aSize));
if (dot(snW, sDir) < 0.) snW = -snW;
snW = normalize(mix(sDir, snW, smoothstep(.8, .95, dot(snW, sDir))));
/* the instance matrix scales normals by 1 / aSize, so the local normal is the world one times aSize */
vec3 sn = normalize(snW * max(aSize, vec3(.001)));
`;

/** Albedo: pale weathered limestone, cracks, pits, and the rune cut into the front face (8 × 8 atlas, R = cut, G = halo). */
export const STONE_COLOR = /* glsl */ `
vec3 w = vLocal * vSize * 3. + vMisc.y * 19.;
float nA = fbm3(w * 1.4);
float crack = (1. - smoothstep(.0, .05, abs(n3(w * 1.9) - .5))) * smoothstep(.45, .7, n3(w * .7 + 3.));
crack = max(crack, (1. - smoothstep(.0, .04, abs(n3(w * 3.2 + 9.) - .5))) * smoothstep(.55, .8, n3(w * 1.3 + 5.)) * .7);
crack *= 1. - vHome.z;
float pits = smoothstep(.6, .85, fbm3(w * 3.5));
vec3 stoneC = mix(vec3(.085, .077, .066), vec3(.145, .13, .112), smoothstep(.2, .8, fbm3(w * .4)));
stoneC *= (.84 + .32 * nA) * (1. - .3 * pits) * (1. - .6 * crack);
/* fine grain: mineral speckle, faded out where a stone is too small on screen to show it without shimmering */
float fine = 1. - smoothstep(.25, .7, length(fwidth(w)) * 14.);
stoneC *= 1. + (n3(w * 22.) - .5) * .35 * fine + (n3(w * 61.) - .5) * .2 * fine;
/* weathering: darker streaks where rain ran down the stone */
stoneC *= 1. - .14 * smoothstep(.55, .85, n3(vec3(w.x * 2.5, w.y * .3, w.z * 2.5) + 11.)) * smoothstep(.4, .7, n3(w * .8 + 4.));
float side = min(vSize.x, vSize.y) * .76;
vec2 guv = vLocal.xy * vSize.xy / side + .5;
float inG = step(0., guv.x) * step(guv.x, 1.) * step(0., guv.y) * step(guv.y, 1.) * step(.47, vLocal.z);
vec2 cellXY = vec2(mod(vMisc.x, 8.), floor(vMisc.x / 8.));
/* vHome.z: how much the stone still lies in the ground, where it shows no rune */
vec4 rt = (1. - vHome.z) * texture2D(uRunes, vec2((cellXY.x + guv.x) / 8., (7. - cellXY.y + guv.y) / 8.)) * inG;
float rune = rt.r;
/* the cut: sloped walls from the B profile, a floor in shade; the light comes from its bottom (see the emissive part) */
float carve = rt.b;
float core = rune * smoothstep(.3, .75, carve);
diffuseColor.rgb = stoneC * (1. - carve * .5);
/* still in the ground, the stone wears the ground's own surface, so it can't be told apart until it breaks free */
if (vHome.z > 0.) { float bc, bm, bf; diffuseColor.rgb = mix(diffuseColor.rgb, groundAlbedo(vWPos, bc, bm, bf) * (1. - groundRune(vWPos).b * .5), vHome.z); }
`;

/** Fine relief from cracks, pits and the rune, applied with screen-space derivatives. */
export const STONE_RELIEF = /* glsl */ `
float sBh = -crack * .8 - pits * .3 + (fbm3(w * 3.) - .5) * .4 - carve * 1.1
          + ((fbm3(w * 9.) - .5) * .5 + (n3(w * 28.) - .5) * .25) * fine;
vec3 sVp = -vViewPosition; vec3 sDpx = dFdx(sVp); vec3 sDpy = dFdy(sVp);
float sDhx = dFdx(sBh); float sDhy = dFdy(sBh);
vec3 sR1 = cross(sDpy, normal); vec3 sR2 = cross(normal, sDpx);
float sDet = dot(sDpx, sR1);
vec3 sGrad = sign(sDet) * (sDhx * sR1 + sDhy * sR2) * .007;
/* cap the tilt (about 35°) and never let it turn the surface away from the camera, where it would light black */
float sLim = abs(sDet) * .7, sLen = length(sGrad);
if (sLen > sLim) sGrad *= sLim / sLen;
vec3 sN = normalize(abs(sDet) * normal - sGrad);
if (dot(sN, normalize(vViewPosition)) > .05) normal = sN;
`;

/** Moss on up-facing surfaces and in cracks, then the turquoise light in runes and cracks. */
export const STONE_EMISSIVE = /* glsl */ `
vec3 wn = normalize((vec4(normal, 0.) * viewMatrix).xyz);
float moss = smoothstep(.15, .75, wn.y) * smoothstep(.42, .66, fbm3(w * 1.8 + 5.));
moss = max(moss, crack * smoothstep(.4, .7, fbm3(w * 2.6)) * .9);
moss = clamp(moss * (1. - inG * .7), 0., 1.) * (1. - vHome.z);
vec3 mossC = mix(vec3(.06, .10, .025), vec3(.16, .24, .06), fbm3(w * 5.));
diffuseColor.rgb = mix(diffuseColor.rgb, mossC, moss);
roughnessFactor = mix(roughnessFactor, .72, moss);
float dm = length(vWPos.xy - uMouse.xy);
float near = exp(-dm * dm * 1.3) * uHas;
float sx = ((1. - uSweep) * 1.5 - .25) * 2. * uView.x - uView.x;
float sweep = step(.001, uSweep) * exp(-pow((vHome.x - sx) / uView.x * 4.5, 2.));
float idle = smoothstep(.93, 1., sin(uTime * .7 + vMisc.y * 40.)) * .7;
float glow = clamp(near * 1.9 + sweep * 1.4 + idle + uGate * 2.6, 0., 3.) * (.85 + .15 * sin(uTime * 9. + vMisc.y * 20.));
/* runes smoulder from the bottom of the cut; the pointer, the sweep and the idle flicker light them up fully */
totalEmissiveRadiance += uRune * ((core * 3.6 + rt.g * .5 + crack * .9 * (1. - moss * .6)) * glow + core * .65 + rt.g * .03 + crack * .03);
`;

/**
 * The ground: the very same stone as the stones (their palette, grain, cracks, pits, rain streaks and moss at the same
 * scale), with runes cut into it here and there. Shared by the ground and by stones still lying in it, so the two match.
 * Needs `uRunes` declared before it.
 */
export const GROUND_FN = /* glsl */ `
/* small runes cut into the rock on a loose grid, in about two cells in five, at a random quarter turn (R = cut, G = halo, B = depth) */
vec4 groundRune(vec3 p) {
  vec2 q = p.xz / .9, cell = floor(q);
  float has = step(h3(vec3(cell, 7.)), .4);
  vec2 f = fract(q) - .5;
  float k = floor(h3(vec3(cell, 13.)) * 4.);
  f = k < 1. ? f : k < 2. ? vec2(-f.y, f.x) : k < 3. ? -f : vec2(f.y, -f.x);
  vec2 guv = vec2(f.x, -f.y) / .5 + .5;
  float inside = step(0., guv.x) * step(guv.x, 1.) * step(0., guv.y) * step(guv.y, 1.);
  float g = floor(h3(vec3(cell, 29.)) * 64.);
  vec2 c = vec2(mod(g, 8.), floor(g / 8.));
  return texture2D(uRunes, vec2((c.x + clamp(guv.x, 0., 1.)) / 8., (7. - c.y + clamp(guv.y, 0., 1.)) / 8.)) * has * inside;
}

vec3 groundAlbedo(vec3 p, out float gcrack, out float gmoss, out float gfine) {
  vec3 w = p * 3. + 19.;
  float nA = fbm3(w * 1.4);
  gcrack = (1. - smoothstep(.0, .05, abs(n3(w * 1.9) - .5))) * smoothstep(.45, .7, n3(w * .7 + 3.));
  /* the stones' fine second crack layer, kept faint: spread wide over the ground it would read as dried mud */
  gcrack = max(gcrack, (1. - smoothstep(.0, .04, abs(n3(w * 3.2 + 9.) - .5))) * smoothstep(.55, .8, n3(w * 1.3 + 5.)) * .2);
  float pits = smoothstep(.6, .85, fbm3(w * 3.5));
  vec3 c = mix(vec3(.085, .077, .066), vec3(.145, .13, .112), smoothstep(.2, .8, fbm3(w * .4)));
  c *= (.84 + .32 * nA) * (1. - .3 * pits) * (1. - .6 * gcrack);
  gfine = 1. - smoothstep(.25, .7, length(fwidth(w)) * 14.);
  c *= 1. + (n3(w * 22.) - .5) * .35 * gfine + (n3(w * 61.) - .5) * .2 * gfine;
  c *= 1. - .14 * smoothstep(.55, .85, n3(vec3(w.x * 2.5, w.y * .3, w.z * 2.5) + 11.)) * smoothstep(.4, .7, n3(w * .8 + 4.));
  /* moss as on the stones' upper faces, and in the cracks */
  gmoss = smoothstep(.5, .72, fbm3(w * 1.8 + 5.)) * .3;
  gmoss = max(gmoss, gcrack * smoothstep(.4, .7, fbm3(w * 2.6)) * .9);
  c = mix(c, mix(vec3(.06, .10, .025), vec3(.16, .24, .06), fbm3(w * 5.)), gmoss);
  /* the ground meets the sun square on, the stones' faces at a slant: a little darker so the two read as one stone */
  c *= .45;
  /* and a touch cooler: the stones' faces catch the cool fill light, the ground only the warm sun and sky */
  c *= vec3(.92, .96, 1.07);
  /* the rock is an island of stone under the shapes; away from them it sinks into the dark */
  c *= smoothstep(14., 2., length(p.xz - vec2(0., -2.)));
  return c;
}
`;

/** The ground rock: the shared albedo, then the holes stones left, cut right through it. */
export const GROUND_COLOR = /* glsl */ `
vec3 gw = vGPos * 3. + 19.;
float gcrack, gmoss, gfine;
vec3 groundC = groundAlbedo(vGPos, gcrack, gmoss, gfine);
vec4 grt = groundRune(vGPos);
groundC *= 1. - grt.b * .5;
/* holes left where stones broke out: dark inside, shaded down their walls */
vec4 gh = texture2D(uHoles, vec2((vGPos.x + uHolesRect.x) / uHolesRect.z, 1. - (vGPos.z - uHolesRect.y) / uHolesRect.w));
/* inside a hole there is no ground at all: the pit below shows through */
if (gh.r > .5) discard;
groundC *= 1. - gh.g * .45;
diffuseColor.rgb = groundC;
`;

/** The ground's fine relief, from its cracks and grain, with the same safeguards as the stones'. */
export const GROUND_RELIEF = /* glsl */ `
float gBh = -gcrack * .8 + (fbm3(gw * 3.) - .5) * .4 + ((fbm3(gw * 9.) - .5) * .5 + (n3(gw * 28.) - .5) * .25) * gfine - grt.b * 1.1 - gh.g * 2.5;
vec3 gVp = -vViewPosition; vec3 gDpx = dFdx(gVp); vec3 gDpy = dFdy(gVp);
float gDhx = dFdx(gBh); float gDhy = dFdy(gBh);
vec3 gR1 = cross(gDpy, normal); vec3 gR2 = cross(normal, gDpx);
float gDet = dot(gDpx, gR1);
vec3 gGrad = sign(gDet) * (gDhx * gR1 + gDhy * gR2) * .007;
float gLim = abs(gDet) * .7, gLen = length(gGrad);
if (gLen > gLim) gGrad *= gLim / gLen;
vec3 gN = normalize(abs(gDet) * normal - gGrad);
if (dot(gN, normalize(vViewPosition)) > .05) normal = gN;
`;

/** The ground's runes glow faintly from the bottom of their cuts, like the stones'. */
export const GROUND_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += uRune * grt.r * smoothstep(.3, .75, grt.b) * .45 * smoothstep(20., 3., length(vGPos.xz - vec2(0., -2.)));
/* the opening strike's shock wave: a ring of rune light running out from the impact, lighting runes and cracks as it
   passes, and a short flash of them inside it */
if (uWave.z >= 0.) {
  float wd = length(vGPos.xz - uWave.xy), wr = uWave.z * 7.;
  float ring = exp(-pow((wd - wr) / (.35 + uWave.z * .45), 2.)) * exp(-uWave.z * .7);
  float inside = smoothstep(wr, wr - 3., wd) * exp(-uWave.z * 1.1);
  totalEmissiveRadiance += uRune * uWave.w * (ring * (.35 + grt.r * 4. + gcrack * 2.5) + inside * (grt.r * 1.6 + gcrack * 1.2));
}
`;
