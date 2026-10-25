import { stoneDraw, stonePath } from './shapes';

/*
 * Ready-made marks for the stones, drawn in white on the shape canvas.
 * Strokes are kept thick (about a tenth of the mark) so every line is at least a stone wide.
 */

/** A mouse pointer. */
export const cursorArrow = stonePath('M0 0 L0 17 L4.5 12.5 L7.5 19.5 L10.5 18 L7.5 11.5 L13 11.5 Z', [13, 19.5], { rows: 14, maxH: 0.56 });

/** A stele with lines of inscription cut across it, the shape of the Orkhon monuments. */
export const stele = stoneDraw((ctx, { cx, cy, h }) => {
  const sh = h, sw = h * 0.5, x = cx - sw / 2, y = cy - sh / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + sh);
  ctx.lineTo(x, y + sw * 0.45);
  ctx.quadraticCurveTo(x, y, cx, y);
  ctx.quadraticCurveTo(x + sw, y, x + sw, y + sw * 0.45);
  ctx.lineTo(x + sw, y + sh);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) ctx.fillRect(x + sw * 0.18, y + sh * (0.3 + i * 0.13), sw * 0.64, sh * 0.045);
  ctx.globalCompositeOperation = 'source-over';
}, { rows: 22, maxH: 0.66 });
