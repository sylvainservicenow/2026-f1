/* ------------------------------------------------------------------ *
 * Race Control 360 — track path helpers for vehicles
 *
 * Pure geometry on the Grand Prix loop in world metres. Nothing here
 * generates positions; callers must supply real ones (see servicenow.js).
 * ------------------------------------------------------------------ */
import {CIRCUIT as C} from './circuit-data.js';

const pts = [];
for (let i = 0; i < C.loop.length; i += 2) pts.push([C.loop[i], C.loop[i + 1]]);
const cum = [0];
for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
export const LOOP_LENGTH_M = cum[cum.length - 1];

/** Point and heading (radians, world frame) at `d` metres along the loop; wraps. */
export function pointAt(d) {
  const t = ((d % LOOP_LENGTH_M) + LOOP_LENGTH_M) % LOOP_LENGTH_M;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= t) lo = m;
    else hi = m;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (t - cum[lo]) / seg;
  const [x0, y0] = pts[lo];
  const [x1, y1] = pts[hi];
  return {x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, heading: Math.atan2(y1 - y0, x1 - x0)};
}

/** Closest loop point to a world position, with its heading and distance from the track centreline. */
export function nearestOnLoop(x, y) {
  let best = {d2: Infinity, i: 0, f: 0};
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const dx = pts[i + 1][0] - x0;
    const dy = pts[i + 1][1] - y0;
    const l2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
    const px = x0 + dx * f;
    const py = y0 + dy * f;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < best.d2) best = {d2, i, f, px, py, heading: Math.atan2(dy, dx), along: cum[i] + f * Math.sqrt(l2)};
  }
  return {x: best.px, y: best.py, heading: best.heading, offsetM: Math.sqrt(best.d2), alongM: best.along};
}
