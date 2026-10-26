/*
 * The places the story goes through, one after another: Göbeklitepe's warm limestone hill in Upper Mesopotamia, the
 * Orkhon valley's steppe under the Mongolian mountains, and home, the dark rock with runes cut in it where everything
 * from "METİN" on happens. Going from one to the next the view flies low over the ground like a bird, and on the way
 * the ground's colour, its grass, the haze and the land rising far off turn from the one place's to the other's.
 */
export type Region = 'home' | 'gobekli' | 'orkhon';

export type Look = {
  /** the ground's colour, multiplied in; how much steppe grass is on it; whether it is home (its runes and holes) */
  tint: [number, number, number]; grass: number; home: number;
  fog: number; density: number;
  /** the land far off rising out of the ground itself: how high, and how sharp its peaks (0 rolling, 1 mountains) */
  ridge: number; peaks: number;
};

export const LOOKS: Record<Region, Look> = {
  home: { tint: [1, 1, 1], grass: 0, home: 1, fog: 0x161a21, density: 0.034, ridge: 0, peaks: 0 },
  /* a pale warm hilltop, low rounded hills round it */
  gobekli: { tint: [1.42, 1.18, 0.86], grass: 0, home: 0, fog: 0x1d1a17, density: 0.03, ridge: 2.2, peaks: 0 },
  /* dry steppe grass, and mountains standing far off */
  orkhon: { tint: [0.5, 0.6, 0.38], grass: 0.9, home: 0, fog: 0x121822, density: 0.031, ridge: 4.5, peaks: 1 },
};

export const regionOf = (site: string | undefined): Region => (site === 'gobekli' ? 'gobekli' : site === 'orkhon' ? 'orkhon' : 'home');

/**
 * The far land, raised in the ground's own vertex shader (so it takes the ground's light and the haze as the ground
 * does): nothing near, rising from 32 units back, out where the haze has them; broad swells, and sharp ridged peaks over them for mountains.
 * Needs NOISE3. `uRidge` is (height, peaks).
 */
export const RIDGE = /* glsl */ `
uniform vec2 uRidge;
float ridgeAt(vec2 p) {
  if (uRidge.x <= 0.) return 0.;
  float far = smoothstep(-32., -48., p.y) * (1. - smoothstep(30., 44., abs(p.x)) * .5);
  float broad = fbm3(vec3(p * .07, 3.));
  float peak = 1. - abs(fbm3(vec3(p * .16, 9.)) * 2. - 1.);
  return far * uRidge.x * (broad * (1. - uRidge.y * .4) + peak * peak * uRidge.y * .9);
}
`;
