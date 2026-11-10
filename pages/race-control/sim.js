/* ------------------------------------------------------------------ *
 * Race Control 360 — deterministic vehicle pose from authoritative state
 *
 * Pure functions, no DOM, no network. Given the vehicle record and the session clock that ServiceNow
 * persisted, they reconstruct where a car is. Nothing here decides a vehicle's operational state:
 * `state`, anchors and pit-phase timings come from the ServiceNow record, positions are derived.
 *
 *   on track   distance = anchor_distance_m + speed * (sessionMs - anchor_session_ms)
 *              speed    = lap_length_m / lap_time_s
 *   pit exit   state on_track, pit_phase 'leaving': from pit_phase_start_ms to anchor_session_ms the car
 *              drives its pit-lane path (garage -> pit lane -> merge point). After that it is on track.
 *   pit entry  state in_pits, pit_phase 'entering': it keeps driving the circuit until pit_phase_start_ms
 *              (arrival at the pit entry), then drives the pit-lane path into its garage over
 *              pit_in_duration_ms, then is parked.
 * Same coordinate system as every other layer (world metres).
 * ------------------------------------------------------------------ */
import {FACILITIES} from './scene.js';
import {LOOP_LENGTH_M, nearestOnLoop, pointAt} from './vehicles.js';

export {LOOP_LENGTH_M};

const smoothstep = f => f * f * (3 - 2 * f);
const easeOut = f => 1 - (1 - f) ** 3;

/** Where a crash stopped (world metres): on the racing line at `stop`, run wide by `lat` metres into the runoff. */
export function crashPoint(stop, lat, L = LOOP_LENGTH_M) {
  const p = pointAt(((stop % L) + L) % L);
  return {x: p.x + -Math.sin(p.heading) * lat, y: p.y + Math.cos(p.heading) * lat, heading: p.heading};
}

const lane = (() => {
  const f = Object.values(FACILITIES).find(x => x.kind === 'pit-lane');
  const pts = f.geom.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return {pts, cum, length: cum[cum.length - 1]};
})();

/** Loop distances where the pit lane leaves / rejoins the circuit (from the mapped pit road). */
export const PIT_ENTRY_M = nearestOnLoop(lane.pts[0][0], lane.pts[0][1]).alongM;
export const PIT_MERGE_M = nearestOnLoop(lane.pts[lane.pts.length - 1][0], lane.pts[lane.pts.length - 1][1]).alongM;

const at = (pts, cum, s) => {
  const t = Math.min(Math.max(s, 0), cum[cum.length - 1]);
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
};

const nearestOnLane = (x, y) => {
  let best = {d2: Infinity, s: 0};
  for (let i = 0; i < lane.pts.length - 1; i++) {
    const [x0, y0] = lane.pts[i];
    const dx = lane.pts[i + 1][0] - x0;
    const dy = lane.pts[i + 1][1] - y0;
    const l2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
    const d2 = (x - (x0 + dx * f)) ** 2 + (y - (y0 + dy * f)) ** 2;
    if (d2 < best.d2) best = {d2, s: lane.cum[i] + f * Math.sqrt(l2)};
  }
  return best.s;
};

/**
 * Representative parking spot for a pit slot. The garage position is a ServiceNow location (representative,
 * not surveyed): the car parks beside the pit lane, towards that garage, two cars per garage.
 */
export function parkingSpot(garageXY, slot) {
  const s = nearestOnLane(garageXY[0], garageXY[1]);
  const base = at(lane.pts, lane.cum, s);
  const toG = [garageXY[0] - base.x, garageXY[1] - base.y];
  const n = Math.hypot(toG[0], toG[1]) || 1;
  const side = [toG[0] / n, toG[1] / n];
  const along = (slot ? 4.5 : -4.5);
  const px = base.x + Math.cos(base.heading) * along + side[0] * 7;
  const py = base.y + Math.sin(base.heading) * along + side[1] * 7;
  return {x: px, y: py, heading: base.heading, laneS: s + along, laneX: base.x + Math.cos(base.heading) * along, laneY: base.y + Math.sin(base.heading) * along};
}

/** Polyline from the parking spot, diagonally onto the lane, along it to the end, and onto the circuit at the merge point. */
export function pitOutPath(spot) {
  const on = at(lane.pts, lane.cum, spot.laneS + 14);
  const pts = [[spot.x, spot.y], [on.x, on.y]];
  for (let i = 0; i < lane.pts.length; i++) if (lane.cum[i] > spot.laneS + 15) pts.push(lane.pts[i]);
  const merge = pointAt(PIT_MERGE_M);
  pts.push([merge.x, merge.y]);
  return pathOf(pts);
}

/** Polyline from the pit entry on the circuit, along the lane to the garage, diagonally into the parking spot. */
export function pitInPath(spot) {
  const entry = pointAt(PIT_ENTRY_M);
  const pts = [[entry.x, entry.y]];
  for (let i = 0; i < lane.pts.length; i++) if (lane.cum[i] < spot.laneS - 15) pts.push(lane.pts[i]);
  const on = at(lane.pts, lane.cum, spot.laneS - 14);
  pts.push([on.x, on.y], [spot.x, spot.y]);
  return pathOf(pts);
}

function pathOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return {pts, cum, length: cum[cum.length - 1]};
}

const poseOnPath = (p, f) => at(p.pts, p.cum, p.length * f);
const smooth = f => f * f * (3 - 2 * f);

/** Distance a car has covered along the circuit (unbounded, so laps accumulate). null when parked / in the pit lane. */
export function trackProgress(v, sessionMs, L = LOOP_LENGTH_M) {
  const phase = phaseOf(v, sessionMs);
  if (phase === 'parked' || phase === 'leaving' || phase === 'entering' || phase === 'crashing' || phase === 'stopped' || phase === 'retired') return null;
  const speed = (L / v.lap_time_s) * (v.speed_factor ?? 1);
  return v.anchor_distance_m + (speed * Math.max(0, sessionMs - v.anchor_session_ms)) / 1000;
}

/** parked | leaving (pit lane out) | track | approaching (track, heading for the pit entry) | entering (pit lane in). */
export function phaseOf(v, sessionMs) {
  if (v.state === 'retired') return 'retired';
  if (v.state === 'stopped') {
    if (sessionMs < v.crash_start_ms) return 'track';
    return sessionMs < v.crash_start_ms + v.crash_duration_ms ? 'crashing' : 'stopped';
  }
  if (v.state === 'in_pits') {
    if (v.pit_phase === 'entering') {
      // recalled while still in the pit lane (V5): finishes its pit exit first, then drives to the pit entry
      if (sessionMs < v.anchor_session_ms && v.pit_out_duration_ms) return 'leaving';
      if (sessionMs < v.pit_phase_start_ms) return 'approaching';
      if (sessionMs < v.pit_phase_start_ms + v.pit_in_duration_ms) return 'entering';
    }
    return 'parked';
  }
  if (v.state === 'on_track' && v.pit_phase === 'leaving' && sessionMs < v.anchor_session_ms) return 'leaving';
  if (v.state === 'on_track') return 'track';
  return 'parked'; // stopped / retired: stays where the anchor says (V4)
}

/**
 * Pose {x, y, heading, phase}. `spot` is the car's parking spot (from its garage location).
 * The visual gaps are bridged by the stored durations, so a car never teleports between garage and circuit.
 */
export function carPose(v, sessionMs, spot, L = LOOP_LENGTH_M) {
  const phase = phaseOf(v, sessionMs);
  const speed = L / v.lap_time_s;
  if (phase === 'retired') return {...spot, phase};
  if (phase === 'crashing' || phase === 'stopped') {
    const f = phase === 'stopped' ? 1 : Math.min(1, Math.max(0, (sessionMs - v.crash_start_ms) / Math.max(1, v.crash_duration_ms)));
    const span = (((v.stop_distance_m - v.crash_entry_m) % L) + L) % L;
    const p = pointAt((((v.crash_entry_m + span * easeOut(f)) % L) + L) % L);
    const lat = v.lateral_offset_m * smoothstep(f);
    const tilt = Math.sign(v.lateral_offset_m || 1) * 0.6 * smoothstep(f);
    return {x: p.x + -Math.sin(p.heading) * lat, y: p.y + Math.cos(p.heading) * lat, heading: p.heading + tilt, phase};
  }
  if (phase === 'parked') {
    if (v.state === 'in_pits') return {...spot, phase};
    const p = pointAt(v.anchor_distance_m);
    return {...p, phase};
  }
  if (phase === 'leaving') {
    const outStart = v.anchor_session_ms - (v.pit_out_duration_ms || Math.max(1, v.anchor_session_ms - v.pit_phase_start_ms));
    const dur = Math.max(1, v.anchor_session_ms - outStart);
    const f = Math.min(1, Math.max(0, (sessionMs - outStart) / dur));
    return {...poseOnPath(pitOutPath(spot), smooth(f) * 0.4 + f * 0.6), phase};
  }
  if (phase === 'entering') {
    const f = Math.min(1, Math.max(0, (sessionMs - v.pit_phase_start_ms) / Math.max(1, v.pit_in_duration_ms)));
    return {...poseOnPath(pitInPath(spot), smooth(f) * 0.4 + f * 0.6), phase};
  }
  const d = v.anchor_distance_m + (speed * (v.speed_factor ?? 1) * Math.max(0, sessionMs - v.anchor_session_ms)) / 1000;
  return {...pointAt(((d % L) + L) % L), phase};
}
