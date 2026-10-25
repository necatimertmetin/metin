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

/*
 * Trakya University's rectorate in Edirne, the old Karaağaç station: the long two-storey wings with their arched
 * windows and chimneys, the tall entrance block with its great arch under a hipped roof, the two domes with their
 * spires, and the flag between them. Drawn in the photo's own pixels (1440 across, ground at 635) and scaled to fit.
 */
export const university = stoneDraw((ctx, { cx, cy, w, h }) => {
  const W = 1440, TOP = 190, GROUND = 636, s = Math.min(w / W, h / (GROUND - TOP));
  const X = (x: number) => cx + (x - W / 2) * s, Y = (y: number) => cy + (y - (TOP + GROUND) / 2) * s;
  const rect = (x0: number, y0: number, x1: number, y1: number) => ctx.fillRect(X(x0), Y(y0), (x1 - x0) * s, (y1 - y0) * s);
  const poly = (...p: number[]) => {
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) ctx.lineTo(X(p[i]), Y(p[i + 1]));
    ctx.closePath();
    ctx.fill();
  };
  /* an arched opening: straight sides, a round top */
  const arch = (x0: number, y0: number, x1: number, y1: number) => {
    const r = (x1 - x0) / 2;
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(y1));
    ctx.lineTo(X(x0), Y(y0 + r));
    ctx.arc(X(x0 + r), Y(y0 + r), r * s, Math.PI, 0);
    ctx.lineTo(X(x1), Y(y1));
    ctx.closePath();
    ctx.fill();
  };
  const dome = (x: number) => {
    rect(x - 44, 318, x + 44, 392); // the drum
    poly(x - 70, 334, x + 70, 334, x + 58, 312, x - 58, 312); // its eaves
    ctx.beginPath();
    ctx.ellipse(X(x), Y(310), 54 * s, 66 * s, 0, Math.PI, 0); // the dome
    ctx.fill();
    rect(x - 4, 200, x + 4, 252); // the spire
    ctx.beginPath();
    ctx.arc(X(x), Y(232), 8 * s, 0, Math.PI * 2);
    ctx.fill();
  };

  /* the wings: walls, the roof over them, the pavilions at the ends, the chimneys */
  rect(0, 428, W, GROUND);
  poly(0, 430, 0, 400, 40, 384, 1400, 384, W, 400, W, 430);
  [[12, 350, 76, 410], [112, 362, 128, 392], [148, 356, 162, 412], [322, 352, 340, 404], [456, 360, 472, 406], [512, 362, 530, 392],
    [562, 352, 576, 410], [924, 352, 940, 410], [968, 364, 986, 392], [1022, 362, 1044, 406], [1156, 360, 1174, 406], [1300, 368, 1316, 392],
    [1330, 352, 1346, 414]].forEach(([a, b, c, d]) => rect(a, b, c, d));
  /* the entrance block and its hipped roof */
  rect(616, 372, 882, GROUND);
  poly(578, 368, 700, 306, 792, 306, 922, 368, 906, 392, 594, 392);
  dome(607);
  dome(890);
  /* the flag on its pole */
  rect(743, 204, 749, 310);
  poly(749, 204, 768, 206, 768, 228, 749, 226);

  /*
   * cut out: the windows, two rows of arches along each wing (six a side rather than the real nine, wider, so each
   * still reads at the size of a stone); the doors below; the great arch
   */
  ctx.globalCompositeOperation = 'destination-out';
  const left = [60, 150, 240, 330, 420, 510], right = [950, 1040, 1130, 1220, 1310, 1400];
  [...left, ...right].forEach((x) => {
    arch(x - 22, 448, x + 22, 506);
    arch(x - 22, 550, x + 22, 630);
  });
  /* a line of shadow under the eaves, and either side of the entrance block, so the parts read apart */
  rect(0, 424, 606, 438);
  rect(892, 424, W, 438);
  rect(600, 438, 614, GROUND);
  rect(884, 438, 898, GROUND);
  arch(680, 432, 822, GROUND);
  ctx.globalCompositeOperation = 'source-over';
  /* the transom across the great arch, and its doors' frame */
  rect(680, 572, 822, 584);
}, { rows: 32, maxW: 0.92, maxH: 0.5, vines: 0.12 });
