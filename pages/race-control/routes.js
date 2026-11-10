/* ------------------------------------------------------------------ *
 * Race Control 360 — response routes over mapped service roads
 *
 * Routes are computed from OpenStreetMap service / emergency-access roads (circuit-data.js), in the same world
 * metre coordinate system as everything else. A road segment that crosses the circuit centreline is never used,
 * so a response vehicle never takes a shortcut over the track. If no such route exists, routeBetween() returns
 * null and the UI shows the destination only. Nothing is invented.
 * ------------------------------------------------------------------ */
import {CIRCUIT as C} from './circuit-data.js';

const GRID = 3;
const key = (x, y) => `${Math.round(x / GRID)},${Math.round(y / GRID)}`;

const loop = [];
for (let i = 0; i < C.loop.length; i += 2) loop.push([C.loop[i], C.loop[i + 1]]);

const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
const crosses = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

/** True if the segment a-b crosses the circuit centreline. */
export function crossesTrack(a, b) {
  // cheap bounding test first
  const minx = Math.min(a[0], b[0]) - 1;
  const maxx = Math.max(a[0], b[0]) + 1;
  const miny = Math.min(a[1], b[1]) - 1;
  const maxy = Math.max(a[1], b[1]) + 1;
  for (let i = 0; i < loop.length - 1; i++) {
    const c = loop[i];
    const d = loop[i + 1];
    if (Math.max(c[0], d[0]) < minx || Math.min(c[0], d[0]) > maxx || Math.max(c[1], d[1]) < miny || Math.min(c[1], d[1]) > maxy) continue;
    if (crosses(a, b, c, d)) return true;
  }
  return false;
}

let graph = null;
function build() {
  const nodes = new Map();
  const list = [];
  const node = (x, y) => {
    const k = key(x, y);
    let n = nodes.get(k);
    if (!n) {
      n = {id: list.length, x, y, adj: []};
      nodes.set(k, n);
      list.push(n);
    }
    return n;
  };
  const ways = C.emergency.concat(C.service.filter(s => s.hw === 'service' || s.hw === 'track' || s.hw === 'unclassified'));
  ways.forEach(w => {
    let prev = null;
    for (let i = 0; i < w.pts.length; i += 2) {
      const cur = [w.pts[i], w.pts[i + 1]];
      if (prev) {
        // densify long segments so junction snapping stays reliable
        const len = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
        const steps = Math.max(1, Math.round(len / 8));
        let last = prev;
        for (let s = 1; s <= steps; s++) {
          const p = [prev[0] + ((cur[0] - prev[0]) * s) / steps, prev[1] + ((cur[1] - prev[1]) * s) / steps];
          if (!crossesTrack(last, p)) {
            const a = node(last[0], last[1]);
            const b = node(p[0], p[1]);
            if (a !== b) {
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              a.adj.push([b.id, d]);
              b.adj.push([a.id, d]);
            }
          }
          last = p;
        }
      }
      prev = cur;
    }
  });
  graph = list;
}

const nearest = (x, y) => {
  let best = null;
  let bd = Infinity;
  graph.forEach(n => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) {
      bd = d;
      best = n;
    }
  });
  return {node: best, dist: bd};
};

const cache = new Map();

/** Route as a polyline of world points, or null when no safe mapped route exists. */
export function routeBetween(from, to) {
  const ck = `${Math.round(from[0])},${Math.round(from[1])}>${Math.round(to[0])},${Math.round(to[1])}`;
  if (cache.has(ck)) return cache.get(ck);
  if (!graph) build();
  let result = null;
  const a = nearest(from[0], from[1]);
  const b = nearest(to[0], to[1]);
  if (a.node && b.node && a.dist <= 90 && b.dist <= 90 && !crossesTrack(from, [a.node.x, a.node.y]) && !crossesTrack([b.node.x, b.node.y], to)) {
    const dist = new Array(graph.length).fill(Infinity);
    const prev = new Array(graph.length).fill(-1);
    dist[a.node.id] = 0;
    const open = [[0, a.node.id]];
    while (open.length) {
      open.sort((p, q) => p[0] - q[0]);
      const [d, u] = open.shift();
      if (d > dist[u]) continue;
      if (u === b.node.id) break;
      graph[u].adj.forEach(([v, w]) => {
        if (d + w < dist[v]) {
          dist[v] = d + w;
          prev[v] = u;
          open.push([dist[v], v]);
        }
      });
    }
    if (Number.isFinite(dist[b.node.id])) {
      const pts = [];
      for (let u = b.node.id; u !== -1; u = prev[u]) pts.push([graph[u].x, graph[u].y]);
      pts.reverse();
      result = pathOf([from, ...pts, to]);
    }
  }
  cache.set(ck, result);
  return result;
}

function pathOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return {pts, cum, length: cum[cum.length - 1]};
}

/** Point along a route at `s` metres (clamped). */
export function pointOnRoute(route, s) {
  const t = Math.min(Math.max(s, 0), route.length);
  let lo = 0;
  let hi = route.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (route.cum[m] <= t) lo = m;
    else hi = m;
  }
  const seg = route.cum[hi] - route.cum[lo] || 1;
  const f = (t - route.cum[lo]) / seg;
  const [x0, y0] = route.pts[lo];
  const [x1, y1] = route.pts[hi];
  return {x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f};
}
