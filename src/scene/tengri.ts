import * as THREE from 'three';
import { NOISE3 } from './glsl';

/*
 * Teŋri's story, written in the sky under its name when it is opened: the opening of the Kül Tigin inscription in
 * Old Turkic and in translation, where it comes from, and a few words on the sky god. It is written in starlight,
 * line after line, each line coming out of the dark from its start to its end with a glint running ahead of it, and
 * fades when closed. The words are given by the page (they follow the language chosen).
 */

export type Story = { quote: string; translation: string; source: string; body: string };

const W = 2048, H = 1152;
/* how long the writing takes, in seconds, once opened */
const TOTAL = 8;

export function createStory(width: number) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  const u = { uTex: { value: tex as THREE.Texture }, uT: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, (width * H) / W), new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */ `
      ${NOISE3}
      uniform sampler2D uTex; uniform float uT; uniform float uFade; uniform float uTime; varying vec2 vUv;
      void main(){
        vec4 s = texture2D(uTex, vUv);
        float ink = s.r, at = s.g, warm = s.b;
        if (ink < .01) discard;
        /* written out as time comes to each part of it, a glint running at the front */
        float k = uT / ${TOTAL.toFixed(1)};
        float shown = smoothstep(at, at + .012, k);
        float front = exp(-pow((k - at) * ${TOTAL.toFixed(1)} * 2.4, 2.)) * step(at, k + .02);
        /* starlight: the letters made of a fine grain of light that twinkles */
        float grain = .78 + .32 * n3(vec3(vUv * vec2(900., 500.), uTime * 1.3));
        vec3 col = mix(vec3(.86, .92, 1.), vec3(1., .86, .62), warm) * grain;
        float a = ink * (shown * .92 + front * 1.4) * uFade;
        gl_FragColor = vec4((col + front * .8) * a, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  }));
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  mesh.visible = false;

  let story: Story | null = null, open = false, drawn = false;

  /* lay the words out: the quote large and warm, its translation, the source small, then the few words, each wrapped
     to the width and centred; each line given its moment to be written, from its first letter to its last */
  const draw = () => {
    if (!story) return;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    const time = document.createElement('canvas');
    time.width = W; time.height = H;
    const t = time.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    t.fillStyle = '#000';
    t.fillRect(0, 0, W, H);
    type Row = { text: string; font: string; size: number; warm: boolean; gap: number; dur: number };
    const rows: Row[] = [];
    const wrap = (text: string, font: string, size: number, warm: boolean, gapAfter: number, dur: number) => {
      c.font = font;
      const words = text.split(' ');
      let line = '';
      const out: string[] = [];
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (c.measureText(next).width > W * 0.9 && line) { out.push(line); line = w; } else line = next;
      }
      if (line) out.push(line);
      out.forEach((l, i) => rows.push({ text: l, font, size, warm, gap: i === out.length - 1 ? gapAfter : size * 0.38, dur: dur / out.length }));
    };
    /* Cinzel is capitals; its small letters lack ğ, ş, ı, so the quote is set in capitals, the Turkish way (i → İ) */
    wrap(story.quote.toLocaleUpperCase('tr'), '700 66px "Cinzel", serif', 66, true, 34, 2.6);
    wrap(story.translation, '500 50px "Hanken Grotesk", sans-serif', 50, false, 26, 1.9);
    wrap(story.source, '500 28px "JetBrains Mono", monospace', 28, true, 64, 0.6);
    wrap(story.body, '400 44px "Hanken Grotesk", sans-serif', 44, false, 0, 2.4);
    const total = rows.reduce((s, r) => s + r.size + r.gap, 0);
    let y = (H - total) / 2, at = 0.25;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (const r of rows) {
      c.font = r.font;
      if (r.font.includes('Mono')) c.letterSpacing = '6px'; else c.letterSpacing = '0px';
      const w = c.measureText(r.text).width, x0 = (W - w) / 2;
      /* the ink: white for the cool lines, with blue raised for the warm ones (the shader reads it as warmth) */
      c.fillStyle = r.warm ? '#ffffff' : '#ffff00';
      c.fillText(r.text, W / 2, y);
      /* when each part of the line is written: from its start to its end */
      const g = t.createLinearGradient(x0, 0, x0 + w, 0);
      g.addColorStop(0, `rgb(0,${Math.round((at / TOTAL) * 255)},0)`);
      g.addColorStop(1, `rgb(0,${Math.round(((at + r.dur) / TOTAL) * 255)},0)`);
      t.fillStyle = g;
      t.fillRect(x0 - 4, y - 8, w + 8, r.size + 20);
      at += r.dur + 0.15;
      y += r.size + r.gap;
    }
    /* put the two together: red the ink, green its moment, blue its warmth */
    const ink = c.getImageData(0, 0, W, H), when = t.getImageData(0, 0, W, H).data, d = ink.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255, warm = d[i + 2] > 128 ? 1 : 0;
      d[i] = a * 255; d[i + 1] = when[i + 1]; d[i + 2] = warm * 255; d[i + 3] = 255;
    }
    c.putImageData(ink, 0, 0);
    tex.needsUpdate = true;
    drawn = true;
  };

  return {
    mesh,
    /** the words, in the language chosen; drawn once the fonts are there */
    set(s: Story) {
      story = s;
      drawn = false;
      void Promise.all(['700 66px "Cinzel"', '500 50px "Hanken Grotesk"', '400 44px "Hanken Grotesk"', '500 28px "JetBrains Mono"'].map((f) => document.fonts.load(f)))
        .catch(() => null)
        .then(() => { if (story === s) draw(); });
    },
    /** written out (from the start), or faded away */
    open(on: boolean) {
      if (on && !open) u.uT.value = 0;
      open = on;
    },
    update(dt: number) {
      u.uTime.value += dt;
      if (open && drawn) u.uT.value = Math.min(TOTAL + 1, u.uT.value + dt);
      u.uFade.value += ((open ? 1 : 0) - u.uFade.value) * Math.min(1, dt * (open ? 2 : 3));
      mesh.visible = u.uFade.value > 0.004;
    },
  };
}
