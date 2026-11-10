/* ------------------------------------------------------------------ *
 * Race Control 360 — scene builder
 *
 * One coordinate system for everything:
 *   world (x, y)  = metres east / metres south of 43.2525 N, 5.7915 E
 *   ground group  = world scaled by (1, GROUND_Y)  -> 2.5D camera, ~70 deg pitch
 *   vertical z    = screen offset  -z * VZ          -> extruded buildings / markers
 *
 * Future overlays (vehicles, incidents) must use project(x, y, z) below so they
 * line up with the track, buildings and facilities.
 *
 * All geometry is static OpenStreetMap data (see circuit-data.js). Building
 * heights are STYLISED estimates for rendering only and are never presented as
 * surveyed values.
 * ------------------------------------------------------------------ */
import {CIRCUIT as C} from './circuit-data.js';

export const PITCH_DEG = 70;
export const GROUND_Y = Math.sin((PITCH_DEG * Math.PI) / 180);
/** Screen units per metre of stylised height (physically cos(70deg)=0.34; lifted for legibility). */
export const VZ = 0.6;
export const TRACK_W = C.meta.trackWidthM;

/** Project a world point (metres) plus optional height (m) into view-space units. */
export const project = (x, y, z = 0) => [x, y * GROUND_Y - z * VZ];

const pairs = a => {
  const o = [];
  for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]);
  return o;
};
const r1 = n => Math.round(n * 10) / 10;
const dPath = (pts, close = false) => `M${pts.map(p => `${r1(p[0])} ${r1(p[1])}`).join('L')}${close ? 'Z' : ''}`;
const dMulti = polys => polys.map(p => dPath(p, true)).join('');
const lenOf = pts => {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return s;
};
const shoelace = pts => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};
const centroid = pts => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const hex = (r, g, b) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (c1, c2, t) => hex(c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t);

const loop = pairs(C.loop);
const pitWays = C.pit.map(p => ({id: p.id, pts: pairs(p.pts)}));
const bounds = (() => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = ([x, y]) => {
    const [, sy] = project(x, y);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  };
  loop.forEach(add);
  C.runoff.forEach(r => pairs(r.pts).forEach(add));
  pitWays.forEach(p => p.pts.forEach(add));
  return {x0, y0, x1, y1};
})();
export const SCENE_BOUNDS = bounds;

/* ---------------------------------------------------------------- buildings */
const ROOF_TONES = [[232, 230, 223], [219, 223, 226], [229, 224, 212], [208, 215, 222]];
const WALL_LIT = [247, 245, 238];
const WALL_SHADE = [158, 153, 142];
const LIGHT = [-0.62, -0.78]; // unit vector pointing toward the sun (NW)
const SHADOW_DIR = [0.55, 0.78]; // ground direction of cast shadows (SE)

function extrudeBuilding(b) {
  const g = pairs(b.pts);
  if (g.length < 3) return null;
  const sign = shoelace(g) >= 0 ? 1 : -1;
  const base = g.map(([x, y]) => project(x, y, 0));
  const top = g.map(([x, y]) => project(x, y, b.h));
  const canopy = b.k === 'roof';
  const walls = [];
  if (!canopy) {
    for (let i = 0; i < g.length; i++) {
      const j = (i + 1) % g.length;
      const dx = g[j][0] - g[i][0];
      const dy = g[j][1] - g[i][1];
      const l = Math.hypot(dx, dy) || 1;
      const n = sign > 0 ? [dy / l, -dx / l] : [-dy / l, dx / l];
      if (n[1] <= 0.04) continue;
      const lit = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + 1) / 2;
      walls.push({
        d: `M${r1(base[i][0])} ${r1(base[i][1])}L${r1(base[j][0])} ${r1(base[j][1])}L${r1(top[j][0])} ${r1(top[j][1])}L${r1(top[i][0])} ${r1(top[i][1])}Z`,
        fill: mix(WALL_SHADE, WALL_LIT, Math.min(1, Math.max(0, lit * 1.25))),
        k: n[1]
      });
    }
  }
  const [cx, cy] = centroid(g);
  return {b, g, base, top, walls, cx, cy, canopy, units: canopy ? [] : roofUnits(b, g)};
}

/** Deterministic pseudo-random so rooftop plant is identical on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Small stylised plant boxes on large roofs: texture only, never a claimed facility. */
function roofUnits(b, g) {
  const area = Math.abs(shoelace(g));
  if (area < 500 || b.k === 'grandstand' || b.k === 'bleacher') return [];
  const r = rng(Number(b.id) % 2147483647);
  const xs = g.map(p => p[0]);
  const ys = g.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const want = Math.min(6, 1 + Math.floor(area / 650));
  const out = [];
  for (let tries = 0; tries < 60 && out.length < want; tries++) {
    const w = 3.5 + r() * 3.5;
    const d = 2.5 + r() * 2.5;
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    const corners = [[x - w, y - d], [x + w, y - d], [x + w, y + d], [x - w, y + d]];
    if (!corners.every(c => inPoly(c[0], c[1], g))) continue;
    if (out.some(u => Math.abs(u.x - x) < u.w + w + 2 && Math.abs(u.y - y) < u.d + d + 2)) continue;
    out.push({x, y, w, d, h: 1.5 + r() * 1.2});
  }
  return out;
}

const buildingsX = C.buildings.map(extrudeBuilding).filter(Boolean);
const bleachersX = C.bleachers
  .map(bl => extrudeBuilding({id: bl.id, k: 'bleacher', n: '', h: 2.6, pts: bl.pts}))
  .filter(Boolean);

const isGrandstand = x => x.b.k === 'grandstand';
const MAIN_ID = 158903945;

function roofFill(x) {
  if (x.b.id === MAIN_ID) return 'url(#rcRoofMain)';
  if (isGrandstand(x)) return 'url(#rcRoofStand)';
  if (x.b.k === 'bleacher') return 'url(#rcSeats)';
  if (x.canopy) return 'url(#rcRoofCanopy)';
  return `url(#rcRoof${x.b.id % 4})`;
}

function buildingMarkup(list) {
  const sorted = list.slice().sort((a, b) => a.cy - b.cy);
  return sorted
    .map(x => {
      const roof = dPath(x.top, true);
      const walls = x.walls.map(w => `<path d="${w.d}" fill="${w.fill}"/>`).join('');
      const cls = x.canopy ? 'rc-canopy' : 'rc-bldg';
      const topFill = roofFill(x);
      const ridge = isGrandstand(x) || x.b.id === MAIN_ID ? `<path d="${roof}" fill="url(#rcRidges)" opacity=".6"/>` : '';
      const parapet = x.canopy ? '' : `<path d="${roof}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width=".9" stroke-linejoin="round"/>`;
      const contact = x.canopy ? '' : `<path d="${dPath(x.base, true)}" fill="none" stroke="rgba(60,48,30,.35)" stroke-width=".8" stroke-linejoin="round"/>`;
      const units = x.units
        .map(u => {
          const lo = [project(u.x - u.w, u.y + u.d, x.b.h), project(u.x + u.w, u.y + u.d, x.b.h)];
          const hi = [project(u.x - u.w, u.y - u.d, x.b.h + u.h), project(u.x + u.w, u.y - u.d, x.b.h + u.h), project(u.x + u.w, u.y + u.d, x.b.h + u.h), project(u.x - u.w, u.y + u.d, x.b.h + u.h)];
          return `<path d="M${r1(lo[0][0])} ${r1(lo[0][1])}L${r1(lo[1][0])} ${r1(lo[1][1])}L${r1(hi[2][0])} ${r1(hi[2][1])}L${r1(hi[3][0])} ${r1(hi[3][1])}Z" fill="#b9bcbf"/><path d="${dPath(hi, true)}" fill="#f4f5f6" stroke="rgba(40,46,52,.22)" stroke-width=".3"/>`;
        })
        .join('');
      return `<g class="${cls}" data-bid="${x.b.id}">${contact}${walls}<path d="${roof}" fill="${topFill}" stroke="rgba(255,255,255,.7)" stroke-width=".5" stroke-linejoin="round" opacity="${x.canopy ? 0.94 : 1}"/>${ridge}${parapet}${units}</g>`;
    })
    .join('');
}

function shadowPath(list) {
  const subs = [];
  list.forEach(x => {
    const h = x.b.h;
    const L = h * (x.canopy ? 0.55 : 0.85);
    const dx = SHADOW_DIR[0] * L;
    const dy = SHADOW_DIR[1] * L;
    const g = x.g;
    subs.push(g.map(p => [p[0] + dx, p[1] + dy]));
    subs.push(g);
    for (let i = 0; i < g.length; i++) {
      const j = (i + 1) % g.length;
      subs.push([g[i], g[j], [g[j][0] + dx, g[j][1] + dy], [g[i][0] + dx, g[i][1] + dy]]);
    }
  });
  return dMulti(subs);
}

/* ---------------------------------------------------------------- facilities */
/**
 * Registry of every selectable facility. `geom` is in world metres so a future
 * overlay can address facilities by id. Nothing here carries operational data.
 */
const facilities = {};

const isNamedCorner = n => n && n !== 'Circuit Paul Ricard';

function addFacility(f) {
  facilities[f.id] = f;
  return f;
}

/* ---- corners / named sections */
const sectionLabels = [];
{
  const seen = new Set();
  C.labels.forEach(l => {
    if (!isNamedCorner(l.n)) return;
    // Pick the longer way for names mapped in two pieces
    const dup = C.labels.filter(o => o.n === l.n);
    const best = dup.reduce((a, b) => (b.len > a.len ? b : a));
    if (best.id !== l.id || seen.has(l.n)) return;
    seen.add(l.n);
    const straight = /^Ligne droite/.test(l.n);
    const f = addFacility({
      id: `sec-${l.id}`,
      kind: straight ? 'straight' : 'corner',
      name: l.n,
      osm: `way/${l.id}`,
      lengthM: l.len,
      geom: {type: 'line', pts: pairs(l.pts)},
      anchor: [l.x, l.y]
    });
    sectionLabels.push(f);
  });
}

/* ---- pit lane (names: OSM tag 'Stand' on the ways) */
pitWays.forEach((p, i) => {
  addFacility({
    id: `pit-${p.id}`,
    kind: i === 0 ? 'pit-lane' : 'pit-service',
    name: i === 0 ? 'Pit lane' : 'Pit service lane',
    osm: `way/${p.id}`,
    lengthM: Math.round(lenOf(p.pts)),
    geom: {type: 'line', pts: p.pts},
    anchor: p.pts[Math.floor(p.pts.length / 2)]
  });
});
{
  const main = pitWays[0].pts;
  addFacility({
    id: 'pit-entry',
    kind: 'pit-entry',
    name: 'Pit entry',
    osm: `way/${pitWays[0].id} (start node)`,
    geom: {type: 'point', pts: [main[0]]},
    anchor: main[0]
  });
  addFacility({
    id: 'pit-exit',
    kind: 'pit-exit',
    name: 'Pit exit',
    osm: `way/${pitWays[0].id} (end node)`,
    geom: {type: 'point', pts: [main[main.length - 1]]},
    anchor: main[main.length - 1]
  });
}

/* ---- buildings that carry meaning */
const interactiveBuildings = [];
buildingsX.forEach(x => {
  const {b} = x;
  let kind = null;
  if (b.id === MAIN_ID) kind = 'main-building';
  else if (b.k === 'grandstand') kind = 'grandstand';
  else if (b.n) kind = 'named-building';
  if (!kind) return;
  interactiveBuildings.push(x);
  addFacility({
    id: `bld-${b.id}`,
    kind,
    name: b.n || 'Building',
    osm: `way/${b.id}`,
    renderedHeightM: b.h,
    geom: {type: 'poly', pts: x.g, top: x.top, base: x.base},
    anchor: [x.cx, x.cy]
  });
});
bleachersX.forEach(x => {
  addFacility({
    id: `bl-${x.b.id}`,
    kind: 'bleachers',
    name: 'Spectator bleachers',
    osm: `way/${x.b.id}`,
    geom: {type: 'poly', pts: x.g, top: x.top, base: x.base},
    anchor: [x.cx, x.cy]
  });
});

/* ---- emergency access roads + gates + helipads */
const emergencyLines = C.emergency.map(e => ({id: e.id, pts: pairs(e.pts)}));
emergencyLines.forEach(e => {
  addFacility({
    id: `em-${e.id}`,
    kind: 'emergency-access',
    name: 'Emergency access road',
    osm: `way/${e.id}`,
    lengthM: Math.round(lenOf(e.pts)),
    geom: {type: 'line', pts: e.pts},
    anchor: e.pts[Math.floor(e.pts.length / 2)]
  });
});
const distToEmergency = (x, y) => {
  let best = Infinity;
  emergencyLines.forEach(e => e.pts.forEach(p => (best = Math.min(best, Math.hypot(p[0] - x, p[1] - y)))));
  return best;
};
C.gates.forEach(g => {
  addFacility({
    id: `gate-${g.id}`,
    kind: 'gate',
    name: 'Gate',
    osm: `node/${g.id}`,
    access: g.acc,
    onEmergencyRoad: distToEmergency(g.x, g.y) < 14,
    geom: {type: 'point', pts: [[g.x, g.y]]},
    anchor: [g.x, g.y]
  });
});
C.helipads.forEach(h => {
  addFacility({
    id: `heli-${h.id}`,
    kind: 'helipad',
    name: 'Helipad',
    osm: `way/${h.id}`,
    geom: {type: 'point', pts: [[h.x, h.y]], r: h.r},
    anchor: [h.x, h.y]
  });
});

export const FACILITIES = facilities;

/* ---------------------------------------------------------------- markup */
const terrainGrass = C.terrain.filter(t => t.k === 'grass').map(t => pairs(t.pts));
const terrainWood = C.terrain.filter(t => t.k === 'wood').map(t => pairs(t.pts));
const terrainWater = C.terrain.filter(t => t.k === 'water').map(t => pairs(t.pts));

const runoffBy = col => C.runoff.filter(r => (r.c || 'blue') === col).map(r => pairs(r.pts));

const loopD = dPath(loop, true);
const pitMainD = dPath(pitWays[0].pts);
const pitSvcD = dPath(pitWays[1].pts);

const serviceByClass = cls => C.service.filter(s => cls.includes(s.hw)).map(s => dPath(pairs(s.pts))).join('');
const kerbsD = C.kerbs.map(k => dPath(pairs(k))).join('');
const emergencyD = emergencyLines.map(e => dPath(e.pts)).join('');
const barrierBy = fn => C.barriers.filter(fn).map(b => dPath(pairs(b.pts))).join('');
const otherTracksD = C.otherTracks.map(t => dPath(pairs(t.pts))).join('');

const shadowAll = buildingsX.concat(bleachersX);

/** Static definitions (gradients, patterns). `noiseUrl` is a runtime-generated texture tile. */
export function defsMarkup(noiseUrl) {
  const speck = noiseUrl
    ? `<image href="${noiseUrl}" width="28" height="28" opacity=".5" preserveAspectRatio="none"/>`
    : '';
  const sand = noiseUrl
    ? `<image href="${noiseUrl}" width="40" height="40" opacity=".10" preserveAspectRatio="none"/>`
    : '';
  return `
  <radialGradient id="rcGround" gradientUnits="userSpaceOnUse" cx="-60" cy="-40" r="1800">
    <stop offset="0" stop-color="#f1e9d6"/><stop offset=".55" stop-color="#e7dcc3"/><stop offset="1" stop-color="#d9ccb0"/>
  </radialGradient>
  <pattern id="rcSand" patternUnits="userSpaceOnUse" width="40" height="40">
    <rect width="40" height="40" fill="none"/>${sand}
  </pattern>
  <pattern id="rcAsphalt" patternUnits="userSpaceOnUse" width="28" height="28">
    <rect width="28" height="28" fill="#2b2e34"/>${speck}
  </pattern>
  <pattern id="rcAsphaltPit" patternUnits="userSpaceOnUse" width="28" height="28">
    <rect width="28" height="28" fill="#43474e"/>${speck}
  </pattern>
  <pattern id="rcAsphaltSite" patternUnits="userSpaceOnUse" width="28" height="28">
    <rect width="28" height="28" fill="#6f7378"/>${speck}
  </pattern>
  <pattern id="rcRunoffTex" patternUnits="userSpaceOnUse" width="28" height="28">
    ${speck || '<rect width="28" height="28" fill="none"/>'}
  </pattern>
  <pattern id="rcRidges" patternUnits="userSpaceOnUse" width="3.4" height="3.4" patternTransform="rotate(-24)">
    <rect width="3.4" height="3.4" fill="none"/><rect width="3.4" height=".45" fill="#6b727a" opacity=".35"/>
  </pattern>
  <pattern id="rcSeats" patternUnits="userSpaceOnUse" width="2" height="2" patternTransform="rotate(-20)">
    <rect width="2" height="2" fill="#7f97bd"/><rect width="2" height=".7" fill="#c3d0e6" opacity=".85"/>
  </pattern>
  <linearGradient id="rcRoofMain" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdfcf8"/><stop offset="1" stop-color="#d7dadc"/></linearGradient>
  <linearGradient id="rcRoofStand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbfcfd"/><stop offset="1" stop-color="#c8d0d9"/></linearGradient>
  <linearGradient id="rcRoofCanopy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef0f1"/><stop offset="1" stop-color="#c6ccd1"/></linearGradient>
  ${ROOF_TONES.map(
    (t, i) =>
      `<linearGradient id="rcRoof${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hex(Math.min(255, t[0] + 14), Math.min(255, t[1] + 14), Math.min(255, t[2] + 14))}"/><stop offset="1" stop-color="${hex(t[0] - 20, t[1] - 20, t[2] - 18)}"/></linearGradient>`
  ).join('')}
  <filter id="rcSoft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.4"/></filter>
  <filter id="rcSoftWide" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4.5"/></filter>
  <filter id="rcRubber" x="-2%" y="-2%" width="104%" height="104%"><feGaussianBlur stdDeviation="2.2"/></filter>
  `;
}

/** Ground-plane layers (drawn inside the foreshortened group). */
export function groundMarkup() {
  const W = TRACK_W;
  const L = (name, inner) => `<g class="rc-layer" data-layer="${name}">${inner}</g>`;
  const stroke = (d, color, w, extra = '') =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;

  const terrain = L(
    'terrain',
    `<rect x="-3200" y="-2600" width="6400" height="5200" fill="url(#rcGround)"/>` +
      `<rect x="-3200" y="-2600" width="6400" height="5200" fill="url(#rcSand)"/>` +
      `<path d="${dMulti(terrainGrass)}" fill="#d5dab2" opacity=".78"/>` +
      `<path d="${dMulti(terrainWood)}" fill="#b4bd8e" opacity=".7" filter="url(#rcSoft)"/>` +
      `<path d="${dMulti(terrainWater)}" fill="#b4d1d8" opacity=".95"/>`
  );

  const svcPaths = serviceByClass(['service', 'track']);
  const roadPaths = serviceByClass(['unclassified', 'residential']);
  const mainRoadPaths = serviceByClass(['primary', 'secondary']);
  const service = L(
    'service',
    stroke(svcPaths, '#b9ad93', 4.2, 'opacity=".7"') +
      stroke(roadPaths, '#b9ad93', 6.4, 'opacity=".7"') +
      stroke(mainRoadPaths, '#a79c84', 8.4, 'opacity=".8"') +
      stroke(svcPaths, '#faf6ec', 3, 'opacity=".95"') +
      stroke(roadPaths, '#faf6ec', 5.2, 'opacity=".95"') +
      stroke(mainRoadPaths, '#e9e3d3', 7, 'opacity=".95"')
  );

  const other = L(
    'other',
    stroke(otherTracksD, '#f4f1ea', 8.6, 'opacity=".85"') + stroke(otherTracksD, 'url(#rcAsphaltSite)', 7.2, 'opacity=".88"')
  );

  const blue = runoffBy('blue');
  const red = runoffBy('red');
  const white = runoffBy('white');
  const runoff = L(
    'runoff',
    `<g filter="url(#rcSoftWide)" opacity=".42" transform="translate(1.2 2.2)"><path d="${dMulti(blue.concat(red))}" fill="#4a3b25"/></g>` +
      `<path d="${dMulti(blue)}" fill="#2f69c4"/>` +
      `<path d="${dMulti(red)}" fill="#d2433a"/>` +
      `<path d="${dMulti(white)}" fill="#f2f0ea"/>` +
      `<path d="${dMulti(blue.concat(red, white))}" fill="url(#rcRunoffTex)" stroke="rgba(20,28,48,.28)" stroke-width=".5" opacity=".55"/>`
  );

  const emergency = L(
    'emergency',
    stroke(emergencyD, '#a99a73', 4.4, 'opacity=".75"') +
      stroke(emergencyD, '#f0e2b6', 3.3, 'opacity=".98"') +
      stroke(emergencyD, '#d0701d', 0.8, 'stroke-dasharray="3.4 3" opacity=".95"')
  );

  const pit = L(
    'pit',
    stroke(pitSvcD, '#000', 6.4, 'opacity=".14" filter="url(#rcSoft)"') +
      stroke(pitSvcD, '#e9ecee', 5.6, 'opacity=".95"') +
      stroke(pitSvcD, 'url(#rcAsphaltPit)', 4.4) +
      stroke(pitMainD, '#000', 11.4, 'opacity=".16" filter="url(#rcSoft)"') +
      stroke(pitMainD, '#eef0f2', 10.6, 'opacity=".98"') +
      stroke(pitMainD, 'url(#rcAsphaltPit)', 9.2) +
      stroke(pitMainD, '#f4c430', 0.55, 'stroke-dasharray="5 4" opacity=".75" transform="translate(0 .1)"')
  );

  const track = L(
    'track',
    stroke(loopD, '#3b2d18', W + 6, 'opacity=".26" filter="url(#rcSoft)"') +
      stroke(loopD, '#f4f5f6', W + 0.4, 'opacity=".98"') +
      stroke(loopD, 'url(#rcAsphalt)', W - 1.3) +
      stroke(loopD, '#4a4e56', W * 0.5, 'opacity=".35" filter="url(#rcRubber)"') +
      stroke(loopD, '#0b0c0e', 4.6, 'opacity=".6" filter="url(#rcRubber)"') +
      stroke(loopD, '#5a5f67', 0.35, 'stroke-dasharray="18 24" opacity=".35"')
  );

  const kerbs = L(
    'kerbs',
    stroke(kerbsD, '#2a1a14', 3.4, 'stroke-linecap="butt" opacity=".35"') +
      stroke(kerbsD, '#d02f27', 2.7, 'stroke-linecap="butt"') +
      stroke(kerbsD, '#fbfaf6', 2.7, 'stroke-linecap="butt" stroke-dasharray="2.6 2.6"')
  );

  const rails = barrierBy(b => b.b === 'guard_rail');
  const walls = barrierBy(b => b.b !== 'guard_rail');
  const barriers = L(
    'barriers',
    stroke(rails, '#3b2d18', 1.5, 'opacity=".38" transform="translate(.9 1.4)"') +
      stroke(rails, '#e6eaee', 0.9, 'opacity=".98"') +
      stroke(rails, '#8d96a0', 0.25, 'opacity=".8"') +
      stroke(walls, '#3b2d18', 1.7, 'opacity=".34" transform="translate(.9 1.4)"') +
      stroke(walls, '#d2d5d8', 1.1, 'opacity=".95"')
  );

  const shadows = L(
    'buildings',
    `<path d="${shadowPath(shadowAll)}" fill="#3a2d1c" opacity=".30" filter="url(#rcSoft)"/>` +
      `<path d="${dMulti(shadowAll.map(x => x.g))}" fill="none" stroke="#3a2d1c" stroke-width="3.2" opacity=".2" filter="url(#rcSoft)"/>`
  );

  return terrain + service + other + runoff + emergency + pit + track + kerbs + barriers + shadows;
}

/** Elevated (extruded) layers in view space. */
export function elevatedMarkup() {
  return (
    `<g class="rc-layer" data-layer="buildings">${buildingMarkup(buildingsX)}${buildingMarkup(bleachersX)}</g>`
  );
}

export const LAYER_DEFS = [
  {id: 'terrain', label: 'Terrain'},
  {id: 'runoff', label: 'Blue and red run-off'},
  {id: 'kerbs', label: 'Kerbs'},
  {id: 'barriers', label: 'Barriers'},
  {id: 'pit', label: 'Pit lane'},
  {id: 'buildings', label: 'Buildings and stands'},
  {id: 'emergency', label: 'Emergency access and gates'},
  {id: 'service', label: 'Service roads'},
  {id: 'other', label: 'Other site tracks'},
  {id: 'names', label: 'Corner names'}
];

export {sectionLabels, interactiveBuildings, buildingsX};
export const META = C.meta;
