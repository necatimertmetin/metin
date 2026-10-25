import * as THREE from 'three';

/*
 * The ground: one great rock the stones break away from. Its height is shared by the mesh and by the stones,
 * so a stone that falls rests on the rock exactly where it lands.
 */

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, z: number) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) { v += a * noise(x, z); x = x * 2.03 + 17; z = z * 2.03 + 17; a *= 0.5; }
  return v;
}

/**
 * Height of the rock above its base at (x, z): nearly level under the stones, rougher further out,
 * rising into low ridges towards the horizon.
 */
export function groundHeight(x: number, z: number) {
  const out = THREE.MathUtils.smoothstep(Math.hypot(x * 0.55, z), 4, 14);
  const rough = (fbm(x * 0.12, z * 0.12) - 0.5) * 1.6 + (fbm(x * 0.6, z * 0.6) - 0.5) * 0.3;
  return rough * (0.12 + 0.88 * out) + Math.max(0, -z - 16) * 0.12;
}

/** The rock's mesh, sized to run from in front of the camera to past the fog; its y is the rock's base. */
export function createGroundGeometry() {
  const geo = new THREE.PlaneGeometry(90, 64, 220, 160);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -18);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  return geo;
}
