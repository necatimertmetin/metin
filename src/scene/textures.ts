import * as THREE from 'three';

/** All Old Turkic (Orkhon) letters, U+10C00 to U+10C48. */
export const GLYPHS: string[] = [];
for (let c = 0x10c00; c <= 0x10c48; c++) GLYPHS.push(String.fromCodePoint(c));

export const RUNE_FONT = '"Noto Sans Old Turkic", sans-serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/**
 * 8 × 8 atlas, one letter per cell: R = the cut, G = a blurred halo for the glow, B = a narrow blur that gives the
 * cut sloped walls (its depth profile).
 * Each letter is measured, scaled to the same size and centred on its ink, and kept inside its own cell.
 */
export function createRuneAtlas() {
  const cell = 128, n = 8;
  const [cv, c] = canvas(cell * n, cell * n);
  const tex = new THREE.CanvasTexture(cv);
  const draw = () => {
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.fillRect(0, 0, cell * n, cell * n);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = `${cell}px ${RUNE_FONT}`;
    c.globalCompositeOperation = 'lighter';
    const all = (color: string) => {
      c.fillStyle = color;
      for (let i = 0; i < n * n; i++) {
        const g = GLYPHS[i % GLYPHS.length], m = c.measureText(g);
        const l = m.actualBoundingBoxLeft, r = m.actualBoundingBoxRight, a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
        const k = Math.min((cell * 0.56) / Math.max(1, l + r), (cell * 0.62) / Math.max(1, a + d));
        c.save();
        c.beginPath();
        c.rect((i % n) * cell, Math.floor(i / n) * cell, cell, cell);
        c.clip();
        c.translate((i % n + 0.5) * cell, (Math.floor(i / n) + 0.5) * cell);
        c.scale(k, k);
        c.fillText(g, (l - r) / 2, (a - d) / 2);
        c.restore();
      }
    };
    all('#f00');
    c.filter = 'blur(2.5px)';
    all('#00f');
    c.filter = 'blur(8px)';
    all('#0f0');
    c.filter = 'none';
    tex.needsUpdate = true;
  };
  draw();
  return { texture: tex, redraw: draw };
}

/** One leaf with veins, transparent around it. */
export function createLeafTexture() {
  const [cv, c] = canvas(256, 256);
  c.translate(128, 128);
  c.rotate(-Math.PI / 4);
  const g = c.createLinearGradient(-100, 0, 100, 0);
  g.addColorStop(0, '#2c4a17');
  g.addColorStop(0.6, '#4f7a25');
  g.addColorStop(1, '#93ad48');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-110, 0);
  c.bezierCurveTo(-60, -62, 60, -58, 112, 0);
  c.bezierCurveTo(60, 58, -60, 62, -110, 0);
  c.fill();
  c.strokeStyle = 'rgba(210,230,140,.55)';
  c.lineWidth = 3.5;
  c.beginPath();
  c.moveTo(-104, 0);
  c.lineTo(108, 0);
  c.stroke();
  c.lineWidth = 1.6;
  for (let v = -80; v < 90; v += 22) {
    c.beginPath();
    c.moveTo(v, 0); c.quadraticCurveTo(v + 16, -18, v + 30, -36);
    c.moveTo(v, 0); c.quadraticCurveTo(v + 16, 18, v + 30, 36);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Near-black backdrop with a faint lift in the middle, dithered so the gradient does not band. */
export function createBackdrop() {
  const [cv, c] = canvas(1024, 576);
  c.fillStyle = '#07080a';
  c.fillRect(0, 0, 1024, 576);
  const g = c.createRadialGradient(512, 230, 10, 512, 230, 700);
  g.addColorStop(0, 'rgba(70,64,56,.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 576);
  const id = c.getImageData(0, 0, 1024, 576);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 5;
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n;
  }
  c.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Environment for ambient light and reflections: a daylight sky, a pale horizon, earth below, the sun up and to the left. */
export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const [cv, c] = canvas(512, 256);
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#7f93ad');
  g.addColorStop(0.45, '#c9bfae');
  g.addColorStop(0.55, '#5e5244');
  g.addColorStop(1, '#2a241d');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 256);
  const s = c.createRadialGradient(150, 50, 2, 150, 50, 90);
  s.addColorStop(0, '#fff2d8');
  s.addColorStop(0.3, '#c89a63');
  s.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = s;
  c.fillRect(0, 0, 512, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  tex.dispose();
  return env;
}

/**
 * The face of a slab: R = the cut, G = a blurred halo, B = the cut's depth profile, like the rune atlas
 * but one picture across the whole face.
 * The texture stays square; `paint` draws on a canvas shaped like the face, which is stretched to fill it,
 * and the slab's own proportions stretch it back.
 */
export function createInscription() {
  const size = 2048;
  const [cv, c] = canvas(size, size);
  const [mask, m] = canvas(size, size);
  const [tint, t] = canvas(size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  const layer = (color: string) => {
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, size, size);
    t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = color;
    t.fillRect(0, 0, size, size);
    return tint;
  };
  const paint = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, aspect: number) => {
    const h = size / aspect;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, size, size);
    m.setTransform(1, 0, 0, aspect, 0, 0);
    m.fillStyle = m.strokeStyle = '#fff';
    draw(m, size, h);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.fillRect(0, 0, size, size);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(layer('#f00'), 0, 0);
    c.filter = 'blur(5px)';
    c.drawImage(layer('#00f'), 0, 0);
    c.filter = 'blur(14px)';
    c.drawImage(layer('#0f0'), 0, 0);
    c.filter = 'none';
    tex.needsUpdate = true;
  };
  return { texture: tex, paint };
}
