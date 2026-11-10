import {html, css, svg, nothing, isServer} from 'lit';
import {customElement} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {unsafeSVG} from 'lit/directives/unsafe-svg.js';
import {ifDefined} from 'lit/directives/if-defined.js';
import {AIUXElement, aiuxFetch, withWidgetContext} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {
  FACILITIES,
  GROUND_Y,
  SCENE_BOUNDS,
  TRACK_W,
  defsMarkup,
  elevatedMarkup,
  groundMarkup,
  project,
  sectionLabels
} from './scene.js';
import {CIRCUIT} from './circuit-data.js';
import {SN_CONFIG, associate, heartbeat, incidentKind, loadActivity, loadOperationalData, loadVehicles, toWorld} from './servicenow.js';
import {LOOP_LENGTH_M as SIM_L, PIT_ENTRY_M, PIT_MERGE_M, carPose, crashPoint, parkingSpot, phaseOf, trackProgress} from './sim.js';
import {pointAt} from './vehicles.js';
import {pointOnRoute, routeBetween} from './routes.js';
import {renderWeatherPanel, weatherStyles} from './weather.js';

/* ------------------------------------------------------------------ *
 * Race Control 360 | Circuit Paul Ricard
 *
 * DATA HONESTY
 *  - Circuit geometry is STATIC OpenStreetMap data (ODbL), projected into one
 *    metric frame (see scene.js / circuit-data.js).
 *  - Operational markers come ONLY from real ServiceNow records read through
 *    servicenow.js (cmn_location, cmdb_ci, incident, em_alert). No record, no
 *    marker. Nothing is generated, defaulted or simulated here.
 *  - Race-control tower, medical centre, marshal posts, team garages and the
 *    start/finish line are not in the OSM data; they appear only when a
 *    cmn_location with real coordinates exists for them.
 *  - Vehicles render only from a configured ServiceNow source (SN_CONFIG).
 *  - Weather is not connected; the control stays inactive until it is.
 * ------------------------------------------------------------------ */

// Runtime lookup helper; strings are literals at every call site.
// eslint-disable-next-line @servicenow/aiux-i18n/getmessage-no-variable-arg
const t = s => i18n.getMessage(s);
const fill = (s, ...v) => v.reduce((acc, x, i) => acc.replace(`{${i}}`, x), s);

/** Governed Scripted REST API (x_snc_lux1/rc360): ServiceNow-side state machine for the practice session. */
const SIM_BASE = '/api/x_snc_lux1/rc360';
/** Moving vehicle markers are drawn at this multiple of the V5 size (about 63 px across at overview). */
const VS = 1.85;

/**
 * Trackside signal panels. Positions are REPRESENTATIVE (spread over corners, straights, sector boundaries and the pit
 * entry / exit), placed just outside the racing surface on the outer side of the loop. They are not surveyed installations.
 */
const SIGNAL_DIST = [150, 480, PIT_MERGE_M, 953, 1300, 1770, 1908, 2080, 2350, 2800, 3250, 3700, 4150, 4526, 4900, 5182, 5400, PIT_ENTRY_M, 5650, 5740];
const SIGNALS = (() => {
  const L = SIM_L;
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (let d = 0; d < L; d += 40) {
    const p = pointAt(d);
    cx += p.x;
    cy += p.y;
    n++;
  }
  cx /= n;
  cy /= n;
  return SIGNAL_DIST.map((d, i) => {
    const p = pointAt(((d % L) + L) % L);
    const nx = -Math.sin(p.heading);
    const ny = Math.cos(p.heading);
    const side = (p.x - cx) * nx + (p.y - cy) * ny >= 0 ? 1 : -1;
    const off = TRACK_W / 2 + 11;
    const [sx, sy] = project(p.x + nx * off * side, p.y + ny * off * side);
    return {id: i, d, x: sx, y: sy};
  });
})();

const DEC_TABLE = 'x_snc_lux1_rc_decision';
const RESP_TABLE = 'x_snc_lux1_rc_response';
const DEC_LABEL = {red_flag: 'Red flag', restart: 'Return to green', announcement: 'Spectator announcement'};
const RC_KIND = {amber: 'warnc', crash: 'crit', incident: 'created', caution: 'warnc', tasks: 'created', dispatch: 'state', task: 'resolved', recovery: 'resolved', redflag: 'crit', decision: 'state', restart: 'resolved', announcement: 'state', session: 'state', vehicle: 'state', weather: 'warnc'};
const RESP_GLYPH = {
  fire: 'M0 -7c1.8 2.6 4.6 4.2 4.6 7.6a4.6 4.6 0 0 1-9.2 0c0-1.6.8-2.8 1.8-3.8.1 1.6 1 2.4 1.6 2.4.2-3 0-4.4 1.2-6.2z',
  medical: 'M-1.7 -6h3.4v4.3h4.3v3.4h-4.3v4.3h-3.4v-4.3h-4.3v-3.4h4.3z',
  recovery: 'M-6.5 2.5h9.5v-5h3.6l2.4 3.2v1.8M-4.5 4.4a1.6 1.6 0 1 0 .01 0M3.2 4.4a1.6 1.6 0 1 0 .01 0M-6.5 -3.5l5-2.5'
};
/** Readable lettering on any team colour. */
const contrastText = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#15191e' : '#ffffff';
};
const SESSION_ACTIONS = {start: 'Start', pause: 'Pause', resume: 'Resume', end: 'End session', reset: 'Reset'};
const DESIGN_W = 1920;
const DESIGN_H = 1080;
const TOP_INSET = 62;
const SIDE_INSET = 14;
const BOTTOM_INSET = 12;
const PANEL_W = 340;
const MAX_ZOOM = 14;
/** relative zoom (k / fit) at which labels step up a tier */
const TIER_1 = 1.45;
const TIER_2 = 3.4;

/** Closed centreline path in world metres; usable with getPointAtLength() for future vehicles. */
const CENTRELINE_D = (() => {
  const p = [];
  for (let i = 0; i < CIRCUIT.loop.length; i += 2) p.push(`${CIRCUIT.loop[i]} ${CIRCUIT.loop[i + 1]}`);
  return `M${p.join('L')}Z`;
})();

/* px offsets (screen, at any zoom) of corner-name labels relative to the track point. */
const LABEL_DELTA = {
  'Ligne droite des stands': [84, 40],
  '"S" de la Verrerie': [-18, 34],
  "Virage de l'hotel": [-52, 26],
  'Virage du camp': [-50, -20],
  'Virage de la Sainte-Baume': [78, 8],
  'Ligne droite du Mistral': [-26, -30],
  'Courbe de Signes': [62, -22],
  'Double droite du Beausset': [-6, 44],
  'Virage de Bendor': [-58, -34],
  'Courbe du Garlaban': [-6, 36],
  'Virage du Lac': [-8, -44],
  'Virage du Pont': [-70, 22]
};

const OPS_LAYERS = [
  {id: 'incidents', label: 'Incidents and alerts'},
  {id: 'facilities', label: 'Buildings and facilities'},
  {id: 'it', label: 'IT and connected equipment'},
  {id: 'emergency', label: 'Emergency access and response teams'},
  {id: 'restrictions', label: 'Track restrictions'},
  {id: 'vehicles', label: 'Vehicle positions'},
  {id: 'weather', label: 'Weather warnings'}
];
const BASE_LAYERS = [
  {id: 'terrain', label: 'Terrain'},
  {id: 'runoff', label: 'Blue and red run-off'},
  {id: 'kerbs', label: 'Kerbs'},
  {id: 'barriers', label: 'Barriers'},
  {id: 'service', label: 'Service roads'},
  {id: 'other', label: 'Other site tracks'},
  {id: 'names', label: 'Labels'}
];
const LAYER_KEY = 'x_snc_lux1.raceControl.layers';
const EMPTY_ASSOC = {
  dynamic: {},
  bundles: {},
  unplaced: [],
  records: {},
  containers: [],
  stats: {pitGarages: 0, raceControl: 0, paddock: 0, grandstands: 0, medical: 0, marshals: 0, gates: 0, sectors: 0, cis: 0, locations: 0, placed: 0, unplaced: 0, containers: 0, incidents: 0, resolved: 0, alerts: 0, tasks: 0, teams: 0}
};
const GLYPH = {'pit-garage': 'G', 'race-control': 'RC', paddock: 'P', medical: '+', marshal: 'M', 'gate-sn': 'GT', 'grandstand-sn': 'S', 'sn-location': '•'};
const OSM_FAC = Object.values(FACILITIES);
const OSM_GATES = OSM_FAC.filter(f => f.kind === 'gate').length;
const OSM_STANDS = OSM_FAC.filter(f => f.kind === 'grandstand').length;
const OSM_MAIN = OSM_FAC.filter(f => f.kind === 'main-building').length;

/* ---- operational marker design system: shape = what, colour = how serious ---- */
const SEV = {critical: '#d6342a', warning: '#e8921a', normal: '#2f9e6a', info: '#2d6fd1', neutral: '#6b7580'};
const MARKER_GLYPH = {
  it: 'M-4.4 -3.2h8.8v5.6h-8.8zM-2 4.4h4',
  facilities: 'M-4.2 4.4v-7l4.2-2.2 4.2 2.2v7zM-1.2 4.4v-3h2.4v3',
  security: 'M0 -5l4.2 1.6v3.2c0 2.6-1.7 4.1-4.2 5.3-2.5-1.2-4.2-2.7-4.2-5.3v-3.2z',
  emergency: 'M-1.3 -4.6h2.6v3.3h3.3v2.6h-3.3v3.3h-2.6v-3.3h-3.3v-2.6h3.3z',
  team: 'M0 -4.4a1.9 1.9 0 1 0 .01 0zM-4.2 4.6c0-2.6 1.9-3.8 4.2-3.8s4.2 1.2 4.2 3.8z',
  asset: 'M0 -4.8l4.8 4.8-4.8 4.8-4.8-4.8z',
  restriction: 'M-4.6 -3.6h9.2v7.2h-9.2zM-4.6 3.6l9.2-7.2'
};
const MARKER_LEGEND = [
  ['it', 'IT incident'],
  ['facilities', 'Facilities issue'],
  ['security', 'Security alert'],
  ['emergency', 'Emergency incident'],
  ['team', 'Response team'],
  ['asset', 'Operational asset'],
  ['restriction', 'Restricted sector']
];
const SEV_LEGEND = [
  ['normal', 'Normal'],
  ['warning', 'Caution'],
  ['critical', 'Critical'],
  ['info', 'Information']
];

const iconPaths = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  cloud: 'M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5H7z',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M10 6l-6 6 6 6M4 12h16',
  expand: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5',
  minimise: 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01'
};
const icon = (name, size = 20) =>
  svg`<svg viewBox="0 0 24 24" width=${size} height=${size} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${iconPaths[name]}></path></svg>`;

const KIND_LABEL = {
  corner: 'Corner',
  straight: 'Straight',
  'pit-lane': 'Pit lane',
  'pit-service': 'Pit service lane',
  'pit-entry': 'Pit entry',
  'pit-exit': 'Pit exit',
  'main-building': 'Main building',
  grandstand: 'Grandstand',
  bleachers: 'Spectator seating',
  'named-building': 'Building',
  'emergency-access': 'Emergency access road',
  gate: 'Gate',
  helipad: 'Helipad',
  'pit-garage': 'Pit garage',
  'race-control': 'Race control tower',
  paddock: 'Paddock facility',
  medical: 'Medical centre',
  marshal: 'Marshal post',
  'gate-sn': 'Emergency access gate',
  'grandstand-sn': 'Grandstand',
  'sn-location': 'Circuit location',
  vehicle: 'Vehicle',
  sector: 'Track sector',
  incident: 'Incident',
  ci: 'Configuration item'
};
const kindLabel = k => t(KIND_LABEL[k] || 'Location');

/** Facts and limitations shown for a selected facility. Built only from source data. */
function describe(f) {
  const facts = [];
  let note = '';
  if (f.record) facts.push([t('Source'), `ServiceNow ${f.record.table}`]);
  else if (f.source === 'servicenow') facts.push([t('Position'), f.provenance === 'representative' ? t('Representative (simulation)') : t('From ServiceNow coordinates')]);
  else facts.push([t('Source'), `OpenStreetMap ${f.osm}`]);
  if (f.lengthM) facts.push([t('Mapped length'), `${f.lengthM.toLocaleString()} m`]);
  switch (f.kind) {
    case 'corner':
    case 'straight':
      note = t('Named section of the Grand Prix loop as mapped in OpenStreetMap. Corner numbering and sector boundaries are not in the source data.');
      break;
    case 'pit-lane':
      note = t('Pit road as mapped in OpenStreetMap, in its mapped direction of travel. Garage boxes along it are not individually mapped.');
      break;
    case 'pit-service':
      note = t('Secondary lane parallel to the pit road, as mapped. Its operational role is not stated in the source data.');
      break;
    case 'pit-entry':
      note = t('Start of the mapped pit road, taken from the direction of travel in the source data.');
      break;
    case 'pit-exit':
      note = t('End of the mapped pit road, taken from the direction of travel in the source data.');
      break;
    case 'main-building':
      facts.push([t('Rendered height'), t('Estimated, stylised')]);
      note = t('Footprint only. The race-control tower, team garage boxes and paddock rooms are not individually mapped, so none is placed inside this building.');
      break;
    case 'grandstand':
      facts.push([t('Rendered height'), t('Estimated, stylised')]);
      note = t('Mapped grandstand footprint. Seat counts and sector allocation are not in the source data.');
      break;
    case 'bleachers':
      note = t('Mapped seating block. Capacity is not in the source data.');
      break;
    case 'named-building':
      facts.push([t('Rendered height'), t('Estimated, stylised')]);
      note = t('Named building footprint. Its function for race operations is not stated in the source data.');
      break;
    case 'emergency-access':
      facts.push([t('Access'), t('Private')]);
      note = t('Mapped as an emergency-access service road. Response routing and availability are not connected.');
      break;
    case 'gate':
      facts.push([t('Access tag'), f.access]);
      note = f.onEmergencyRoad
        ? t('Gate on a mapped emergency-access road. Open or closed state is not connected.')
        : t('Mapped barrier gate. Whether it is an emergency gate is not stated in the source data.');
      break;
    case 'helipad':
      note = t('Mapped helipad. Medical-evacuation use is not stated in the source data.');
      break;
    case 'vehicle':
      note = t('Position reported by the configured ServiceNow source.');
      break;
    default:
      if (f.source === 'servicenow') note = t('Placed from the latitude and longitude of its ServiceNow location record.');
      break;
  }
  return {facts, note};
}

/* ---- static label catalogue: tier 0 = full circuit, 1 = medium zoom, 2 = close ---- */
const LABELS = (() => {
  const out = [];
  sectionLabels.forEach(f =>
    out.push({fid: f.id, text: f.name, world: f.anchor, z: 0, delta: LABEL_DELTA[f.name] || [30, -30], tier: f.kind === 'straight' ? 0 : 1, kind: f.kind, leader: true})
  );
  const pit = FACILITIES[Object.keys(FACILITIES).find(k => FACILITIES[k].kind === 'pit-lane')];
  if (pit) out.push({fid: pit.id, text: 'Pit lane', world: pit.anchor, z: 0, delta: [-62, -26], tier: 0, kind: 'pit-lane', leader: true});
  const seen = new Set();
  Object.values(FACILITIES).forEach(f => {
    if (f.kind === 'main-building') out.push({fid: f.id, text: f.name, world: f.anchor, z: f.renderedHeightM || 0, delta: [0, -16], tier: 1, kind: f.kind, leader: false});
    else if ((f.kind === 'grandstand' || f.kind === 'named-building') && f.name && !seen.has(f.name)) {
      seen.add(f.name);
      out.push({fid: f.id, text: f.name, world: f.anchor, z: f.renderedHeightM || 0, delta: [0, -14], tier: f.kind === 'grandstand' || /Mistral/.test(f.name) ? 1 : 2, kind: f.kind, leader: false});
    }
  });
  return out;
})();

function easeInOutCubic(p) {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}
function easeOutCubic(p) {
  return 1 - (1 - p) ** 3;
}

/**
 * Governed tools exposed to the existing Now Assist conversation (withWidgetContext client_tools).
 * Every tool calls ONE server endpoint (POST /ai/tool) that runs the same RaceControl360Sim operations as the UI:
 * ACLs, the operator role, native approvals and restart blockers all apply. There is deliberately no approve,
 * no direct restriction setter, no task completion and no force-restart tool.
 */
const aiTool = (name, description, args = []) => ({
  description,
  arguments: args.map(([n, d, req = false]) => ({name: n, description: d, type: 'string', required: req})),
  definition: async function (a = {}) {
    return this._aiTool(name, a);
  }
});
const AI_CLIENT_TOOLS = {
  GetSessionStatus: aiTool('GetSessionStatus', 'Race Control 360: session state, effective and requested track restriction, pending approvals.'),
  GetVehicleState: aiTool('GetVehicleState', 'Race Control 360: state of one car.', [['vehicle', 'Driver abbreviation (VER) or racing number', true]]),
  GetActiveIncidents: aiTool('GetActiveIncidents', 'Race Control 360: the active incident scenario and its tasks.'),
  CreateIncidentScenario: aiTool('CreateIncidentScenario', 'Race Control 360: simulate a crash for a car through the governed trigger (operator only). mode is next or immediate.', [['vehicle', 'Driver abbreviation or number', true], ['corner', 'Corner name (optional)'], ['mode', 'next or immediate']]),
  RequestTrackRestriction: aiTool('RequestTrackRestriction', 'Race Control 360: REQUEST amber, red or green. Red is only a request and needs a human approval; this assistant cannot approve.', [['status', 'amber, red or green', true], ['reason', 'Reason'], ['responseMode', 'freeze or pit (red only)']]),
  GetPendingApprovals: aiTool('GetPendingApprovals', 'Race Control 360: decisions awaiting a native approval.'),
  GetResponseTasks: aiTool('GetResponseTasks', 'Race Control 360: response tasks and dispatch plans of the active incident.'),
  RequestVehiclePitExit: aiTool('RequestVehiclePitExit', 'Race Control 360: send a car out of the pits (refused unless the track is green).', [['vehicle', 'Driver abbreviation or number', true]]),
  RequestVehiclePitReturn: aiTool('RequestVehiclePitReturn', 'Race Control 360: send a car back to the pits.', [['vehicle', 'Driver abbreviation or number', true]]),
  PrepareSpectatorAnnouncement: aiTool('PrepareSpectatorAnnouncement', 'Race Control 360: draft a spectator announcement and submit it for approval. Nothing is delivered until approved, and delivery is simulated.'),
  GetRestartBlockers: aiTool('GetRestartBlockers', 'Race Control 360: what still prevents a restart.'),
  RequestRestart: aiTool('RequestRestart', 'Race Control 360: request a restart. Refused while blockers remain and still needs approval.', [['reason', 'Reason']]),
  GetCurrentWeather: aiTool('GetCurrentWeather', 'Race Control 360 weather: current venue conditions from the stored weather record, and whether they are simulated.'),
  GetWeatherForecast: aiTool('GetWeatherForecast', 'Race Control 360 weather: the stored forecast (probability, threshold, expected rainfall, onset, peak, source, simulated or not).'),
  GetActiveWeatherWarnings: aiTool('GetActiveWeatherWarnings', 'Race Control 360 weather: active weather warnings with record numbers. A warning does not change the track restriction.'),
  GetWeatherOperationalRisks: aiTool('GetWeatherOperationalRisks', 'Race Control 360 weather: operational risks and recommended precautions derived from the stored forecast. Recommends only; creates nothing.'),
  MarkWeatherRecommendationsPresented: aiTool('MarkWeatherRecommendationsPresented', 'Race Control 360 weather: STATE-CHANGING (operator only). Records that the weather recommendations were presented. Creates no tasks, flags or restrictions. GetWeatherOperationalRisks itself is read-only.'),
  CreateWeatherResponseTasks: aiTool('CreateWeatherResponseTasks', 'Race Control 360 weather: create the preparation tasks for the active warning (operator only, idempotent). team is facilities, operations or all.', [['team', 'facilities, operations or all']]),
  PrepareWeatherAnnouncement: aiTool('PrepareWeatherAnnouncement', 'Race Control 360 weather: draft a spectator announcement from the stored forecast and submit it for native human approval. Pending is not delivered; delivery is simulated.'),
  GetWeatherCommunicationStatus: aiTool('GetWeatherCommunicationStatus', 'Race Control 360 weather: approval and simulated-delivery state of the weather announcement.'),
  GetWeatherResponseStatus: aiTool('GetWeatherResponseStatus', 'Race Control 360 weather: forecast received, warning generated, response recommended, action requested, approved and completed, derived from ServiceNow records.'),
  FocusMapLocation: aiTool('FocusMapLocation', 'Race Control 360: presentation only. Focus the map on a car (abbreviation), a corner name or "incident"; use "overview" to return to the full circuit; use "incidents" or "events" to open the current events list. Set follow to true to follow a car.', [['target', 'Car abbreviation, corner name or incident', true], ['follow', 'true to follow the car']])
};

@customElement('x-snc-2026-f1-race-control-page')
export default class RaceControlPage extends withWidgetContext(AIUXElement) {
  static properties = {
    _scale: {state: true},
    _sel: {state: true},
    _layers: {state: true},
    _layersOpen: {state: true},
    _diagOpen: {state: true},
    _noise: {state: true},
    _dragging: {state: true},
    _tier: {state: true},
    _atOv: {state: true},
    _sn: {state: true},
    _assoc: {state: true},
    _vehicles: {state: true},
    _feed: {state: true},
    _feedOpen: {state: true},
    _toast: {state: true},
    _flash: {state: true},
    _linkOk: {state: true},
    _sim: {state: true},
    _timingOpen: {state: true},
    _timing: {state: true},
    _simBusy: {state: true},
    _simMsg: {state: true},
    _confirmReset: {state: true},
    _incDlg: {state: true},
    _checkOpen: {state: true},
    _menuOpen: {state: true},
    _rfDlg: {state: true},
    _apprOpen: {state: true},
    _evOpen: {state: true},
    _follow: {state: true},
    _confirmDemo: {state: true},
    _scnView: {state: true},
    _scnTab: {state: true},
    _crashFlash: {state: true},
    _wxOpen: {state: true},
    _wxMinute: {state: true},
    _wxPlay: {state: true},
    _wxTab: {state: true},
    _wxEnter: {state: true},
    _immersive: {state: true}
  };

  /* Now Assist: the page tells the shell chat what it is showing and which governed operations it may call. */
  static aiContext = {
    description: 'Race Control 360: a fictional ServiceNow-backed digital twin of Circuit Paul Ricard (practice session, track restrictions, incident response, approvals). The widget state lists the current session, every car, open incidents, response tasks, restart blockers and pending approvals. Use the actions to request changes; a red flag can only be requested, never approved, by the assistant.',
    bestFor: 'Asking about or requesting race-control actions: session status, a stopped car, amber or red restrictions, approvals, response tasks, restart blockers.'
  };

  static client_tools = AI_CLIENT_TOOLS;

  static styles = [
    css`
    :host {
      /* Standard view: sized by the Employee Slate content area (no overlay of the shell). */
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: #ece3cf;
      color: #1b232b;
      font-family: 'Avenir Next', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
      --ink: #1b232b;
      --ink2: #4b5662;
      --ink3: #7b8691;
      --glass: rgba(255, 255, 255, 0.86);
      --line: rgba(27, 35, 43, 0.11);
      --line-strong: rgba(27, 35, 43, 0.2);
      --shadow: 0 10px 30px rgba(74, 58, 30, 0.2), 0 1px 3px rgba(74, 58, 30, 0.12);
      --blue: #2d6fd1;
      --blue-pr: #2f69c4;
      --red-pr: #d2433a;
      --amber: #e8921a;
      --green: #2f9e6a;
      --crit: #d6342a;
      --cond: 'Barlow Condensed', 'Bahnschrift', 'Avenir Next Condensed', 'DIN Condensed', 'Roboto Condensed',
        'Arial Narrow', 'Helvetica Neue', Arial, sans-serif;
      --ease: cubic-bezier(0.22, 0.7, 0.2, 1);
    }
    /* Immersive view: same element and state, covering the viewport as the original full-screen page does.
       Below the shell chat container (z-index 1001) so native Otto can still overlay it. */
    :host([immersive]) {
      position: fixed;
      inset: 0;
      width: auto;
      height: auto;
      z-index: 900;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    .stage {
      position: absolute;
      left: 0;
      top: 0;
      width: 1920px;
      height: 1080px;
      transform-origin: 0 0;
      overflow: hidden;
      background: #e9dfc8;
      user-select: none;
    }

    /* ---------------------------------------------------------- map */
    .map {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
      touch-action: none;
    }
    .map.dragging {
      cursor: grabbing;
    }
    .map:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: -3px;
    }
    .view {
      transform-origin: 0 0;
    }
    .layers-off-terrain [data-layer='terrain'],
    .layers-off-runoff [data-layer='runoff'],
    .layers-off-kerbs [data-layer='kerbs'],
    .layers-off-barriers [data-layer='barriers'],
    .layers-off-pit [data-layer='pit'],
    .layers-off-restrictions [data-layer='restrictions'],
    .layers-off-buildings [data-layer='buildings'],
    .layers-off-emergency [data-layer='emergency'],
    .layers-off-service [data-layer='service'],
    .layers-off-other [data-layer='other'],
    .layers-off-names [data-layer='names'] {
      opacity: 0;
      pointer-events: none;
    }
    [data-layer] {
      transition: opacity 0.35s ease;
    }
    .hit {
      fill: transparent;
      stroke: transparent;
      cursor: pointer;
      outline: none;
    }
    .hit.poly:hover,
    .hit.poly:focus-visible {
      fill: rgba(45, 111, 209, 0.16);
      stroke: var(--blue);
      stroke-width: 1.3px;
      vector-effect: non-scaling-stroke;
    }
    .hit.line {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .hit.line:hover,
    .hit.line:focus-visible {
      stroke: rgba(45, 111, 209, 0.13);
    }

    /* labels: plain text with a soft light halo, tiered by zoom */
    .lbl {
      cursor: pointer;
      outline: none;
      transition: opacity 0.35s ease, visibility 0s;
    }
    .tier-0 .hide0,
    .tier-0 .lbl.t1,
    .tier-0 .lbl.t2,
    .tier-1 .lbl.t2 {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.3s ease, visibility 0s 0.3s;
    }
    .lbl text {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 12.5px;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      fill: #232b34;
      stroke: rgba(255, 253, 246, 0.95);
      stroke-width: 3.4px;
      paint-order: stroke;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .lbl.sm text {
      font-size: 11px;
      font-weight: 600;
      fill: #3a4551;
    }
    .lbl .pill {
      fill: transparent;
      stroke: transparent;
    }
    .lbl:hover .pill,
    .lbl:focus-visible .pill {
      fill: rgba(255, 255, 255, 0.7);
      stroke: var(--blue);
    }
    .lbl.sel .pill {
      fill: #ffffff;
      stroke: var(--blue);
      stroke-width: 1.4px;
    }
    .dot {
      fill: #ffffff;
      stroke: #232b34;
      stroke-width: 1.3;
    }
    .leader {
      stroke: rgba(35, 43, 52, 0.55);
      stroke-width: 1;
      fill: none;
    }

    /* markers */
    .marker {
      cursor: pointer;
      outline: none;
    }
    .marker .mk-ring {
      fill: #ffffff;
      stroke: #232b34;
      stroke-width: 1.5;
    }
    .marker:hover .mk-ring,
    .marker:focus-visible .mk-ring {
      stroke: var(--blue);
      stroke-width: 2.4;
    }
    .marker text {
      font-family: var(--cond);
      font-weight: 700;
      fill: #232b34;
      pointer-events: none;
    }
    .marker.lbl text {
      stroke: none;
      letter-spacing: 0;
    }
    .marker .mk-shadow {
      fill: rgba(60, 46, 24, 0.28);
    }
    .marker .mk-glyph {
      fill: none;
      stroke: #232b34;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .marker .mk-glyph.solid {
      stroke: none;
    }
    .marker .mk-counttxt {
      fill: #fff;
      font-size: 9px;
    }
    .marker .pulse {
      fill: none;
      stroke: var(--crit);
      stroke-width: 2;
      transform-box: fill-box;
      transform-origin: center;
      animation: pulse 2.4s ease-out infinite;
      pointer-events: none;
    }
    @keyframes pulse {
      from {
        opacity: 0.65;
        transform: scale(1);
      }
      to {
        opacity: 0;
        transform: scale(2.2);
      }
    }
    .marker.vehicle {
      transition: transform 1s linear;
    }
    .sel-line {
      fill: none;
      stroke: var(--blue);
      stroke-width: 2.6px;
      vector-effect: non-scaling-stroke;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .sel-glow {
      fill: none;
      stroke: rgba(45, 111, 209, 0.22);
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .sel-poly {
      fill: rgba(45, 111, 209, 0.16);
      stroke: var(--blue);
      stroke-width: 2px;
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .sel-ring {
      fill: none;
      stroke: var(--blue);
      stroke-width: 2.2px;
      pointer-events: none;
    }

    .sun {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(70% 60% at 14% 6%, rgba(255, 247, 224, 0.5), transparent 70%),
        radial-gradient(130% 100% at 50% 50%, transparent 62%, rgba(120, 92, 48, 0.2) 100%),
        linear-gradient(to bottom, rgba(255, 252, 244, 0.65) 0, rgba(255, 252, 244, 0) 110px);
    }
    .grain {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.07;
      mix-blend-mode: multiply;
      background-size: 160px 160px;
    }

    /* ---------------------------------------------------------- top bar */
    .topbar {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 52px;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 0 18px 0 22px;
      background: rgba(255, 255, 255, 0.82);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(14px) saturate(1.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2);
      box-shadow: 0 4px 18px rgba(74, 58, 30, 0.12);
    }
    .topbar::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -1px;
      height: 2px;
      background: linear-gradient(90deg, var(--blue-pr) 0 120px, var(--red-pr) 120px 180px, transparent 180px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 11px;
    }
    .mark {
      width: 25px;
      height: 25px;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: repeat(2, 1fr);
      border-radius: 3px;
      overflow: hidden;
      box-shadow: 0 0 0 1px rgba(27, 35, 43, 0.16);
    }
    .mark i:nth-child(1),
    .mark i:nth-child(4) {
      background: var(--blue-pr);
    }
    .mark i:nth-child(2),
    .mark i:nth-child(3) {
      background: var(--red-pr);
    }
    .wordmark {
      white-space: nowrap;
      font-family: var(--cond);
      font-weight: 700;
      font-size: 22px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      line-height: 1;
    }
    .wordmark b {
      font-weight: 500;
      color: var(--ink3);
      margin-left: 6px;
    }
    .sep {
      width: 1px;
      height: 26px;
      background: var(--line-strong);
    }
    .circuit {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .circuit {
      white-space: nowrap;
      min-width: 0;
    }
    .circuit .name {
      font-family: var(--cond);
      font-weight: 600;
      font-size: 18px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      line-height: 1;
    }
    .circuit .loc {
      font-size: 10.5px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink3);
      line-height: 1;
    }
    .spacer {
      flex: 1;
    }
    .status {
      white-space: nowrap;
      flex: none;
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 0 13px;
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.7);
    }
    .status .k {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink3);
    }
    .status .v {
      font-family: var(--cond);
      font-weight: 600;
      font-size: 15px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink);
    }
    .sdot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1.6px solid var(--ink3);
      flex: none;
    }
    .sdot.amber {
      border-color: var(--amber);
    }
    .sdot.ok {
      border-color: var(--green);
      background: var(--green);
    }
    .sdot.warn {
      border-color: var(--amber);
      background: var(--amber);
    }
    .sdot.crit {
      border-color: var(--crit);
      background: var(--crit);
    }
    .tbtn {
      appearance: none;
      width: 34px;
      height: 34px;
      border-radius: 17px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.7);
      color: var(--ink2);
      display: grid;
      place-items: center;
      cursor: pointer;
      position: relative;
      transition: background 0.18s ease, color 0.18s ease;
    }
    .tbtn:hover:not([disabled]) {
      background: #fff;
      color: var(--ink);
    }
    .tbtn[aria-expanded='true'] {
      background: #fff;
      color: var(--blue);
      border-color: var(--blue);
    }
    .tbtn:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    .tbtn[disabled] {
      color: var(--ink3);
      opacity: 0.7;
      cursor: not-allowed;
    }
    .tbtn .tip {
      position: absolute;
      top: 42px;
      right: 0;
      white-space: nowrap;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line-strong);
      border-radius: 5px;
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateY(-3px);
      transition: opacity 0.16s ease, transform 0.16s ease;
      pointer-events: none;
      z-index: 5;
    }
    .tbtn:hover .tip,
    .tbtn:focus-visible .tip {
      opacity: 1;
      transform: none;
    }

    /* ---------------------------------------------------------- controls */
    .controls {
      position: absolute;
      left: 18px;
      bottom: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: flex-start;
    }
    .cluster {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    .btn {
      appearance: none;
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border: 0;
      background: transparent;
      color: var(--ink);
      cursor: pointer;
      transition: background 0.18s ease, color 0.18s ease;
      position: relative;
    }
    .btn + .btn {
      border-top: 1px solid var(--line);
    }
    .btn:hover:not([disabled]) {
      background: rgba(45, 111, 209, 0.09);
    }
    .btn:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: -3px;
    }
    .btn[aria-expanded='true'] {
      background: rgba(45, 111, 209, 0.14);
      color: var(--blue);
    }
    .btn[disabled] {
      color: var(--ink3);
      opacity: 0.55;
      cursor: not-allowed;
    }
    .btn .tip {
      position: absolute;
      left: 50px;
      white-space: nowrap;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line-strong);
      border-radius: 5px;
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateX(-4px);
      transition: opacity 0.16s ease, transform 0.16s ease;
      pointer-events: none;
      z-index: 5;
    }
    .btn:hover .tip,
    .btn:focus-visible .tip {
      opacity: 1;
      transform: none;
    }
    .credit {
      font-size: 10.5px;
      letter-spacing: 0.03em;
      color: rgba(27, 35, 43, 0.62);
      text-shadow: 0 0 4px rgba(255, 252, 244, 0.95);
      max-width: 430px;
      line-height: 1.4;
    }

    .popover {
      position: absolute;
      left: 56px;
      bottom: 0;
      width: 300px;
      padding: 14px 14px 12px;
      background: var(--glass);
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      animation: rise 0.22s var(--ease);
      max-height: 860px;
      overflow: auto;
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    .eyebrow {
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--ink3);
      margin: 0 0 8px;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 30px;
      font-size: 13px;
      color: var(--ink);
      cursor: pointer;
    }
    .toggle.two {
      height: auto;
      padding: 5px 0;
      align-items: flex-start;
    }
    .toggle.two input {
      margin-top: 2px;
    }
    .toggle .tl {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .toggle small {
      font-size: 11px;
      color: var(--ink3);
      letter-spacing: 0.02em;
    }
    .toggle input {
      appearance: none;
      width: 30px;
      height: 16px;
      border-radius: 9px;
      background: #cdd2d7;
      position: relative;
      margin: 0;
      cursor: pointer;
      transition: background 0.2s ease;
      flex: none;
    }
    .toggle input::after {
      content: '';
      position: absolute;
      left: 2px;
      top: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      transition: transform 0.2s var(--ease);
    }
    .toggle input:checked {
      background: var(--blue);
    }
    .toggle input:checked::after {
      transform: translateX(14px);
    }
    .toggle input:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    details.base {
      margin-top: 8px;
      border-top: 1px solid var(--line);
      padding-top: 8px;
    }
    details.base summary {
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--ink3);
      cursor: pointer;
      height: 24px;
    }
    details.base summary:focus-visible {
      outline: 2px solid var(--blue);
    }
    .foot {
      margin: 10px 0 0;
      font-size: 11px;
      color: var(--ink3);
      line-height: 1.4;
    }

    /* ---------------------------------------------------------- floating cards */
    .card {
      position: absolute;
      right: 18px;
      top: 66px;
      width: 312px;
      max-height: 900px;
      overflow: auto;
      padding: 16px 18px;
      background: var(--glass);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      animation: pop 0.28s var(--ease);
    }
    .card.wide {
      width: 360px;
    }
    @keyframes pop {
      from {
        opacity: 0;
        transform: translateY(-6px) scale(0.985);
      }
    }
    .card .title {
      font-family: var(--cond);
      font-weight: 600;
      font-size: 24px;
      letter-spacing: 0.04em;
      line-height: 1.1;
      margin: 0 28px 4px 0;
    }
    .card .kind {
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink2);
      margin: 0 0 12px;
    }
    .card .x {
      position: absolute;
      right: 10px;
      top: 10px;
      width: 30px;
      height: 30px;
      border: 0;
      background: transparent;
      color: var(--ink2);
      cursor: pointer;
      border-radius: 50%;
      display: grid;
      place-items: center;
    }
    .card .x:hover {
      background: rgba(27, 35, 43, 0.08);
      color: var(--ink);
    }
    .card .x:focus-visible {
      outline: 2px solid var(--blue);
    }
    dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 7px 14px;
      font-size: 12.5px;
    }
    dt {
      color: var(--ink3);
    }
    dd {
      margin: 0;
      color: var(--ink);
      text-align: right;
      overflow-wrap: anywhere;
    }
    .rule {
      height: 1px;
      background: var(--line);
      margin: 12px 0;
    }
    .note {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--ink2);
    }
    .rec-link {
      color: #1f5fbf;
      text-decoration: none;
      font-weight: 600;
    }
    .rec-link:hover {
      text-decoration: underline;
    }
    .rec-link:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    ul.recs {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
      font-size: 12.5px;
    }
    ul.recs li {
      display: grid;
      gap: 1px;
    }
    ul.recs li span {
      color: var(--ink2);
      font-size: 11.5px;
      line-height: 1.35;
    }
    .st.ok::before,
    .st.bad::before,
    .st.warn::before {
      content: '';
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .st.ok::before {
      background: var(--green);
    }
    .st.bad::before {
      background: var(--crit);
    }
    .st.warn::before {
      background: var(--amber);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .act {
      flex: 1 1 auto;
      white-space: nowrap;
      padding: 0 10px;
      height: 32px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-size: 12px;
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: background 0.18s ease;
    }
    .act:hover {
      background: rgba(45, 111, 209, 0.09);
    }
    .act:focus-visible {
      outline: 2px solid var(--blue);
    }

    /* diagnostics */
    .cov {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 25px;
      font-size: 12.5px;
    }
    .cov .pip {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1.5px solid var(--ink3);
      flex: none;
    }
    .cov .pip.on {
      border-color: var(--green);
      background: var(--green);
    }
    .cov .lbl2 {
      flex: 1;
    }
    .cov .val {
      color: var(--ink3);
      font-size: 11.5px;
      text-align: right;
    }
    .legend {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 10px;
      font-size: 11.5px;
      color: var(--ink2);
    }
    .legend div {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .legend .sw {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: none;
    }

    .lead {
      margin: 0 0 12px;
      font-size: 13.5px;
      line-height: 1.45;
      color: var(--ink);
    }
    .lnk {
      appearance: none;
      border: 0;
      background: none;
      padding: 0;
      margin: 0;
      font: inherit;
      color: #1f5fbf;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
    }
    .lnk:hover {
      text-decoration: underline;
    }
    .lnk:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    .resolvedtxt {
      text-decoration: line-through;
      text-decoration-color: rgba(75, 86, 98, 0.45);
    }
    a.act {
      display: grid;
      place-items: center;
      text-decoration: none;
    }
    .act.primary {
      background: var(--blue);
      border-color: var(--blue);
      color: #fff;
      font-weight: 600;
    }
    .act.primary:hover {
      background: #245fb8;
    }
    .marker .mk-check {
      fill: none;
      stroke: #6b7580;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .marker.resolved .mk-glyph {
      opacity: 0.35;
    }
    .marker .changed {
      fill: none;
      stroke: var(--blue);
      stroke-width: 2.4;
      transform-box: fill-box;
      transform-origin: center;
      animation: changed 1.4s ease-out 3;
      pointer-events: none;
    }
    @keyframes changed {
      from {
        opacity: 0.9;
        transform: scale(1);
      }
      to {
        opacity: 0;
        transform: scale(2.6);
      }
    }
    .marker.sn {
      animation: appear 0.45s var(--ease);
    }
    @keyframes appear {
      from {
        opacity: 0;
      }
    }

    /* live activity + toast */
    .feed {
      position: absolute;
      right: 18px;
      bottom: 18px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }
    .feedbtn {
      appearance: none;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: var(--shadow);
      color: var(--ink);
      font-family: var(--cond);
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .feedbtn b {
      font-family: inherit;
      font-size: 12px;
      min-width: 20px;
      height: 20px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      background: var(--ink);
      color: #fff;
      padding: 0 5px;
    }
    .feedbtn:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    .feedcard {
      width: 350px;
      max-height: 440px;
      overflow: auto;
      padding: 12px 14px 10px;
      background: var(--glass);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      animation: pop 0.28s var(--ease);
    }
    .feedcard header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .feedcard ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 9px;
    }
    .feedcard li {
      display: grid;
      grid-template-columns: 10px 1fr;
      gap: 9px;
      font-size: 12.5px;
    }
    .evd {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 5px;
      background: var(--ink3);
    }
    .ev.created .evd,
    .evd.created {
      background: var(--blue);
    }
    .ev.priority .evd,
    .evd.priority {
      background: var(--amber);
    }
    .ev.resolved .evd,
    .evd.resolved {
      background: var(--green);
    }
    .ev.ci .evd,
    .evd.ci {
      background: var(--crit);
    }
    .evt {
      line-height: 1.35;
    }
    .evm {
      font-size: 11px;
      color: var(--ink3);
      margin-top: 1px;
    }
    .xs {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--ink2);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .xs:hover {
      background: rgba(27, 35, 43, 0.08);
    }
    .xs:focus-visible {
      outline: 2px solid var(--blue);
    }
    .toast {
      position: absolute;
      top: 64px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 10px;
      align-items: flex-start;
      max-width: 520px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid var(--line-strong);
      border-radius: 12px;
      box-shadow: var(--shadow);
      font-size: 13px;
      animation: drop 0.4s var(--ease);
    }
    .toast .evd {
      margin-top: 6px;
      flex: none;
    }
    .toast.low {
      top: 126px;
    }
    @keyframes drop {
      from {
        opacity: 0;
        transform: translate(-50%, -10px);
      }
    }

    /* vehicles */
    .car {
      cursor: pointer;
      outline: none;
      transition: opacity 0.3s ease;
    }
    .car .ring {
      display: none;
      fill: rgba(45, 111, 209, 0.12);
      stroke: var(--blue);
      stroke-width: 0.22;
    }
    .car.sel .ring,
    .car:focus-visible .ring,
    .car:hover .ring {
      display: block;
    }
    .tier-0 .car.parked {
      visibility: hidden !important;
      pointer-events: none;
    }
    .carlabel rect {
      fill: #ffffff;
      stroke: var(--blue);
      stroke-width: 1.3;
    }
    .carlabel text {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.08em;
      fill: #232b34;
    }
    .carlabel {
      pointer-events: none;
    }
    .pitcluster {
      cursor: pointer;
      outline: none;
      transition: opacity 0.3s ease;
    }
    .pitcluster rect {
      fill: rgba(255, 255, 255, 0.94);
      stroke: rgba(27, 35, 43, 0.35);
      stroke-width: 1.2;
    }
    .pitcluster text {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.1em;
      fill: #232b34;
      pointer-events: none;
    }
    .pitcluster:hover rect,
    .pitcluster:focus-visible rect {
      stroke: var(--blue);
    }
    .pitcluster.empty,
    .tier-1 .pitcluster,
    .tier-2 .pitcluster {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    .tdot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 2px;
      margin-right: 7px;
      vertical-align: -1px;
    }

    /* live timing */
    .timing {
      position: absolute;
      right: 166px;
      bottom: 18px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }
    .timingcard {
      width: 420px;
      padding: 12px 14px 10px;
      background: var(--glass);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      animation: pop 0.28s var(--ease);
    }
    .timingcard header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .timingcard header > div:first-child {
      flex: 1;
    }
    .tmtitle {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 17px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .tmstate {
      font-size: 11px;
      margin-left: 6px;
      padding: 2px 7px;
      border-radius: 9px;
      background: rgba(27, 35, 43, 0.08);
      color: var(--ink2);
      vertical-align: 2px;
    }
    .tmstate.running {
      background: rgba(47, 158, 106, 0.16);
      color: #1d7a4e;
    }
    .tmstate.paused {
      background: rgba(232, 146, 26, 0.18);
      color: #a35f06;
    }
    .tmclock {
      font-family: var(--cond);
      font-weight: 600;
      font-size: 19px;
      letter-spacing: 0.06em;
      font-variant-numeric: tabular-nums;
      color: var(--ink2);
    }
    .tmhead,
    .tmrows button {
      display: grid;
      grid-template-columns: 22px 5px 40px 30px 34px 66px 1fr;
      align-items: center;
      gap: 8px;
    }
    .tmhead {
      font-size: 9.5px;
      letter-spacing: 0.16em;
      color: var(--ink3);
      padding: 0 6px 4px;
      border-bottom: 1px solid var(--line);
    }
    .tmrows {
      list-style: none;
      margin: 4px 0 0;
      padding: 0;
    }
    .tmrows button {
      width: 100%;
      appearance: none;
      border: 0;
      background: transparent;
      text-align: left;
      padding: 5px 6px;
      border-radius: 7px;
      cursor: pointer;
      font: inherit;
      color: var(--ink);
      font-size: 13px;
    }
    .tmrows button:hover,
    .tmrows li.sel button {
      background: rgba(45, 111, 209, 0.1);
    }
    .tmrows button:focus-visible {
      outline: 2px solid var(--blue);
    }
    .tmrows .p {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 15px;
      text-align: center;
    }
    .tmrows .tc {
      width: 5px;
      height: 18px;
      border-radius: 2px;
    }
    .tmrows .d {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.06em;
    }
    .tmrows .n,
    .tmrows .l,
    .tmrows .g {
      font-variant-numeric: tabular-nums;
      color: var(--ink2);
      font-size: 12.5px;
    }
    .tmrows .s {
      font-size: 10.5px;
      letter-spacing: 0.12em;
      color: var(--ink3);
    }
    .tmrows .s.track,
    .tmrows .s.approaching {
      color: #1d7a4e;
      font-weight: 600;
    }
    .tmrows .s.leaving,
    .tmrows .s.entering {
      color: #a35f06;
      font-weight: 600;
    }
    .tmctl {
      display: flex;
      gap: 6px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }
    .tmctl .act {
      height: 30px;
      padding: 0 4px;
    }
    .tmctl .act[disabled],
    .actions .act[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .tmctl .act.warn {
      border-color: var(--crit);
      color: var(--crit);
      font-weight: 600;
    }
    .simmsg {
      margin: 8px 0 0;
      font-size: 12px;
      color: #1d7a4e;
    }
    .simmsg.bad {
      color: var(--crit);
    }

    /* v4: driver markers */
    .car .sh {
      fill: rgba(58, 45, 28, 0.3);
    }
    .car .body {
      stroke-width: 2.2;
    }
    .car text {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 13.5px;
      letter-spacing: 0.04em;
      pointer-events: none;
    }
    .car .selring,
    .car .stopring {
      display: none;
      fill: none;
    }
    .car.sel .selring,
    .car:hover .selring,
    .car:focus-visible .selring {
      display: block;
      stroke: var(--blue);
      stroke-width: 2.6;
    }
    .car.stopped .stopring {
      display: block;
      stroke: var(--crit);
      stroke-width: 2.6;
      stroke-dasharray: 6 4;
      animation: spinring 9s linear infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
    @keyframes spinring {
      to {
        transform: rotate(360deg);
      }
    }
    .car.retired {
      filter: grayscale(1);
      opacity: 0.6 !important;
    }

    /* v4: restrictions, routes, response vehicles */
    .rz-band {
      fill: none;
      stroke: #f2a516;
      opacity: 0.13;
      stroke-linejoin: round;
      animation: rzpulse 2.8s ease-in-out infinite;
    }
    .rz-band.red {
      stroke: #d6342a;
      opacity: 0.15;
    }
    .rz-edge {
      fill: none;
      stroke: #f2a516;
      stroke-width: 1.5;
      stroke-linejoin: round;
      opacity: 0.95;
    }
    .rz-edge.red {
      stroke: #d6342a;
    }
    @keyframes rzpulse {
      50% {
        opacity: 0.1;
      }
    }
    .routeline {
      fill: none;
      stroke-width: 1.8;
      stroke-dasharray: 5 4;
      stroke-linecap: round;
      opacity: 0.8;
    }
    .routeline.fire {
      stroke: #e8590c;
    }
    .routeline.medical {
      stroke: #2d6fd1;
    }
    .routeline.recovery {
      stroke: #e8921a;
    }
    .resp {
      cursor: pointer;
      outline: none;
      --rc: #2d6fd1;
    }
    .resp.fire {
      --rc: #e8590c;
    }
    .resp.recovery {
      --rc: #c97a0a;
    }
    .resp .sh {
      fill: rgba(58, 45, 28, 0.3);
    }
    .resp .rbody {
      fill: #ffffff;
      stroke: var(--rc);
      stroke-width: 2.4;
    }
    .resp .rglyph {
      fill: var(--rc);
      stroke: none;
      transform: scale(0.95);
    }
    .resp.recovery .rglyph {
      fill: none;
      stroke: var(--rc);
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
      transform: scale(0.85);
    }
    .resp.sel .rbody,
    .resp:hover .rbody,
    .resp:focus-visible .rbody {
      stroke-width: 3.4;
    }
    .resp.onscene .rbody {
      stroke-dasharray: 3 2.4;
    }
    .crashmk.hidden {
      display: none;
    }

    /* v4: incident banner, status chips */
    .rcalert {
      position: absolute;
      top: 62px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 760px;
      padding: 9px 18px 9px 14px;
      appearance: none;
      border: 1px solid var(--line-strong);
      border-left: 5px solid #f2a516;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: var(--shadow);
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: var(--ink);
      animation: drop 0.4s var(--ease);
    }
    .rcalert.red {
      border-left-color: var(--crit);
    }
    .rcalert:hover {
      background: #fff;
    }
    .rcalert:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }
    .rcalert .adot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--crit);
      box-shadow: 0 0 0 0 rgba(214, 52, 42, 0.5);
      animation: adot 2s ease-out infinite;
      flex: none;
    }
    @keyframes adot {
      to {
        box-shadow: 0 0 0 10px rgba(214, 52, 42, 0);
      }
    }
    .rcalert .atxt {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .rcalert b {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 16px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .rcalert small {
      font-size: 12px;
      color: var(--ink2);
    }
    .topbar.redflag::after {
      background: var(--crit);
      height: 3px;
    }
    .status.redchip {
      background: var(--crit);
      border-color: var(--crit);
    }
    .status.redchip .k,
    .status.redchip .v {
      color: #fff;
    }
    .status.redchip .sdot {
      background: #fff;
      border-color: #fff;
    }
    .chip {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 9px;
      font-size: 10.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(27, 35, 43, 0.08);
      color: var(--ink2);
    }
    .chip.ok {
      background: rgba(47, 158, 106, 0.16);
      color: #1d7a4e;
    }
    .chip.warn {
      background: rgba(232, 146, 26, 0.2);
      color: #9a5a05;
    }
    .chip.bad {
      background: rgba(214, 52, 42, 0.16);
      color: #b02820;
    }

    /* v4: incident response card */
    .card.scn {
      width: 372px;
    }
    .row2 {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    ul.recs.dec li,
    ul.recs li .mut {
      font-size: 11.5px;
    }
    .mut {
      color: var(--ink3);
    }
    .act.sm {
      height: 26px;
      font-size: 11.5px;
      padding: 0 9px;
      flex: 0 0 auto;
    }
    details.check summary {
      font-size: 10px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--ink3);
      cursor: pointer;
      height: 22px;
    }
    details.check summary:focus-visible {
      outline: 2px solid var(--blue);
    }
    ul.ck li {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 8px;
      align-items: start;
    }
    ul.ck .box {
      width: 16px;
      height: 16px;
      border: 1.5px solid var(--ink3);
      border-radius: 4px;
      display: grid;
      place-items: center;
      font-size: 11px;
      color: #fff;
      margin-top: 1px;
    }
    ul.ck li.done .box {
      background: var(--green);
      border-color: var(--green);
    }
    ul.ck small {
      color: var(--ink3);
      font-size: 11px;
    }
    .note.bl {
      color: #9a5a05;
      margin-top: 6px;
    }
    .dlg {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid var(--line-strong);
      border-radius: 10px;
      background: #fff;
    }
    .dlg .sel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12.5px;
      margin-bottom: 8px;
    }
    .dlg select {
      font: inherit;
      font-size: 12.5px;
      padding: 4px 6px;
      border-radius: 6px;
      border: 1px solid var(--line-strong);
      background: #fff;
    }
    .warnnote {
      color: #9a5a05;
      margin-top: 8px;
    }
    .incbtn {
      width: 100%;
      margin-top: 8px;
      flex: none;
    }
    .ev.crit .evd,
    .evd.crit {
      background: var(--crit);
    }
    .ev.warnc .evd,
    .evd.warnc {
      background: var(--amber);
    }

    /* ---- V5: operator controls ---- */
    .opsbar {
      position: absolute;
      left: 22px;
      top: 62px;
      z-index: 7;
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .crashbtn,
    .rcbtn {
      height: 30px;
      padding: 0 13px;
      border-radius: 15px;
      border: 1px solid var(--line-strong);
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      font-family: var(--cond);
      font-weight: 600;
      font-size: 12.5px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(74, 58, 30, 0.14);
    }
    .crashbtn {
      color: #a3261d;
      border-color: rgba(214, 52, 42, 0.5);
    }
    .crashbtn::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crit);
    }
    .crashbtn:hover:not([disabled]),
    .rcbtn:hover {
      background: #fff;
    }
    .crashbtn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .crashbtn:focus-visible,
    .rcbtn:focus-visible,
    .mi:focus-visible,
    .evbtn:focus-visible,
    .followchip button:focus-visible,
    .evrow:focus-visible {
      outline: 2px solid #2b6cb0;
      outline-offset: 2px;
    }
    .rcbtn .badge {
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--amber);
      color: #fff;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .rcwrap {
      position: relative;
    }
    .rcmenu {
      position: absolute;
      top: 36px;
      left: 0;
      min-width: 270px;
      padding: 6px;
      background: rgba(255, 255, 255, 0.97);
      border: 1px solid var(--line-strong);
      border-radius: 12px;
      box-shadow: 0 14px 34px rgba(74, 58, 30, 0.22);
    }
    .rcmenu .mhead {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 6px 10px 8px;
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink3);
    }
    .rcmenu .mhead b {
      font-family: var(--cond);
      font-size: 14px;
      letter-spacing: 0.08em;
      color: var(--ink);
    }
    .mi {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      font: inherit;
      font-size: 13px;
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    .mi small {
      font-size: 11px;
      color: var(--ink3);
    }
    .mi:hover:not([disabled]) {
      background: rgba(74, 58, 30, 0.07);
    }
    .mi[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .mi.danger span {
      color: #a3261d;
    }
    .msep {
      height: 1px;
      margin: 5px 6px;
      background: var(--line);
    }
    .scrim {
      position: absolute;
      inset: 0;
      border: 0;
      padding: 0;
      cursor: default;
      z-index: 20;
      background: rgba(40, 32, 20, 0.28);
    }
    .modal {
      position: absolute;
      z-index: 21;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 430px;
      max-width: calc(100% - 32px);
      max-height: calc(100% - 40px);
      overflow: auto;
      padding: 18px 20px;
      background: #fff;
      border: 1px solid var(--line-strong);
      border-radius: 14px;
      box-shadow: 0 24px 60px rgba(40, 32, 20, 0.34);
    }
    .mtitle {
      margin: 0 0 10px;
      font-family: var(--cond);
      font-size: 22px;
      letter-spacing: 0.04em;
      color: var(--ink);
    }
    .mdl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 14px;
      margin: 0 0 10px;
      font-size: 13px;
    }
    .mdl dt {
      color: var(--ink3);
    }
    .mdl dd {
      margin: 0;
      color: var(--ink);
    }
    .modal .sel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 13px;
      margin-bottom: 10px;
    }
    .modal select,
    .txt {
      font: inherit;
      font-size: 13px;
      padding: 5px 8px;
      border-radius: 7px;
      border: 1px solid var(--line-strong);
      background: #fff;
      color: var(--ink);
    }
    .txt {
      flex: 1;
      min-width: 0;
    }
    .opts {
      margin: 0 0 10px;
      padding: 8px 10px 6px;
      border: 1px solid var(--line);
      border-radius: 10px;
    }
    .opts legend {
      padding: 0 6px;
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink3);
    }
    .radio {
      display: flex;
      gap: 9px;
      align-items: flex-start;
      padding: 5px 0;
      font-size: 13px;
      cursor: pointer;
    }
    .radio input {
      margin-top: 3px;
    }
    .radio small {
      display: block;
      font-size: 11.5px;
      color: var(--ink3);
      margin-top: 1px;
    }
    .note.bad,
    .bad {
      color: #a3261d;
    }
    .status.amberchip {
      background: #f2a516;
      border-color: #f2a516;
    }
    .status.amberchip .k,
    .status.amberchip .v {
      color: #2d2108;
    }
    .status.amberchip .sdot {
      background: #2d2108;
      border-color: #2d2108;
    }
    .pendtag {
      font-family: var(--cond);
      font-size: 11px;
      letter-spacing: 0.1em;
      padding: 1px 7px;
      border-radius: 9px;
      border: 1px solid var(--crit);
      color: var(--crit);
      background: #fff;
    }
    .status.redchip .pendtag {
      color: var(--crit);
    }
    .evbtn {
      font: inherit;
      cursor: pointer;
    }
    .evbtn:hover {
      background: #fff;
    }
    .evpanel,
    .apprcard {
      position: absolute;
      z-index: 8;
      width: 340px;
      max-height: min(60vh, 520px);
      overflow: auto;
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.97);
      border: 1px solid var(--line-strong);
      border-radius: 12px;
      box-shadow: 0 14px 34px rgba(74, 58, 30, 0.22);
    }
    .evpanel {
      right: 18px;
      top: 62px;
    }
    .apprcard {
      left: 22px;
      top: 104px;
    }
    .evpanel header,
    .apprcard header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .evpanel ul,
    .apprcard ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .apprcard li {
      display: grid;
      gap: 3px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 9px;
      font-size: 12.5px;
    }
    .evrow {
      display: flex;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fff;
      font: inherit;
      text-align: left;
      cursor: pointer;
      color: var(--ink);
    }
    .evrow:hover {
      background: rgba(74, 58, 30, 0.05);
    }
    .evrow .evd {
      margin-top: 5px;
      flex: none;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--ink3);
    }
    .evrow.crit .evd {
      background: var(--crit);
    }
    .evrow.warnc .evd {
      background: var(--amber);
    }
    .evb {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .evh {
      display: flex;
      gap: 8px;
      align-items: baseline;
      font-size: 12.5px;
    }
    .evp {
      font-family: var(--cond);
      font-size: 11px;
      letter-spacing: 0.08em;
      color: var(--ink3);
    }
    .evs {
      margin-left: auto;
      font-size: 11px;
      color: var(--ink3);
    }
    .evt2 {
      font-size: 12.5px;
    }
    .evl {
      font-size: 11px;
      color: var(--ink3);
    }
    .followchip {
      position: absolute;
      z-index: 6;
      top: 62px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px 6px 14px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid var(--line-strong);
      border-radius: 18px;
      font-family: var(--cond);
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink);
      box-shadow: 0 6px 18px rgba(74, 58, 30, 0.16);
    }
    .followchip.low {
      top: 126px;
    }
    .followchip button {
      font: inherit;
      font-size: 11px;
      letter-spacing: 0.08em;
      padding: 4px 10px;
      border-radius: 12px;
      border: 1px solid var(--line-strong);
      background: #fff;
      cursor: pointer;
      color: var(--ink);
    }

    /* ---- V5.1 ---- */
    .crashflash {
      position: absolute;
      inset: 0;
      z-index: 30;
      pointer-events: none;
      border: 10px solid #e5251b;
      box-shadow: inset 0 0 70px 14px rgba(229, 37, 27, 0.55);
      opacity: 0;
      animation: crashpulse 1.05s ease-in-out 3;
    }
    @keyframes crashpulse {
      0%,
      100% {
        opacity: 0;
      }
      45% {
        opacity: 1;
      }
    }
    .sig {
      pointer-events: none;
    }
    .sig .hous {
      fill: #232a31;
      stroke: #f4f1ea;
      stroke-width: 1.4;
    }
    .sig .lens {
      fill: #3a4540;
    }
    .sig .grid {
      stroke: rgba(10, 14, 16, 0.55);
      stroke-width: 1;
    }
    .sig .bloom {
      fill: #ffc61a;
      opacity: 0;
    }
    .sig .pole {
      display: none;
      fill: none;
      stroke: #232a31;
      stroke-width: 2;
    }
    .tier-1 .sigin,
    .tier-2 .sigin {
      transform: scale(1.45);
    }
    .tier-1 .sig .pole,
    .tier-2 .sig .pole {
      display: block;
    }
    .mode-green .sig .lens {
      fill: #3f8f5a;
      opacity: 0.7;
    }
    .mode-amber .sig .lens,
    .mode-local .sig.lit .lens {
      animation: sigamber 1s steps(1, end) infinite;
    }
    .mode-red .sig .lens {
      animation: sigred 0.8s steps(1, end) infinite;
    }
    .mode-amber .sig .bloom,
    .mode-local .sig.lit .bloom {
      animation: sigbloom 1s steps(1, end) infinite;
    }
    .mode-red .sig .bloom {
      fill: #ff2a1f;
      animation: sigbloom 0.8s steps(1, end) infinite;
    }
    @keyframes sigamber {
      0%,
      49.9% {
        fill: #ffd23a;
      }
      50%,
      100% {
        fill: #5a4a10;
      }
    }
    @keyframes sigred {
      0%,
      49.9% {
        fill: #ff3b30;
      }
      50%,
      100% {
        fill: #5a1410;
      }
    }
    @keyframes sigbloom {
      0%,
      49.9% {
        opacity: 0.55;
      }
      50%,
      100% {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .crashflash {
        animation: none;
        opacity: 1;
      }
      .mode-amber .sig .lens,
      .mode-local .sig.lit .lens,
      .mode-red .sig .lens,
      .mode-amber .sig .bloom,
      .mode-local .sig.lit .bloom,
      .mode-red .sig .bloom {
        animation: none;
      }
      .mode-amber .sig .lens,
      .mode-local .sig.lit .lens {
        fill: #ffd23a;
      }
      .mode-red .sig .lens {
        fill: #ff3b30;
      }
    }
    .card.scn2 {
      width: 540px;
      padding: 20px 24px 22px;
      max-height: calc(100% - 90px);
    }
    .scn2 .eyebrow2 {
      margin: 0 0 6px;
      font-size: 14px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink3);
    }
    .scn2 h2 {
      margin: 0;
      font-family: var(--cond);
      font-size: 30px;
      line-height: 1.1;
      color: var(--ink);
    }
    .scn2 .sub {
      margin: 6px 0 0;
      font-size: 18px;
      color: var(--ink);
    }
    .scn2 .sub a {
      font-size: 14px;
      margin-left: 8px;
    }
    .trkrow {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 16px 0 14px;
    }
    .trkpill {
      padding: 7px 16px;
      border-radius: 20px;
      font-family: var(--cond);
      font-weight: 700;
      font-size: 20px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #fff;
      background: #2f8f55;
    }
    .trkpill.amber,
    .trkpill.caution {
      background: #f2a516;
      color: #2d2108;
    }
    .trkpill.red {
      background: #d6342a;
    }
    .trkrow .ses {
      font-size: 17px;
      color: var(--ink3);
    }
    .prog {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 14.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink3);
    }
    .prog b {
      font-family: var(--cond);
      font-size: 20px;
      letter-spacing: 0.04em;
      color: var(--ink);
    }
    .bar {
      height: 8px;
      margin: 8px 0 12px;
      border-radius: 4px;
      background: rgba(74, 58, 30, 0.12);
      overflow: hidden;
    }
    .bar i {
      display: block;
      height: 100%;
      background: #2f8f55;
      transition: width 0.4s var(--ease);
    }
    .steps {
      list-style: none;
      margin: 0 0 16px;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .steps li {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 18px;
      color: var(--ink);
    }
    .steps .ic {
      flex: none;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid var(--ink3);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
    }
    .steps .done .ic {
      background: #2f8f55;
      border-color: #2f8f55;
      color: #fff;
    }
    .steps .prog2 .ic {
      border-color: #f2a516;
      background: #fff3d6;
    }
    .steps .st {
      margin-left: auto;
      font-size: 15px;
      color: var(--ink3);
    }
    .steps .done .st {
      color: #2f8f55;
    }
    .steps .prog2 .st {
      color: #b57600;
    }
    .scn2 .actions2 {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .scn2 .act.big {
      height: auto;
      min-height: 48px;
      line-height: 1.2;
      font-size: 17px;
      padding: 11px 18px;
      flex: 1 1 auto;
      justify-content: center;
    }
    .scn2 .act.big.primary {
      flex: 2 1 auto;
    }
    .scn2 .tabs {
      display: flex;
      gap: 4px;
      margin: 10px 0 12px;
      border-bottom: 1px solid var(--line);
    }
    .scn2 .tabs button {
      font: inherit;
      font-size: 15px;
      padding: 8px 12px;
      border: 0;
      background: transparent;
      color: var(--ink3);
      border-bottom: 3px solid transparent;
      cursor: pointer;
    }
    .scn2 .tabs button[aria-selected='true'] {
      color: var(--ink);
      border-bottom-color: var(--blue);
      font-weight: 600;
    }
    .scn2 .det,
    .scn2 .det .recs li {
      font-size: 15px;
    }
    .scn2 .backlink {
      font: inherit;
      font-size: 15px;
      border: 0;
      background: transparent;
      color: var(--blue);
      cursor: pointer;
      padding: 0;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
      .popover,
      .card,
      .feedcard,
      .toast,
      .marker.sn,
      .marker .changed,
      .marker .pulse {
        animation: none;
      }
      [data-layer],
      .lbl {
        transition: none;
      }
    }
    @media (forced-colors: active) {
      .btn,
      .card,
      .popover,
      .status,
      .tbtn {
        border: 1px solid CanvasText;
      }
    }
  `,
    weatherStyles,
    /* Standard View: UI renders at 1:1 pixels inside the pane, so panels and the top bar adapt to the container
       instead of shrinking with a global scale. Immersive View is a fixed 1920px stage, where none of these bind. */
    css`
    .stage {
      container-type: size;
    }
    .card,
    .card.wide,
    .card.scn,
    .evpanel,
    .apprcard,
    .feedcard,
    .timingcard,
    .wxpanel,
    .popover {
      max-width: calc(100cqw - 36px);
    }
    .card {
      max-height: calc(100cqh - 150px);
    }
    .wxpanel {
      max-height: calc(100cqh - 80px);
    }
    .evpanel,
    .apprcard,
    .popover {
      max-height: calc(100cqh - 130px);
      overflow: auto;
    }
    .feedcard {
      max-height: min(440px, calc(100cqh - 130px));
      overflow: auto;
    }
    @container (max-width: 1760px) {
      .circuit .loc {
        display: none;
      }
    }
    @container (max-width: 1640px) {
      .circuit,
      .sep {
        display: none;
      }
    }
    @container (max-width: 1280px) {
      .status .k {
        display: none;
      }
      .topbar {
        gap: 10px;
        padding: 0 12px 0 14px;
      }
    }
    @container (max-width: 1100px) {
      .card {
        width: min(312px, 46cqw);
      }
      .card.wide {
        width: min(360px, 50cqw);
      }
      .card.scn {
        width: min(372px, 54cqw);
      }
      .wxpanel {
        width: min(440px, 64cqw);
      }
      .timingcard {
        width: min(420px, 60cqw);
      }
      .credit {
        max-width: min(430px, 34cqw);
      }
    }
    @container (max-width: 900px) {
      .chip-cars,
      .chip-link {
        display: none;
      }
    }
    @container (max-width: 760px) {
      .chip-session {
        display: none;
      }
    }
    `
  ];

  constructor() {
    super();
    this._view = {k: 1, tx: 0, ty: 0};
    this._scale = 1;
    this._SW = DESIGN_W;
    this._SH = DESIGN_H;
    this._sel = null;
    this._layers = Object.fromEntries(OPS_LAYERS.concat(BASE_LAYERS).map(l => [l.id, true]));
    this._layersOpen = false;
    this._diagOpen = false;
    this._noise = '';
    this._dragging = false;
    this._tier = 0;
    this._atOv = true;
    this._fitView = {k: 1, tx: 0, ty: 0};
    this._pointers = new Map();
    this._sceneHtml = null;
    this._sn = {state: 'loading', locations: [], cis: [], incidents: [], alerts: [], teams: []};
    this._assoc = EMPTY_ASSOC;
    this._vehicles = [];
    this._allCache = null;
    this._target = null;
    this._feed = [];
    this._feedOpen = false;
    this._toast = null;
    this._flash = new Set();
    this._seenFeed = new Set();
    this._linkOk = true;
    this._loading = false;
    this._lastFull = 0;
    this._sim = null;
    this._simSig = '';
    this._wxOpen = false;
    this._wxMinute = 0;
    this._wxPlay = false;
    this._wxTab = 'forecast';
    this._wxEnter = 0;
    this._seenWx = new Set();
    this._lastTool = null;
    this._clockOffset = 0;
    this._clockSynced = false;
    this._timingOpen = false;
    this._timing = null;
    this._simBusy = null;
    this._simMsg = null;
    this._confirmReset = false;
    this._poses = new Map();
    this._spots = new Map();
    this._carEls = new Map();
    this._lastTiming = 0;
    this._simOk = true;
    this._incDlg = null;
    this._checkOpen = false;
    this._menuOpen = false;
    this._immersive = false;
    this._rfDlg = null;
    this._apprOpen = false;
    this._evOpen = false;
    this._follow = null;
    this._confirmDemo = false;
    this._scnView = 'summary';
    this._scnTab = 'response';
    this._crashFlash = 0;
    this._seenScn = new Set();
    this._closedScn = null;
    this._seenRc = new Set();
    this._respEls = new Map();
    this._respPos = new Map();
    this._routes = new Map();
    this._restrictionKey = '';
    this._rz = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._fitView = this._computeFit();
    this._view = {...this._fitView};
    if (!isServer) {
      try {
        const saved = JSON.parse(localStorage.getItem(LAYER_KEY) || 'null');
        if (saved && typeof saved === 'object') this._layers = {...this._layers, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in this._layers && typeof v === 'boolean'))};
      } catch {
        /* preference only */
      }
    }
  }

  firstUpdated() {
    if (isServer) return;
    document.title = t('Race Control 360 | Circuit Paul Ricard');
    this._ro = new ResizeObserver(() => this._fitStage());
    this._ro.observe(this);
    this._fitStage();
    this._noise = this._makeNoise();
    this._onEsc = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      /* Escape belongs to the page only when focus is on the page itself or on nothing (body). Keys typed in native
         shell controls such as the Otto input (which may sit in a closed shadow root) must never dismiss anything here. */
      const ae = document.activeElement;
      if (!e.composedPath().includes(this) && ae && ae !== document.body) return;
      /* 1. dialogs and confirmations */
      if (this._incDlg) this._incDlg = null;
      else if (this._rfDlg) this._rfDlg = null;
      else if (this._confirmReset) this._confirmReset = false;
      else if (this._confirmDemo) this._confirmDemo = false;
      /* 2. open panels, then camera follow */
      else if (this._menuOpen) this._menuOpen = false;
      else if (this._apprOpen) this._apprOpen = false;
      else if (this._evOpen) this._evOpen = false;
      else if (this._wxOpen) this._wxToggle();
      else if (this._layersOpen) this._layersOpen = false;
      else if (this._timingOpen) this._timingOpen = false;
      else if (this._diagOpen) this._diagOpen = false;
      else if (this._follow) this._follow = null;
      /* 3. leave Immersive View (presentation only; never touches session or records) */
      else if (this._immersive) this._setImmersive(false);
      /* Standard View keeps the original behaviour */
      else if (this._sel || !this._atOv) this._backToOverview();
    };
    window.addEventListener('keydown', this._onEsc);
    this._onVis = () => !document.hidden && this._loadSim();
    document.addEventListener('visibilitychange', this._onVis);
    this._loadSn();
    this._loadSim();
    this._refresh = setInterval(() => this._poll(), SN_CONFIG.pollMs);
    this._raf2 = requestAnimationFrame(this._tick);
  }

  /** Presentation only: toggles Immersive View (full-viewport overlay) vs Standard ServiceNow View on the same element. */
  _setImmersive(on) {
    this._immersive = !!on;
    this.toggleAttribute('immersive', this._immersive);
    this._fitStage();
  }

  updated() {
    this._applyView(this._view);
    const root = this.renderRoot;
    this._carEls = new Map();
    root.querySelectorAll('.car').forEach(g => this._carEls.set(g.dataset.vid, {root: g, ready: g.style.opacity === '1'}));
    this._respEls = new Map();
    root.querySelectorAll('.resp').forEach(g => this._respEls.set(g.dataset.rid, g));
    this._crashEl = root.querySelector('#rc-crashmarker');
    const pc = root.querySelector('#rc-pitcluster');
    if (pc !== this._pcEl) this._pcText = null;
    this._pcEl = pc;
    this._lblEl = root.querySelector('#rc-carlabel');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._raf2);
    document.removeEventListener('visibilitychange', this._onVis);
    clearInterval(this._refresh);
    clearTimeout(this._flashT);
    clearTimeout(this._toastTimer);
    clearTimeout(this._flashTimer);
    clearInterval(this._wxTimer);
    clearTimeout(this._wxEnterT);
    if (this._onEsc) window.removeEventListener('keydown', this._onEsc);
  }

  /* ------------------------------------------------------- geometry helpers */
  _computeFit() {
    const b = SCENE_BOUNDS;
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const availW = this._SW - SIDE_INSET * 2;
    const availH = this._SH - TOP_INSET - BOTTOM_INSET;
    const k = Math.min((availW * 0.985) / bw, (availH * 0.985) / bh);
    const tx = (this._SW - bw * k) / 2 - b.x0 * k;
    const ty = TOP_INSET + (availH - bh * k) / 2 - b.y0 * k;
    return {k, tx, ty};
  }

  /**
   * Standard View: the stage is exactly the pane the shell gives us (1:1 CSS pixels, so every control stays readable)
   * and the map camera is re-fitted to it. Immersive View keeps the fixed 1920x1080 composition, scaled to the viewport.
   */
  _fitStage() {
    const w = this.clientWidth || window.innerWidth;
    const h = this.clientHeight || window.innerHeight;
    const oSW = this._SW;
    const oSH = this._SH;
    if (this._immersive) {
      this._SW = DESIGN_W;
      this._SH = DESIGN_H;
      this._scale = Math.min(w / DESIGN_W, h / DESIGN_H);
      this._offX = (w - DESIGN_W * this._scale) / 2;
      this._offY = (h - DESIGN_H * this._scale) / 2;
    } else {
      this._SW = Math.max(320, w);
      this._SH = Math.max(320, h);
      this._scale = 1;
      this._offX = 0;
      this._offY = 0;
    }
    /* Driver markers: full size in Immersive, proportionally smaller (never microscopic) in a narrow pane. */
    this._mk = this._immersive ? 1 : Math.min(0.9, Math.max(0.55, this._SW / 1500));
    if (oSW !== this._SW || oSH !== this._SH) {
      const of = this._fitView;
      const wasOv = this._atOv;
      this._cancelAnim();
      this._fitView = this._computeFit();
      const v = this._view;
      if (wasOv) this._applyView({...this._fitView});
      else {
        /* Keep the same world point at the centre and the same relative zoom. */
        const cx = (oSW / 2 - v.tx) / v.k;
        const cy = (oSH / 2 - v.ty) / v.k;
        const k = this._clampK(v.k * (this._fitView.k / of.k));
        this._applyView({k, tx: this._SW / 2 - cx * k, ty: this._SH / 2 - cy * k});
      }
    }
    this.requestUpdate();
  }

  /** Subtle grain tile, generated once; no external assets. */
  _makeNoise() {
    try {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const g = c.getContext('2d');
      const img = g.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 100 + Math.random() * 110;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 40 + Math.random() * 90;
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  _stagePoint(e) {
    const r = this.renderRoot.querySelector('.stage').getBoundingClientRect();
    return [(e.clientX - r.left) / this._scale, (e.clientY - r.top) / this._scale];
  }

  /* ------------------------------------------------------- view / camera */
  _clampK(k) {
    return Math.min(Math.max(k, this._fitView.k * 0.9), this._fitView.k * MAX_ZOOM);
  }

  /** Writes the camera straight to the DOM (no re-render per frame). Tier / overview flags re-render only on change. */
  _applyView(v) {
    this._view = v;
    const g = this._viewEl && this._viewEl.isConnected ? this._viewEl : (this._viewEl = this.renderRoot.querySelector('.view'));
    if (g) {
      g.style.transform = `translate(${v.tx.toFixed(2)}px, ${v.ty.toFixed(2)}px) scale(${v.k.toFixed(5)})`;
      g.style.setProperty('--inv', (1 / v.k).toFixed(5));
    }
    const rel = v.k / this._fitView.k;
    const tier = rel < TIER_1 ? 0 : rel < TIER_2 ? 1 : 2;
    if (tier !== this._tier) this._tier = tier;
    const f = this._fitView;
    const atOv = Math.abs(v.k - f.k) < f.k * 0.004 && Math.abs(v.tx - f.tx) < 3 && Math.abs(v.ty - f.ty) < 3;
    if (atOv !== this._atOv) this._atOv = atOv;
  }

  _cancelAnim() {
    cancelAnimationFrame(this._raf);
    this._target = null;
  }

  /** Eased camera move. Interpolates the world point at screen centre and log-zoom, so nothing slides against the map. */
  _animateTo(target, ms = 800, ease = easeInOutCubic) {
    cancelAnimationFrame(this._raf);
    const to = {k: this._clampK(target.k), tx: target.tx, ty: target.ty};
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || ms <= 0) {
      this._target = null;
      this._applyView(to);
      return;
    }
    this._target = to;
    const from = {...this._view};
    const CX = this._SW / 2;
    const CY = this._SH / 2;
    const centre = v => ({x: (CX - v.tx) / v.k, y: (CY - v.ty) / v.k});
    const a = centre(from);
    const b = centre(to);
    const lk0 = Math.log(from.k);
    const lk1 = Math.log(to.k);
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      const e = ease(p);
      const k = Math.exp(lk0 + (lk1 - lk0) * e);
      const x = a.x + (b.x - a.x) * e;
      const y = a.y + (b.y - a.y) * e;
      this._applyView({k, tx: CX - x * k, ty: CY - y * k});
      if (p < 1) this._raf = requestAnimationFrame(step);
      else {
        this._target = null;
        this._applyView(to);
      }
    };
    this._raf = requestAnimationFrame(step);
  }

  _zoomTarget(factor, px, py) {
    const base = this._target || this._view;
    const nk = this._clampK(base.k * factor);
    const f = nk / base.k;
    return {k: nk, tx: px - (px - base.tx) * f, ty: py - (py - base.ty) * f};
  }

  _zoomBtn(factor) {
    this._animateTo(this._zoomTarget(factor, this._SW / 2, (this._SH + TOP_INSET) / 2), 520, easeOutCubic);
  }

  _fitAll() {
    this._follow = null;
    this._animateTo(this._fitView, 900);
  }

  _onWheel(e) {
    e.preventDefault();
    const [px, py] = this._stagePoint(e);
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
    this._animateTo(this._zoomTarget(f, px, py), 200, easeOutCubic);
  }

  _onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    this._moved = 0;
  }

  _onPointerMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    const dx = (e.clientX - p.x) / this._scale;
    const dy = (e.clientY - p.y) / this._scale;
    if (this._pointers.size === 2) {
      const pts = [...this._pointers.values()];
      const other = pts.find(q => q !== p);
      const prev = Math.hypot(p.x - other.x, p.y - other.y);
      const now = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (prev > 0) {
        this._cancelAnim();
        const [px, py] = this._stagePoint({clientX: (e.clientX + other.x) / 2, clientY: (e.clientY + other.y) / 2});
        this._applyView(this._zoomTarget(now / prev, px, py));
      }
      this._moved = 99;
    } else {
      this._moved += Math.abs(dx) + Math.abs(dy);
      if (this._moved > 4) {
        if (!this._dragging) {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          this._dragging = true;
        }
        this._cancelAnim();
        this._follow = null;
        const {k, tx, ty} = this._view;
        this._applyView({k, tx: tx + dx, ty: ty + dy});
      }
    }
    p.x = e.clientX;
    p.y = e.clientY;
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size === 0) this._dragging = false;
  }

  _onMapClick(e) {
    if (this._moved > 4) return;
    const el = e.target.closest?.('[data-fid]');
    this._select(el ? el.getAttribute('data-fid') : null);
  }

  _onKey(e) {
    const el = e.target.closest?.('[data-fid]');
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this._select(el.getAttribute('data-fid'));
      return;
    }
    const step = 70;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) this._follow = null;
    const {k, tx, ty} = this._target || this._view;
    const pan = (dx, dy) => this._animateTo({k, tx: tx + dx, ty: ty + dy}, 260, easeOutCubic);
    switch (e.key) {
      case 'ArrowLeft': pan(step, 0); break;
      case 'ArrowRight': pan(-step, 0); break;
      case 'ArrowUp': pan(0, step); break;
      case 'ArrowDown': pan(0, -step); break;
      case '+':
      case '=': this._zoomBtn(1.5); break;
      case '-':
      case '_': this._zoomBtn(1 / 1.5); break;
      case '0': this._fitAll(); break;
      default: return;
    }
    e.preventDefault();
  }

  /* ------------------------------------------------------- facilities */
  _all() {
    if (!this._allCache) {
      this._allCache = {...FACILITIES, ...this._assoc.dynamic, ...this._assoc.records};
      (this._sim?.vehicles || []).forEach(v => {
        this._allCache[`veh-${v.sys_id}`] = {id: `veh-${v.sys_id}`, vid: v.sys_id, kind: 'vehicle', name: v.driver_name, source: 'servicenow', geom: {type: 'point', pts: [[0, 0]]}, anchor: [0, 0]};
      });
      const scn = this._sim?.scenario || this._closedScn?.scn;
      if (scn) {
        const cp = crashPoint(scn.stop_distance_m, scn.lateral_offset_m, this._sim.session.lap_length_m || SIM_L);
        this._allCache.scenario = {id: 'scenario', kind: 'scenario', name: scn.corner_name, source: 'servicenow', geom: {type: 'point', pts: [[cp.x, cp.y]]}, anchor: [cp.x, cp.y]};
        (this._sim?.responses || []).forEach(r => {
          this._allCache[`resp-${r.sys_id}`] = {id: `resp-${r.sys_id}`, rid: r.sys_id, kind: 'response', name: r.label, source: 'servicenow', geom: {type: 'point', pts: [[cp.x, cp.y]]}, anchor: [cp.x, cp.y]};
        });
      }
      this._vehicles.forEach(v => {
        this._allCache[v.id] = {
          id: v.id,
          kind: 'vehicle',
          layer: 'vehicles',
          name: v.label || t('Vehicle'),
          source: 'servicenow',
          record: {table: v.table, sysId: v.sysId, name: v.label},
          geom: {type: 'point', pts: [[v.x, v.y]]},
          anchor: [v.x, v.y]
        };
      });
    }
    return this._allCache;
  }

  _invalidate() {
    this._allCache = null;
    this.requestUpdate();
  }

  _select(fid, focus = true) {
    if (fid === 'pitcluster') {
      this._timingOpen = true;
      this._feedOpen = false;
      this._timing = this._sim ? this._computeTiming(this._sessionMs()) : null;
      return;
    }
    const f = fid ? this._all()[fid] : null;
    const trackable = !!f && (!!f.vid || f.kind === 'response');
    this._follow = trackable ? f.id : null; // clicking any vehicle or response vehicle starts the follow camera
    if (f && f.id === 'scenario' && this._sel !== 'scenario') this._scnView = 'summary';
    this._sel = f ? f.id : null;
    if (f) {
      this._diagOpen = false;
      this._layersOpen = false;
      if (focus) this._focusOn(f);
    }
  }

  /** Smooth, bounded camera move to a facility. Same coordinate system as every layer, so nothing drifts. */
  _focusOn(f) {
    if (f.vid) {
      const p = this._poses.get(f.vid);
      if (p) f = {...f, anchor: [p.x, p.y], geom: {type: 'point', pts: [[p.x, p.y]]}};
    }
    if (f.kind === 'response') {
      const p = this._respPos.get(f.rid);
      if (p) f = {...f, anchor: [p.x, p.y], geom: {type: 'point', pts: [[p.x, p.y]]}};
    }
    const g = f.geom;
    let pts;
    if (g.type === 'poly') pts = g.top.concat(g.base);
    else if (g.type === 'line') pts = g.pts.map(p => project(p[0], p[1]));
    else pts = [project(f.anchor[0], f.anchor[1], f.z || 0)];
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const availW = Math.max(240, this._SW - SIDE_INSET - this._panelW() - 40);
    const availH = this._SH - TOP_INSET - BOTTOM_INSET;
    const fk = this._fitView.k;
    const raw = Math.min((availW * 0.6) / Math.max(bw, 1), (availH * 0.6) / Math.max(bh, 1));
    const k = Math.min(Math.max(raw, fk * 1.15), fk * (g.type === 'point' ? (f.kind === 'scenario' ? 3.6 : f.vid || f.kind === 'response' ? 3.0 : 6) : 8));
    const targetX = SIDE_INSET + availW / 2;
    const targetY = TOP_INSET + availH / 2;
    const cur = this._view;
    const ms = Math.min(1300, 760 + Math.abs(Math.log(k / cur.k)) * 260);
    this._animateTo({k, tx: targetX - cx * k, ty: targetY - cy * k}, ms, easeInOutCubic);
  }

  _backToOverview() {
    this._follow = null;
    this._sel = null;
    this._animateTo(this._fitView, 900);
  }

  _toggleLayer(id, on) {
    this._layers = {...this._layers, [id]: on};
    try {
      localStorage.setItem(LAYER_KEY, JSON.stringify(this._layers));
    } catch {
      /* preference only; ignore */
    }
  }

  /* ------------------------------------------------------- ServiceNow data */
  async _fetchJson(url) {
    try {
      const r = await aiuxFetch(url, {headers: {Accept: 'application/json'}});
      if (!r.ok) return {ok: false, status: r.status, rows: [], total: null};
      const j = await r.json();
      return {ok: true, status: r.status, rows: j?.result ?? [], total: r.headers?.get?.('X-Total-Count') ?? null};
    } catch {
      return {ok: false, status: 0, rows: [], total: null};
    }
  }

  /** Full read of the venue from ServiceNow, then association, change detection and activity. */
  async _loadSn() {
    if (this._loading) return;
    this._loading = true;
    try {
      const fj = u => this._fetchJson(u);
      this._hbSig = await heartbeat(fj);
      const data = await loadOperationalData(fj);
      const assoc = data.state === 'ready' ? associate(data) : EMPTY_ASSOC;

      // real change detection against the previous read (drives the highlight, never invents state)
      const sig = new Map();
      data.incidents.forEach(i => sig.set(i.sysId, `${i.priority}|${i.stateValue}|${i.groupId}|${i.assignedTo}`));
      data.cis.forEach(c => sig.set(c.sysId, c.opValue));
      if (this._prevSig) {
        const changed = [];
        sig.forEach((v, k) => {
          if (this._prevSig.get(k) !== v) changed.push(k);
        });
        if (changed.length) {
          this._flash = new Set(changed);
          clearTimeout(this._flashTimer);
          this._flashTimer = setTimeout(() => {
            this._flash = new Set();
            this.requestUpdate();
          }, 4200);
        }
      }
      this._prevSig = sig;

      this._sn = data;
      this._assoc = assoc;
      this._syncedAt = new Date();
      this._lastFull = Date.now();
      if (SN_CONFIG.vehicles) this._vehicles = await loadVehicles(fj);

      if (data.state === 'ready') {
        const groupNames = Object.fromEntries(data.teams.map(t2 => [t2.sysId, t2.name]));
        const act = await loadActivity(fj, data, groupNames);
        this._auditState = act.audit;
        const fresh = act.events.filter(e => !this._seenFeed.has(e.id));
        if (this._seenFeed.size && fresh.length) this._announce(fresh[0], fresh.length);
        act.events.forEach(e => this._seenFeed.add(e.id));
        this._feed = act.events;
      }
    } catch {
      this._sn = {state: 'error', http: 0, locations: [], cis: [], incidents: [], alerts: [], tasks: [], teams: [], notes: []};
      this._assoc = EMPTY_ASSOC;
    } finally {
      this._loading = false;
    }
    this._invalidate();
  }

  /** Lightweight poll: four tiny requests every SN_CONFIG.pollMs; a full reload only if the venue data changed. */
  async _poll() {
    if (document.hidden) return;
    const simP = this._loadSim();
    if (this._loading) {
      await simP;
      return;
    }
    const sig = await heartbeat(u => this._fetchJson(u));
    this._linkOk = sig !== null;
    if (sig === null) {
      this.requestUpdate();
      return;
    }
    if (sig !== this._hbSig || Date.now() - this._lastFull > SN_CONFIG.refreshMs) await this._loadSn();
    else this.requestUpdate();
    await simP;
    this._pushAiContext();
  }

  _announce(ev, more) {
    this._toast = {ref: ev.ref, text: more > 1 ? fill(t('{0} (+{1} more changes)'), ev.text, more - 1) : ev.text, kind: ev.kind, key: ev.id};
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (this._toast = null), 6500);
  }

  _layerStatus(id) {
    const sn = this._sn;
    if (sn.state === 'loading') return t('Loading from ServiceNow…');
    if (sn.state === 'error') return t('ServiceNow unavailable');
    const s = this._assoc.stats;
    const none = t('No Paul Ricard records');
    switch (id) {
      case 'incidents':
        return s.incidents + s.alerts || s.resolved
          ? fill(t('{0} open · {1} resolved'), s.incidents + s.alerts, s.resolved)
          : none;
      case 'facilities':
        return s.placed ? fill(t('{0} venue locations linked'), s.placed) : t('Mapped geometry only, none linked');
      case 'it':
        return s.cis ? fill(t('{0} CIs located'), s.cis) : t('No CIs at Paul Ricard locations');
      case 'emergency':
        return fill(t('{0} gates mapped · {1} response groups'), OSM_GATES, s.teams);
      case 'vehicles': {
        if (this._sim) {
          const c = this._simCounts();
          return fill(t('{0} vehicles · {1} on track · {2} in pits'), c.total, c.on, c.pits);
        }
        return SN_CONFIG.vehicles ? fill(t('{0} reporting'), this._vehicles.length) : t('No session record');
      }
      case 'restrictions':
        return this._sim ? fill(t('Track status: {0} (session record)'), this._sim.session.track_status) : t('Source not configured');
      default:
        return t('Source not configured');
    }
  }

  /* ------------------------------------------------------- public API for future overlays */
  /** World metres (+ optional height) -> view-space coordinates used by every layer. */
  project(x, y, z = 0) {
    return project(x, y, z);
  }

  /* ------------------------------------------------------- render */
  _scene() {
    if (!this._sceneHtml) {
      this._sceneHtml = {ground: groundMarkup(), elevated: elevatedMarkup()};
    }
    return this._sceneHtml;
  }

  _hitLayer(f) {
    if (f.kind === 'pit-lane' || f.kind === 'pit-service') return 'pit';
    if (f.kind === 'emergency-access') return 'emergency';
    return undefined;
  }

  _renderLines() {
    return Object.values(FACILITIES)
      .filter(f => f.geom.type === 'line')
      .map(f => {
        const d = `M${f.geom.pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`;
        const w = f.kind === 'emergency-access' || f.kind === 'pit-service' ? 12 : f.kind === 'pit-lane' ? 16 : TRACK_W + 4;
        const aria = `${kindLabel(f.kind)}: ${f.name}`;
        return svg`<path class="hit line" data-fid=${f.id} data-layer=${ifDefined(this._hitLayer(f))} d=${d} stroke-width=${w} tabindex="0" role="button" aria-label=${aria}></path>`;
      });
  }

  _renderBuildingHits() {
    return Object.values(FACILITIES)
      .filter(f => f.geom.type === 'poly')
      .map(f => {
        const d = `M${f.geom.top.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
        const aria = `${kindLabel(f.kind)}: ${f.name}`;
        return svg`<path class="hit poly" data-fid=${f.id} data-layer="buildings" d=${d} tabindex="0" role="button" aria-label=${aria}></path>`;
      });
  }

  /** Static furniture: helipads, gates (medium zoom and closer), pit entry / exit text. */
  _renderMarkers() {
    const items = [];
    const sty = (x, y) => `transform: translate(${x}px, ${y}px) scale(var(--inv))`;
    Object.values(FACILITIES).forEach(f => {
      const sel = this._sel === f.id;
      if (f.kind === 'helipad' && this._layers.emergency) {
        const [x, y] = project(f.anchor[0], f.anchor[1]);
        items.push(svg`<g class="marker lbl t1" data-fid=${f.id} tabindex="0" role="button" aria-label=${t('Helipad')} style=${sty(x, y)}>
          <circle class="mk-shadow" r="9" cx="1" cy="2"></circle>
          <circle class="mk-ring" r="9" style=${sel ? 'stroke:#2d6fd1;stroke-width:2.4' : ''}></circle>
          <text y="4.2" text-anchor="middle" font-size="12">H</text></g>`);
      }
      if (f.kind === 'gate' && this._layers.emergency) {
        const [x, y] = project(f.anchor[0], f.anchor[1]);
        items.push(svg`<g class="marker lbl t1" data-fid=${f.id} tabindex="0" role="button" aria-label=${t('Gate')} style=${sty(x, y)}>
          <rect class="mk-shadow" x="-4" y="-3" width="10" height="10" rx="2"></rect>
          <rect class="mk-ring" x="-5" y="-5" width="10" height="10" rx="2" style=${sel ? 'stroke:#2d6fd1;stroke-width:2.4' : ''}></rect>
          <path d="M-2.2 0h4.4" stroke="#d0701d" stroke-width="1.8" stroke-linecap="round" pointer-events="none"></path></g>`);
      }
      if ((f.kind === 'pit-entry' || f.kind === 'pit-exit') && this._layers.facilities) {
        const [x, y] = project(f.anchor[0], f.anchor[1]);
        const label = f.kind === 'pit-entry' ? t('Pit entry') : t('Pit exit');
        const dy = f.kind === 'pit-entry' ? 22 : -22;
        items.push(svg`<g style=${sty(x, y)} data-layer="names">
          <path class="leader" d=${`M0 0L0 ${dy * 0.6}`}></path>
          <circle class="dot" r="3"></circle>
          <g class=${classMap({lbl: true, sm: true, sel})} data-fid=${f.id} tabindex="0" role="button" aria-label=${label} transform=${`translate(0 ${dy})`}>
            <rect class="pill" x="-34" y="-11" width="68" height="22" rx="11"></rect>
            <text y="4" text-anchor="middle">${label}</text></g></g>`);
      }
    });
    return items;
  }

  /** Screen anchor for ServiceNow-backed markers (top of the footprint for buildings). */
  _anchorOf(f) {
    if (f.geom.type === 'poly') {
      const tp = f.geom.top;
      return [tp.reduce((a, p) => a + p[0], 0) / tp.length, tp.reduce((a, p) => a + p[1], 0) / tp.length];
    }
    return project(f.anchor[0], f.anchor[1], f.z || 0);
  }

  /** ServiceNow-backed markers. Each one is a real record: incident, CI or venue location. */
  _renderOps() {
    const all = this._all();
    const items = [];
    const sty = (x, y) => `transform: translate(${x}px, ${y}px) scale(var(--inv))`;

    // venue locations that carry their own position (garages, race control, medical, marshal posts, sectors, paddock)
    Object.values(this._assoc.dynamic).forEach(f => {
      const layerOn = f.layer === 'emergency' ? this._layers.emergency : this._layers.facilities;
      if (!layerOn) return;
      const [x, y] = project(f.anchor[0], f.anchor[1], f.z || 0);
      const sel = this._sel === f.id;
      const digit = /(\d+)\s*$/.exec(f.name)?.[1];
      const glyph = f.kind === 'sector' ? `S${digit || ''}` : GLYPH[f.kind] || '•';
      const rep = f.provenance === 'representative';
      items.push(svg`<g class="marker sn hide0" data-fid=${f.id} tabindex="0" role="button" aria-label=${`${kindLabel(f.kind)}: ${f.name}`} style=${sty(x, y)}>
        <circle class="mk-shadow" r="11" cx="1" cy="2"></circle>
        <circle class="mk-ring" r="11" style=${`stroke:${sel ? '#2d6fd1' : SEV.info};stroke-width:${sel ? 2.8 : 2};${rep ? 'stroke-dasharray:3 2.4' : ''}`}></circle>
        <text y="4.4" text-anchor="middle" font-size=${glyph.length > 1 ? 9.5 : 13}>${glyph}</text></g>`);
    });

    Object.entries(this._assoc.bundles).forEach(([fid, b]) => {
      const f = all[fid];
      if (!f) return;
      const [x, y] = this._anchorOf(f);
      const hasGlyph = !!this._assoc.dynamic[fid];
      const row = [];
      if (this._layers.incidents) {
        const incs = b.incidents.slice().sort((p, q) => Number(p.resolved) - Number(q.resolved) || (p.priority || 9) - (q.priority || 9));
        incs.forEach(i => {
          if (this._sim?.scenario && i.sysId === this._sim.scenario.incident) return;
          if (i.resolved) return; // resolved / closed incidents are history: never drawn on the live map (the records stay in ServiceNow)
          const sev = i.resolved ? 'neutral' : i.priority === 1 ? 'critical' : i.priority === 2 ? 'warning' : i.priority === 3 ? 'info' : 'neutral';
          const rec = this._assoc.records[`inc-${i.sysId}`];
          row.push({key: i.sysId, fid: `inc-${i.sysId}`, kind: incidentKind(i, rec?.ciClass), sev, chip: i.resolved ? '' : String(i.priority || ''), resolved: i.resolved, pulse: sev === 'critical', label: `${i.number}: ${i.desc} (${i.priorityLabel}, ${i.state})`});
        });
        b.alerts.forEach(a =>
          row.push({key: a.sysId, fid, kind: 'it', sev: a.severity === 1 ? 'critical' : a.severity <= 3 ? 'warning' : 'info', chip: '', pulse: a.severity === 1, label: `${a.number}: ${a.desc}`})
        );
      }
      if (this._layers.it && b.cis.length) {
        const sevOf = c => (c.opValue === '1' ? 'normal' : c.opValue === '2' ? 'critical' : c.opValue ? 'warning' : 'neutral');
        if (this._tier >= 2) {
          b.cis.slice(0, 8).forEach(c => row.push({key: c.sysId, fid: `ci-${c.sysId}`, kind: 'asset', sev: sevOf(c), chip: '', label: `${c.name}: ${c.opStatus}`}));
        } else {
          const bad = b.cis.some(c => c.opValue === '2');
          const warn = b.cis.some(c => c.opValue && c.opValue !== '1' && c.opValue !== '2');
          const ok = b.cis.every(c => c.opValue === '1');
          row.push({key: `ci:${fid}`, fid, kind: 'asset', sev: bad ? 'critical' : warn ? 'warning' : ok ? 'normal' : 'neutral', hide0: !bad && !warn, count: b.cis.length, chip: '', label: fill(t('{0} configuration items at {1}'), b.cis.length, f.name)});
        }
      }
      const shown = row.slice(0, 7);
      if (row.length > 7) shown.push({key: `more:${fid}`, fid, kind: 'asset', sev: 'neutral', hide0: true, count: row.length - 6, label: fill(t('{0} more records at {1}'), row.length - 6, f.name)});
      const gap = 23;
      const x0 = x - ((shown.length - 1) * gap) / 2;
      const dy = hasGlyph ? -24 : -17;
      shown.forEach((m, idx) => items.push(this._badge(m, x0 + idx * gap, y + dy)));
    });
    return items;
  }

  /** One badge: shape says what it is, colour says how serious. */
  _badge(m, x, y) {
    const col = SEV[m.sev] || SEV.neutral;
    const solid = m.kind === 'emergency' || m.kind === 'team' || m.kind === 'asset';
    const sel = this._sel === m.fid;
    const flash = this._flash.has(m.key);
    return svg`<g class=${classMap({marker: true, sn: true, flash, resolved: !!m.resolved, hide0: !!m.hide0})} data-fid=${m.fid} tabindex="0" role="button" aria-label=${m.label} style=${`transform: translate(${x}px, ${y}px) scale(var(--inv))`}>
      ${m.pulse ? svg`<circle class="pulse" r="10"></circle>` : nothing}
      ${flash ? svg`<circle class="changed" r="10"></circle>` : nothing}
      <circle class="mk-shadow" r="10" cx="1" cy="2"></circle>
      <circle class="mk-ring" r="10" style=${`stroke:${col};stroke-width:${sel ? 3.2 : 2.2}`}></circle>
      <path class=${classMap({'mk-glyph': true, solid})} d=${MARKER_GLYPH[m.kind]} style=${solid ? `fill:${col}` : ''}></path>
      ${m.resolved ? svg`<path class="mk-check" d="M-3.6 .4l2.6 2.8 4.6-5.6"></path>` : nothing}
      ${m.chip ? svg`<circle cx="8.5" cy="-8.5" r="6" style=${`fill:${col}`}></circle><text class="mk-counttxt" x="8.5" y="-5.3" text-anchor="middle">${m.chip}</text>` : nothing}
      ${m.count > 1 ? svg`<circle cx="8.5" cy="-8.5" r="6" style=${`fill:${col}`}></circle><text class="mk-counttxt" x="8.5" y="-5.3" text-anchor="middle">${m.count}</text>` : nothing}
    </g>`;
  }

  /* ------------------------------------------------------- simulation (ServiceNow-backed) */
  /** Authenticated request to the governed Scripted REST API. Never touches state locally. */
  async _simRequest(method, path, body) {
    const t0 = Date.now();
    /* Bounded: a crash simulation takes ~12-16 s on the server, so writes get 45 s, reads 20 s. Never wait forever. */
    const limit = method === 'GET' ? 20000 : 45000;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        ac?.abort();
        resolve({ok: false, status: 0, result: null, timedOut: true, t0, t1: Date.now()});
      }, limit);
    });
    const call = (async () => {
      try {
        const r = await aiuxFetch(`${SIM_BASE}${path}`, {
          method,
          headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
          body: body ? JSON.stringify(body) : undefined,
          signal: ac?.signal
        });
        let j = null;
        try {
          j = await r.json();
        } catch {
          j = null;
        }
        return {ok: r.ok, status: r.status, result: j?.result ?? null, t0, t1: Date.now()};
      } catch {
        return {ok: false, status: 0, result: null, t0, t1: Date.now()};
      }
    })();
    try {
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------- V6: weather overlay */
  _wxFlash() {
    this._wxEnter = Date.now();
    clearTimeout(this._wxEnterT);
    this._wxEnterT = setTimeout(() => (this._wxEnter = 0), 1100);
  }

  _wxToggle() {
    this._wxOpen = !this._wxOpen;
    if (this._wxOpen) {
      this._diagOpen = false;
      this._layersOpen = false;
      this._menuOpen = false;
      this._evOpen = false;
      this._wxTab = 'forecast';
    } else this._wxStop();
  }

  _wxClose() {
    this._wxOpen = false;
    this._wxStop();
  }

  _wxStop() {
    this._wxPlay = false;
    clearInterval(this._wxTimer);
  }

  _wxSeek(m) {
    this._wxStop();
    this._wxMinute = Math.max(0, Math.min(60, m));
  }

  _wxTogglePlay() {
    if (this._wxPlay) return this._wxStop();
    if (this._wxMinute >= 59.5) this._wxMinute = 0;
    this._wxPlay = true;
    clearInterval(this._wxTimer);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._wxTimer = setInterval(() => {
      const nxt = this._wxMinute + (reduce ? 5 : 0.35);
      if (nxt >= 60) {
        this._wxMinute = 60;
        this._wxStop();
      } else this._wxMinute = nxt;
    }, reduce ? 700 : 60);
  }

  async _wxSimulate() {
    const r = await this._runAction('wx-sim', () => this._simRequest('POST', '/weather/simulate', {}), t('Simulated weather warning confirmed by ServiceNow'));
    if (r?.ok && r.result?.ok) {
      this._wxMinute = 0;
      this._wxOpen = true;
      this._wxTab = 'forecast';
    }
  }

  _wxCreateTasks() {
    return this._runAction('wx-tasks', () => this._simRequest('POST', '/weather/tasks', {team: 'all'}), t('Preparation tasks recorded in ServiceNow'));
  }

  _wxAnnouncement() {
    return this._runAction('wx-ann', () => this._simRequest('POST', '/weather/announcement', {}), t('Announcement submitted for approval. Nothing is delivered until it is approved'));
  }

  _wxViewApproval() {
    this._apprOpen = true;
    this._evOpen = false;
  }

  _simSignature(d) {
    return JSON.stringify({...d, serverNowMs: 0, session: {...d.session, session_ms: 0}});
  }

  /** Adopt a state returned by ServiceNow (read or action response) and re-sync the clock to the server. */
  _applySim(res, t0, t1) {
    if (!res?.ok || !res.session) return false;
    const mid = (t0 + t1) / 2;
    const off = res.serverNowMs - mid;
    this._clockOffset = this._clockSynced ? this._clockOffset * 0.6 + off * 0.4 : off;
    this._clockSynced = true;
    const sig = this._simSignature(res);
    const changed = sig !== this._simSig;
    if (changed) {
      const first = !this._simSig;
      this._simSig = sig;
      const prev = this._sim;
      if (prev?.scenario && !res.scenario && prev.tasks.length && prev.tasks.every(x => x.closed)) this._closedScn = {scn: prev.scenario, tasks: prev.tasks, vehicle: prev.vehicles.find(x => x.sys_id === prev.scenario.vehicle) || null};
      else if (res.scenario || first) this._closedScn = null;
      // three red border pulses, once per NEW confirmed scenario (never on first load, polls or re-opening)
      if (res.scenario && res.scenario.state === 'active' && !this._seenScn.has(res.scenario.sys_id) && !first) this._flashCrash();
      if (res.scenario) this._seenScn.add(res.scenario.sys_id);
      this._sim = {
        session: res.session,
        vehicles: res.vehicles,
        canOperate: res.canOperate,
        scenario: res.scenario || null,
        tasks: res.tasks || [],
        responses: res.responses || [],
        decisions: res.decisions || [],
        checklist: res.checklist || [],
        blockers: res.blockers || [],
        events: res.events || [],
        corners: res.corners || [],
        restriction: res.restriction || null,
        pending: res.pendingApprovals || [],
        weather: res.weather || null
      };
      // V6: one subtle entrance animation per NEW confirmed weather warning (never on first load, never red, never changes the track)
      const wxw = res.weather?.warning;
      if (wxw && !this._seenWx.has(wxw.sys_id)) {
        this._seenWx.add(wxw.sys_id);
        if (!first) this._wxFlash();
      }
      this._spots = new Map();
      this._routes = new Map();
      this._buildRestrictions();
      // one lightweight notification per genuinely new operational event (never on first load)
      const fresh = (res.events || []).filter(e => !this._seenRc.has(e.sys_id));
      (res.events || []).forEach(e => this._seenRc.add(e.sys_id));
      const notable = fresh.filter(e => ['crash', 'amber', 'redflag', 'restart', 'dispatch', 'decision', 'recovery'].includes(e.kind));
      if (!first && notable.length) {
        const e = notable[0];
        this._announce({ref: e.ref_label || t('Race Control'), text: e.text, kind: e.kind === 'dispatch' ? 'created' : 'crit', id: `rc-${e.sys_id}`}, 1);
      }
      this._pushAiContext();
      this._invalidate();
    }
    return changed;
  }

  async _loadSim() {
    const r = await this._simRequest('GET', '/state');
    if (r.ok) this._applySim(r.result, r.t0, r.t1);
    else if (r.status === 404) this._sim = null;
    this._simOk = r.ok || r.status === 404;
  }

  /** Server-synchronised session clock in session milliseconds. */
  _sessionMs() {
    const s = this._sim?.session;
    if (!s) return 0;
    // the session clock keeps running while suspended (red flag), exactly like the server
    if (!['running', 'suspended'].includes(s.state) || !s.running_since_ms) return s.elapsed_ms;
    return s.elapsed_ms + (Date.now() + this._clockOffset - s.running_since_ms) * s.time_scale;
  }

  _garageXY(v) {
    const g = this._sn.locations.find(l => l.sysId === v.garage);
    if (!g || !Number.isFinite(g.lat)) return null;
    return toWorld(g.lat, g.lon);
  }

  _spotOf(v) {
    let s = this._spots.get(v.sys_id);
    if (!s) {
      const xy = this._garageXY(v);
      if (!xy) return null;
      s = parkingSpot(xy, v.pit_slot);
      this._spots.set(v.sys_id, s);
    }
    return s;
  }

  /** One animation loop: poses are computed from the persisted anchors and the synced clock. No network, no writes. */
  _tick = now => {
    this._raf2 = requestAnimationFrame(this._tick);
    const sd = this._sim;
    if (!sd || !sd.vehicles.length) return;
    const ms = this._sessionMs();
    const L = sd.session.lap_length_m || SIM_L;
    const k = this._view.k;
    const inv = 1 / k;
    let parked = 0;
    let cx = 0;
    let cy = 0;
    sd.vehicles.forEach(v => {
      const el = this._carEls.get(v.sys_id);
      const spot = this._spotOf(v);
      if (!el || !spot) return;
      const pose = carPose(v, ms, spot, L);
      this._poses.set(v.sys_id, pose);
      const pk = pose.phase;
      const isParked = pk === 'parked' || pk === 'retired';
      const [px, py] = project(pose.x, pose.y);
      el.root.setAttribute('transform', `translate(${px.toFixed(2)} ${py.toFixed(2)}) scale(${((isParked ? 0.8 : 1) * VS * (this._mk || 1) * inv).toFixed(5)})`);
      if (!el.ready) {
        el.root.style.opacity = '1';
        el.ready = true;
      }
      const cl = el.root.classList;
      cl.toggle('parked', isParked);
      cl.toggle('stopped', pk === 'stopped' || pk === 'crashing');
      cl.toggle('retired', pk === 'retired');
      if (pk === 'parked') {
        parked++;
        cx += px;
        cy += py;
      }
    });
    // single "in pits" chip for the overview, so five parked cars never stack as five markers
    if (this._pcEl && this._pcEl.isConnected) {
      this._pcEl.classList.toggle('empty', parked === 0);
      if (parked) {
        const txt = `${parked} ${t('IN PITS')}`;
        if (this._pcText !== txt) {
          this._pcEl.querySelector('text').textContent = txt;
          this._pcText = txt;
        }
        this._pcEl.style.transform = `translate(${(cx / parked).toFixed(1)}px, ${(cy / parked).toFixed(1)}px) scale(var(--inv)) translate(-66px, -30px)`;
      }
    }
    // incident marker appears when the car actually leaves the line
    const scn = sd.scenario;
    if (this._crashEl && this._crashEl.isConnected && scn) this._crashEl.classList.toggle('hidden', ms < scn.crash_start_ms);
    // response vehicles: position derived from the persisted dispatch time, the mapped route and the synced clock
    this._respEls.forEach((el, rid) => {
      const r = sd.responses.find(x => x.sys_id === rid);
      if (!r) return;
      const route = this._routeOf(r);
      let pos;
      let onScene = false;
      if (route) {
        const s = Math.max(0, ((ms - r.dispatched_session_ms) / 1000) * r.speed_mps);
        onScene = s >= route.length;
        pos = pointOnRoute(route, s);
      } else {
        const d = crashPoint(r.dest_distance_m, r.dest_lateral_m, L);
        pos = {x: d.x, y: d.y};
        onScene = true;
      }
      this._respPos.set(rid, pos);
      const [px, py] = project(pos.x, pos.y);
      el.setAttribute('transform', `translate(${px.toFixed(2)} ${py.toFixed(2)}) scale(${(VS * (this._mk || 1) * inv).toFixed(5)})`);
      el.classList.toggle('onscene', onScene);
    });
    // camera follow: rides the same loop (no extra timer). It yields to any running camera animation or drag.
    const fp = this._follow ? (this._follow.startsWith('veh-') ? this._poses.get(this._follow.slice(4)) : this._respPos.get(this._follow.slice(5))) : null;
    if (fp && !this._target && !this._dragging) {
      const p = fp;
      const [fx, fy] = project(p.x, p.y);
      const dt = Math.min(64, now - (this._lastFollowT || now));
      this._lastFollowT = now;
      const a = 1 - Math.exp(-dt / 150);
      const availW = Math.max(240, this._SW - SIDE_INSET - this._panelW() - 40);
      const availH = this._SH - TOP_INSET - BOTTOM_INSET;
      const {k: vk, tx: vx, ty: vy} = this._view;
      const ex = SIDE_INSET + availW / 2 - fx * vk - vx;
      const ey = TOP_INSET + availH / 2 - fy * vk - vy;
      if (Math.abs(ex) + Math.abs(ey) > 0.2) this._applyView({k: vk, tx: vx + ex * a, ty: vy + ey * a});
    } else this._lastFollowT = 0;
    const sel = this._sel && this._sel.startsWith('veh-') ? this._sel.slice(4) : null;
    if (this._lblEl && this._lblEl.isConnected && sel && this._poses.has(sel)) {
      const p = this._poses.get(sel);
      const [px, py] = project(p.x, p.y);
      this._lblEl.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(var(--inv))`;
    }
    if (now - (this._lastCounts || 0) > 400) {
      this._lastCounts = now;
      const c = this._simCounts();
      const sig = `${c.on}/${c.pits}/${c.stopped}/${c.retired}`;
      if (sig !== this._countSig) {
        this._countSig = sig;
        this.requestUpdate();
      }
    }
    if (this._timingOpen && now - this._lastTiming > 250) {
      this._lastTiming = now;
      this._timing = this._computeTiming(ms);
      this.requestUpdate();
    }
  };

  _routeOf(r) {
    if (this._routes.has(r.sys_id)) return this._routes.get(r.sys_id);
    const o = this._sn.locations.find(l => l.sysId === r.origin);
    let route = null;
    if (o && Number.isFinite(o.lat)) {
      const d = crashPoint(r.dest_distance_m, r.dest_lateral_m, this._sim.session.lap_length_m || SIM_L);
      route = routeBetween(toWorld(o.lat, o.lon), [d.x, d.y]);
    }
    this._routes.set(r.sys_id, route);
    return route;
  }

  /** Order and gaps derive from the persisted anchors and lap-time parameters: no stored order. */
  _computeTiming(ms) {
    const sd = this._sim;
    const L = sd.session.lap_length_m || SIM_L;
    const rows = sd.vehicles.map(v => ({v, phase: phaseOf(v, ms), prog: trackProgress(v, ms, L)}));
    const on = rows.filter(r => r.prog !== null).sort((a, b) => b.prog - a.prog);
    on.forEach((r, i) => {
      r.pos = i + 1;
      r.lap = Math.max(1, Math.floor(r.prog / L) + 1);
      const ahead = on[i - 1];
      if (ahead) {
        const behind = ahead.prog - r.prog;
        r.gap = behind >= L ? `+${Math.floor(behind / L)} ${t('LAP')}` : `+${(behind / (L / r.v.lap_time_s)).toFixed(1)}`;
      }
    });
    const off = rows.filter(r => r.prog === null).sort((a, b) => a.v.racing_number - b.v.racing_number);
    return {ms, rows: [...on, ...off]};
  }

  _stateLabel(r) {
    const m = {parked: 'IN PITS', leaving: 'LEAVING PITS', entering: 'ENTERING PITS', approaching: 'RETURNING', track: 'ON TRACK', crashing: 'STOPPING', stopped: 'STOPPED', retired: 'RETIRED'};
    return t(m[r.phase] || String(r.v.state || '').replace('_', ' ').toUpperCase());
  }

  _fmtClock(ms) {
    const s = Math.floor(ms / 1000);
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  async _sessionAction(action) {
    if (this._simBusy) return;
    this._simBusy = action;
    this._simMsg = null;
    this._confirmReset = false;
    try {
      const r = await this._simRequest('POST', '/session/action', {action, expectedVersion: this._sim?.session.version});
      if (r.ok && r.result?.ok) {
        this._applySim(r.result, r.t0, r.t1);
        this._simMsg = {ok: true, text: fill(t('{0} confirmed by ServiceNow'), SESSION_ACTIONS[action])};
      } else {
        this._simMsg = {ok: false, text: r.result?.error || fill(t('Request failed (HTTP {0})'), r.status)};
        await this._loadSim();
      }
    } catch {
      this._simMsg = {ok: false, text: t('The action could not be completed. Check ServiceNow and try again.')};
    } finally {
      this._simBusy = null;
      this._invalidate();
    }
  }

  async _vehicleAction(vehicleId, action) {
    if (this._simBusy) return;
    const v = this._sim?.vehicles.find(x => x.sys_id === vehicleId);
    this._simBusy = `${action}:${vehicleId}`;
    this._simMsg = null;
    try {
      const r = await this._simRequest('POST', `/vehicle/${vehicleId}/action`, {action, expectedState: v?.state});
      if (r.ok && r.result?.ok) {
        this._applySim(r.result, r.t0, r.t1);
        this._simMsg = {ok: true, text: action === 'pit_out' ? t('Pit exit confirmed by ServiceNow') : t('Return to pits confirmed by ServiceNow')};
      } else {
        this._simMsg = {ok: false, text: r.result?.error || fill(t('Request failed (HTTP {0})'), r.status)};
        await this._loadSim();
      }
    } catch {
      this._simMsg = {ok: false, text: t('The action could not be completed. Check ServiceNow and try again.')};
    } finally {
      this._simBusy = null;
      this._invalidate();
    }
  }

  _simCounts() {
    // derived from the persisted state AND timings, so a car that ServiceNow has sent to the pits still counts as on track until it reaches the pit lane
    const vs = this._sim?.vehicles || [];
    const ms = this._sessionMs();
    const c = {on: 0, pits: 0, stopped: 0, retired: 0, total: vs.length};
    vs.forEach(v => {
      const ph = phaseOf(v, ms);
      if (ph === 'retired') c.retired++;
      else if (ph === 'stopped' || ph === 'crashing') c.stopped++;
      else if (ph === 'parked' || ph === 'entering') c.pits++;
      else c.on++;
    });
    return c;
  }

  /** Broadcast-style driver markers: team colour from the vehicle record, abbreviation, constant on-screen size. */
  _renderCars(top = false) {
    if (!this._layers.vehicles || !this._sim) return nothing;
    const sel = this._sel;
    return this._sim.vehicles
      .filter(v => (sel === `veh-${v.sys_id}`) === top)
      .map(v => {
        const fid = `veh-${v.sys_id}`;
        const fg = contrastText(v.team_color);
        const outline = fg === '#ffffff' ? 'rgba(255,255,255,0.96)' : 'rgba(20,26,33,0.92)';
        return svg`<g class=${classMap({car: true, sel: sel === fid})} data-fid=${fid} data-vid=${v.sys_id} tabindex="0" role="button" aria-label=${`${t('Vehicle')}: ${v.driver_name} #${v.racing_number}, ${v.team}`} style="opacity:0">
          <circle class="sh" cx="1.5" cy="2.6" r="17"></circle>
          <circle class="selring" r="22"></circle>
          <circle class="stopring" r="22"></circle>
          <circle class="body" r="17" style=${`fill:${v.team_color};stroke:${outline}`}></circle>
          <text y="4.6" text-anchor="middle" style=${`fill:${fg}`}>${v.abbreviation}</text>
        </g>`;
      });
  }

  _renderCarLabel() {
    const v = this._sel && this._sel.startsWith('veh-') ? this._sim?.vehicles.find(x => `veh-${x.sys_id}` === this._sel) : null;
    if (!v || !this._layers.vehicles) return nothing;
    return svg`<g id="rc-carlabel" class="carlabel"><rect x="-27" y="-62" width="54" height="18" rx="9"></rect><text y="-49.5" text-anchor="middle">${v.abbreviation} · ${v.racing_number}</text></g>`;
  }

  _renderPitCluster() {
    if (!this._layers.vehicles || !this._sim) return nothing;
    return svg`<g id="rc-pitcluster" class="pitcluster empty" data-fid="pitcluster" tabindex="0" role="button" aria-label=${t('Cars in the pits. Open Live Timing')}>
      <rect x="-36" y="-11" width="72" height="22" rx="11"></rect><text y="4.4" text-anchor="middle">${t('IN PITS')}</text></g>`;
  }

  /** Vehicle card: persisted fields plus authorised pit transitions. */
  _renderVehicleCard(f) {
    const v = this._sim?.vehicles.find(x => x.sys_id === f.vid);
    if (!v) return nothing;
    const ms = this._sessionMs();
    const phase = phaseOf(v, ms);
    const L = this._sim.session.lap_length_m || SIM_L;
    const prog = trackProgress(v, ms, L);
    const can = this._sim.canOperate && this._sim.session.state === 'running';
    const row = (k, val2) => html`<dt>${k}</dt><dd>${val2 || '—'}</dd>`;
    const busy = String(this._simBusy || '').endsWith(v.sys_id);
    const garage = this._sn.locations.find(l => l.sysId === v.garage);
    return html`<aside class="card" aria-label=${t('Vehicle detail')}>
      <button class="x" @click=${() => this._backToOverview()} aria-label=${t('Close and return to overview')}>${icon('close', 18)}</button>
      <h2 class="title">${v.driver_name}</h2>
      <p class="kind"><span class="tdot" style=${`background:${v.team_color}`}></span>#${v.racing_number} · ${v.abbreviation} · ${v.team}</p>
      <dl>
        ${row(t('State'), html`<span class=${`st ${v.state === 'on_track' ? 'ok' : ''}`}>${this._stateLabel({v, phase})}</span>`)}
        ${row(t('Persisted state'), v.state)}
        ${row(t('Simulated lap'), prog === null ? '—' : String(Math.max(1, Math.floor(prog / L) + 1)))}
        ${row(t('Simulated lap time'), `${v.lap_time_s.toFixed(1)} s`)}
        ${row(t('Garage'), garage ? this._link('cmn_location', garage.sysId, garage.name) : v.garage_name)}
        ${row(t('Hold'), v.hold_reason || (v.incident ? t('Incident linked') : ''))}
      </dl>
      <div class="rule"></div>
      <p class="note">${t('Fictional practice simulation. Positions are derived from ServiceNow-stored anchors; this is not Formula 1 telemetry.')}</p>
      ${this._simMsg ? html`<p class=${classMap({simmsg: true, bad: !this._simMsg.ok})} role="status">${this._simMsg.text}</p>` : nothing}
      <div class="actions">
        <a class="act primary" href=${this._recordLink('x_snc_lux1_rc_vehicle', v.sys_id)} target="_blank" rel="noopener noreferrer">${t('Open record')} ↗</a>
        ${v.state === 'in_pits'
          ? html`<button class="act" type="button" ?disabled=${!can || !!this._simBusy} @click=${() => this._vehicleAction(v.sys_id, 'pit_out')}>${busy ? t('Working…') : t('Send out')}</button>`
          : v.state === 'on_track'
            ? html`<button class="act" type="button" ?disabled=${!can || !!this._simBusy} @click=${() => this._vehicleAction(v.sys_id, 'pit_in')}>${busy ? t('Working…') : t('Return to pits')}</button>`
            : nothing}
        ${this._follow === `veh-${v.sys_id}`
          ? html`<button class="act primary" type="button" @click=${() => (this._follow = null)}>${t('Stop following')}</button>`
          : html`<button class="act" type="button" @click=${() => this._followVehicle(v.sys_id)}>${t('Follow')}</button>`}
        <button class="act" type="button" @click=${() => this._backToOverview()}>${t('Overview')}</button>
      </div>
    </aside>`;
  }

  /** Live Timing: compact leaderboard + authorised session controls. */
  /** Audit-derived activity plus the persisted Race Control operational events. */
  _allEvents() {
    const rc = (this._sim?.events || []).map(e => ({
      id: `rc-${e.sys_id}`,
      ts: e.created,
      kind: RC_KIND[e.kind] || 'state',
      table: e.ref_table,
      sysId: e.ref_sys_id,
      ref: e.ref_label || t('Race Control'),
      text: e.text,
      by: e.actor
    }));
    return [...rc, ...this._feed].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 60);
  }

  _renderTiming() {
    const sd = this._sim;
    if (!sd) return nothing;
    const s = sd.session;
    const counts = this._simCounts();
    const tm = this._timing || this._computeTiming(this._sessionMs());
    const st = s.state;
    const canOp = sd.canOperate && !this._simBusy;
    const btn = (action, label, enabled) => html`<button class=${classMap({act: true, busy: this._simBusy === action, warn: action === 'reset' && this._confirmReset})} type="button" ?disabled=${!canOp || !enabled}
        title=${sd.canOperate ? '' : t('You are not authorised to operate the session')}
        @click=${() => (action === 'reset' && !this._confirmReset ? (this._confirmReset = true) : this._sessionAction(action))}>${this._simBusy === action ? t('Working…') : action === 'reset' && this._confirmReset ? t('Confirm reset') : label}</button>`;
    return html`<div class="timing">
      ${this._timingOpen
        ? html`<section class="timingcard" aria-label=${t('Live timing')}>
            <header>
              <div>
                <div class="eyebrow" style="margin:0">${t('Live timing')} · ${t('Simulation')}</div>
                <div class="tmtitle">${s.session_label} <span class=${`tmstate ${st}`}>${st}</span></div>
              </div>
              <div class="tmclock" title=${t('Simulated session time')}>${this._fmtClock(tm.ms)}</div>
              <button class="xs" type="button" @click=${() => (this._timingOpen = false)} aria-label=${t('Collapse live timing')}>${icon('close', 14)}</button>
            </header>
            <div class="tmhead"><span>P</span><span></span><span>DRV</span><span>#</span><span>LAP</span><span>GAP</span><span>STATE</span></div>
            <ol class="tmrows">
              ${tm.rows.map(
                r => html`<li class=${classMap({row: true, sel: this._sel === `veh-${r.v.sys_id}`})}>
                  <button type="button" @click=${() => this._select(`veh-${r.v.sys_id}`)} aria-label=${`${r.v.driver_name}, ${this._stateLabel(r)}`}>
                    <span class="p">${r.pos ?? '–'}</span>
                    <span class="tc" style=${`background:${r.v.team_color}`}></span>
                    <span class="d">${r.v.abbreviation}</span>
                    <span class="n">${r.v.racing_number}</span>
                    <span class="l">${r.lap ?? '–'}</span>
                    <span class="g">${r.pos === 1 ? t('Leader') : r.gap || '—'}</span>
                    <span class=${`s ${r.phase}`}>${this._stateLabel(r)}</span>
                  </button></li>`
              )}
            </ol>
            <div class="tmctl">
              ${btn('start', t('Start'), ['ready', 'configured'].includes(st))}
              ${btn('pause', t('Pause'), st === 'running')}
              ${btn('resume', t('Resume'), st === 'paused')}
              ${btn('end', t('End'), ['running', 'paused'].includes(st))}
              ${btn('reset', t('Reset'), true)}
            </div>
            ${sd.canOperate && !sd.scenario && st === 'running' && s.track_status === 'green' && !this._incDlg
              ? html`<button class="act incbtn" type="button" @click=${() => this._openIncidentDialog()}>${t('Simulate incident…')}</button>`
              : nothing}
            ${this._simMsg ? html`<p class=${classMap({simmsg: true, bad: !this._simMsg.ok})} role="status">${this._simMsg.text}</p>` : nothing}
            <p class="foot">${t('Fictional practice simulation. Not real Formula 1 telemetry. Every control is a ServiceNow transaction.')}</p>
          </section>`
        : nothing}
      <button class="feedbtn" type="button" aria-expanded=${String(this._timingOpen)} @click=${() => {
        this._timingOpen = !this._timingOpen;
        if (this._timingOpen) {
          this._feedOpen = false;
          this._timing = this._computeTiming(this._sessionMs());
        }
      }}><span>${t('Live timing')}</span><b>${counts.on}</b></button>
    </div>`;
  }

  /** Tiered text labels: the circuit overview shows landmarks only; more appear as the camera comes closer. */
  _renderLabels() {
    const all = this._all();
    return LABELS.filter(l => all[l.fid]).map(l => {
      const [x, y] = project(l.world[0], l.world[1], l.z);
      const [dx, dy] = l.delta;
      const w = l.text.length * 6.6 + 18;
      const sel = this._sel === l.fid;
      const small = l.tier > 0 && !l.leader;
      return svg`<g style=${`transform: translate(${x}px, ${y}px) scale(var(--inv))`}>
        ${l.leader ? svg`<path class="leader" d=${`M0 0L${dx} ${dy}`}></path><circle class="dot" r="2.6"></circle>` : nothing}
        <g class=${classMap({lbl: true, sel, sm: small, [`t${l.tier}`]: true})} data-fid=${l.fid} tabindex="0" role="button" aria-label=${`${kindLabel(l.kind)}: ${l.text}`} transform=${`translate(${dx} ${dy})`}>
          <rect class="pill" x=${-w / 2} y="-11" width=${w} height="22" rx="11"></rect>
          <text y="4.4" text-anchor="middle">${l.text}</text></g></g>`;
    });
  }

  _renderSelection() {
    const f = this._sel ? this._all()[this._sel] : null;
    if (!f || f.vid) return nothing;
    const g = f.geom;
    if (g.type === 'poly') {
      const d = `M${g.top.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
      return svg`<path class="sel-poly" d=${d}></path>`;
    }
    if (g.type === 'line') {
      const d = `M${g.pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`;
      const w = f.kind === 'corner' || f.kind === 'straight' ? TRACK_W + 4 : 12;
      return svg`<g transform=${`scale(1 ${GROUND_Y})`}><path class="sel-glow" d=${d} stroke-width=${w}></path><path class="sel-line" d=${d}></path></g>`;
    }
    const [x, y] = project(f.anchor[0], f.anchor[1], f.z || 0);
    return svg`<circle class="sel-ring" r="18" style=${`transform: translate(${x}px, ${y}px) scale(var(--inv))`}></circle>`;
  }

  _recordLink(table, sysId) {
    return `/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=${sysId}`)}`;
  }

  _fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(`${ts.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return ts;
    return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(d);
  }

  _ago(ts) {
    const d = new Date(`${String(ts).replace(' ', 'T')}Z`).getTime();
    if (!d) return '';
    const s = Math.round((d - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'});
    const a = Math.abs(s);
    if (a < 60) return rtf.format(Math.round(s), 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }

  _link(table, id, text) {
    return html`<a class="rec-link" href=${this._recordLink(table, id)} target="_blank" rel="noopener noreferrer">${text} ↗</a>`;
  }

  _statusDot(c) {
    return c.opValue === '1' ? 'ok' : c.opValue === '2' ? 'bad' : c.opValue ? 'warn' : '';
  }

  _incidentRows(list, limit = 5) {
    return html`<ul class="recs">
      ${list.slice(0, limit).map(
        i => html`<li>
          <button class="lnk" type="button" @click=${() => this._select(`inc-${i.sysId}`)}>${i.number}</button>
          <span class=${classMap({resolvedtxt: i.resolved})}>${i.resolved ? '' : `P${i.priority} · `}${i.state} · ${i.desc}</span>
        </li>`
      )}
    </ul>
    ${list.length > limit ? html`<p class="note">${fill(t('+{0} more'), list.length - limit)}</p>` : nothing}`;
  }

  /** Incident card: real fields from the incident record. */
  _renderIncidentCard(f) {
    const i = f.rec;
    const ci = this._sn.cis.find(c => c.sysId === i.ciId);
    const host = this._all()[f.host];
    const tasks = this._sn.tasks.filter(x => x.incidentId === i.sysId);
    const row = (k, v) => html`<dt>${k}</dt><dd>${v || '—'}</dd>`;
    return html`<aside class="card" aria-label=${t('Incident detail')}>
      <button class="x" @click=${() => this._backToOverview()} aria-label=${t('Close and return to overview')}>${icon('close', 18)}</button>
      <h2 class="title">${i.number}</h2>
      <p class="kind">${t('Incident')} · ${i.resolved ? t('Resolved') : i.priorityLabel}</p>
      <p class="lead">${i.desc}</p>
      <dl>
        ${row(t('Priority'), i.priorityLabel)}
        ${row(t('State'), i.state)}
        ${row(t('Assignment group'), i.group)}
        ${row(t('Assigned to'), i.assignedTo)}
        ${row(t('Category'), i.category)}
        ${row(t('Facility'), host ? html`<button class="lnk" type="button" @click=${() => this._select(f.host)}>${i.location || host.name}</button>` : i.location)}
        ${row(t('Configuration item'), ci ? html`<button class="lnk" type="button" @click=${() => this._select(`ci-${ci.sysId}`)}>${ci.name}</button>` : i.ci)}
        ${ci ? row(t('CI status'), html`<span class=${`st ${this._statusDot(ci)}`}>${ci.opStatus}</span>`) : nothing}
        ${row(t('Opened'), this._fmtTime(i.created))}
        ${row(t('Updated'), this._fmtTime(i.updated))}
      </dl>
      ${tasks.length
        ? html`<div class="rule"></div><p class="eyebrow">${t('Open tasks')}</p>
            <ul class="recs">${tasks.map(x => html`<li><a class="rec-link" href=${this._recordLink('incident_task', x.sysId)} target="_blank" rel="noopener noreferrer">${x.number}</a><span>${x.state} · ${x.desc}${x.group ? ` · ${x.group}` : ''}</span></li>`)}</ul>`
        : nothing}
      <div class="rule"></div>
      <p class="note">${t('Incident state is separate from the CI operational status. Resolving an incident does not change the CI.')}</p>
      <div class="actions">
        <a class="act primary" href=${this._recordLink('incident', i.sysId)} target="_blank" rel="noopener noreferrer">${t('Open incident')} ↗</a>
        <button class="act" type="button" @click=${() => this._backToOverview()}>${t('Overview')}</button>
      </div>
    </aside>`;
  }

  /** Configuration item card. */
  _renderCiCard(f) {
    const c = f.rec;
    const host = this._all()[f.host];
    const incs = this._sn.incidents.filter(i => !i.resolved && i.ciId === c.sysId);
    const row = (k, v) => html`<dt>${k}</dt><dd>${v || '—'}</dd>`;
    return html`<aside class="card" aria-label=${t('Configuration item detail')}>
      <button class="x" @click=${() => this._backToOverview()} aria-label=${t('Close and return to overview')}>${icon('close', 18)}</button>
      <h2 class="title">${c.name}</h2>
      <p class="kind">${c.clsLabel}</p>
      <dl>
        ${row(t('Operational status'), html`<span class=${`st ${this._statusDot(c)}`}>${c.opStatus || t('Not set')}</span>`)}
        ${row(t('Install status'), c.install)}
        ${row(t('Support group'), c.group)}
        ${row(t('Facility'), host ? html`<button class="lnk" type="button" @click=${() => this._select(f.host)}>${host.name}</button>` : '')}
        ${row(t('Last updated'), this._fmtTime(c.updated))}
      </dl>
      <div class="rule"></div>
      <p class="eyebrow">${t('Related active incidents')}</p>
      ${incs.length ? this._incidentRows(incs) : html`<p class="note">${t('No active incidents reference this CI.')}</p>`}
      <div class="actions">
        <a class="act primary" href=${this._recordLink(c.cls || 'cmdb_ci', c.sysId)} target="_blank" rel="noopener noreferrer">${t('Open record')} ↗</a>
        <button class="act" type="button" @click=${() => this._backToOverview()}>${t('Overview')}</button>
      </div>
    </aside>`;
  }

  _renderSnSection(f) {
    const b = this._assoc.bundles[f.id];
    if (f.record) {
      return html`<p class="eyebrow">${t('ServiceNow record')}</p>${this._link(f.record.table, f.record.sysId, t('Open record'))}`;
    }
    if (!b || !b.location) {
      const applicable = !['corner', 'straight', 'pit-lane', 'pit-service', 'emergency-access', 'pit-entry', 'pit-exit'].includes(f.kind);
      return html`<p class="eyebrow">${t('ServiceNow')}</p>
        <p class="note">${t('No ServiceNow record is linked to this location.')}${applicable
          ? html` ${t('Link a cmn_location with correlation_id rc360:osm:')}${f.id}.`
          : nothing}</p>`;
    }
    const loc = b.location;
    const prov = {'osm-verified': t('OpenStreetMap footprint (verified)'), representative: t('Representative position (simulation)'), simulation: t('Simulation')}[loc.provenance] || loc.provenance;
    const activeInc = b.incidents.filter(i => !i.resolved);
    const done = b.incidents.filter(i => i.resolved);
    return html`<p class="eyebrow">${t('ServiceNow')}</p>
      <dl>
        <dt>${t('Location')}</dt><dd>${this._link('cmn_location', loc.sysId, loc.name)}</dd>
        <dt>${t('Type')}</dt><dd>${loc.type || '—'}</dd>
        <dt>${t('Responsible team')}</dt><dd>${loc.team || '—'}</dd>
        <dt>${t('Placement')}</dt><dd>${prov || '—'}</dd>
      </dl>
      <div class="rule"></div>
      <p class="eyebrow">${t('Active incidents')}</p>
      ${activeInc.length ? this._incidentRows(activeInc) : html`<p class="note">${t('No active incidents at this location.')}</p>`}
      ${done.length ? html`<p class="eyebrow" style="margin-top:10px">${t('Recently resolved')}</p>${this._incidentRows(done, 3)}` : nothing}
      ${b.cis.length
        ? html`<div class="rule"></div><p class="eyebrow">${t('Configuration items')}</p>
            <ul class="recs">
              ${b.cis.slice(0, 6).map(c => html`<li><button class="lnk" type="button" @click=${() => this._select(`ci-${c.sysId}`)}>${c.name}</button><span class=${`st ${this._statusDot(c)}`}>${c.clsLabel} · ${c.opStatus || t('Not set')}</span></li>`)}
            </ul>
            ${b.cis.length > 6 ? html`<p class="note">${fill(t('+{0} more'), b.cis.length - 6)}</p>` : nothing}`
        : nothing}`;
  }

  /** Amber local-caution zone and red-flag treatment, in the ground plane. Drawn as edge lines plus a faint band, never an opaque fill. */
  _renderRestrictions() {
    const sd = this._sim;
    if (!sd) return nothing;
    const routes = svg`<g id="rc-routes" data-layer="emergency">${this._renderRoutes()}</g>`;
    const ts = sd.session.track_status;
    if (ts === 'green' || !this._layers.restrictions) return routes;
    const W = TRACK_W;
    const red = ts === 'red';
    const rz = this._rz || {};
    return svg`<g id="rc-restrictions" data-layer="restrictions">
      ${rz.loop ? svg`<path class=${classMap({'rz-band': true, red})} d=${rz.loop.c} stroke-width=${W + 10}></path><path class=${classMap({'rz-edge': true, red})} d=${rz.loop.l}></path><path class=${classMap({'rz-edge': true, red})} d=${rz.loop.r}></path>` : nothing}
      ${rz.zone ? svg`<path class=${classMap({'rz-band': true, red})} d=${rz.zone.c} stroke-width=${W + 14}></path><path class=${classMap({'rz-edge': true, red, zone: true})} d=${rz.zone.l}></path><path class=${classMap({'rz-edge': true, red, zone: true})} d=${rz.zone.r}></path>` : nothing}
    </g>${routes}`;
  }

  /** Geometry for the caution zone / red-flag edges. Computed when ServiceNow state changes, not on every render. */
  _buildRestrictions() {
    const sd = this._sim;
    this._rz = {};
    if (!sd) return;
    const ts = sd.session.track_status;
    const scn = sd.scenario;
    if (ts === 'green') return;
    const L = sd.session.lap_length_m || SIM_L;
    const W = TRACK_W;
    const sample = (from, to, step) => {
      const out = {c: [], l: [], r: []};
      const span = to - from > 0 ? to - from : to - from + L;
      const n = Math.max(2, Math.ceil(span / step));
      for (let i = 0; i <= n; i++) {
        const p = pointAt((((from + (span * i) / n) % L) + L) % L);
        const nx = -Math.sin(p.heading);
        const ny = Math.cos(p.heading);
        out.c.push([p.x, p.y]);
        out.l.push([p.x + nx * (W / 2 + 0.9), p.y + ny * (W / 2 + 0.9)]);
        out.r.push([p.x - nx * (W / 2 + 0.9), p.y - ny * (W / 2 + 0.9)]);
      }
      return out;
    };
    const d = pts => `M${pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`;
    if (scn) {
      const z = sample(scn.caution_from_m, scn.caution_to_m, 10);
      this._rz.zone = {c: d(z.c), l: d(z.l), r: d(z.r)};
    }
    if (ts === 'red' || ts === 'amber') {
      const w = sample(0, L - 1, 24);
      this._rz.loop = {c: d(w.c), l: d(w.l), r: d(w.r)};
    }
  }

  /** Signal panels. The state comes ONLY from the persisted effective track status (a pending approval changes nothing). */
  _renderSignals() {
    const sd = this._sim;
    if (!sd) return nothing;
    const ts = sd.session.track_status;
    const mode = ts === 'red' ? 'red' : ts === 'amber' ? 'amber' : ts === 'caution' ? 'local' : 'green';
    const sector = sd.scenario?.sector_number || 0;
    const corners = [...(sd.corners || [])].sort((a, b) => a.entry_m - b.entry_m);
    const sectorOf = d => {
      let c = corners[0];
      corners.forEach(x => {
        if (x.entry_m <= d) c = x;
      });
      return c ? c.sector : 1;
    };
    return svg`<g id="rc-signals" class=${`sigs mode-${mode}`}>${SIGNALS.map(g => {
      const lit = mode === 'local' && sectorOf(g.d) === sector;
      return svg`<g class=${classMap({sig: true, lit})} style=${`transform: translate(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px) scale(var(--inv))`}>
        <g class="sigin">
          <path class="pole" d="M0 6L0 17M-5 17L5 17"></path>
          <circle class="bloom" r="17"></circle>
          <rect class="hous" x="-10" y="-7.5" width="20" height="15" rx="2.2"></rect>
          <rect class="lens" x="-7.2" y="-4.8" width="14.4" height="9.6" rx="1.4"></rect>
          <path class="grid" d="M-2.4 -4.8V4.8M2.4 -4.8V4.8"></path>
        </g>
      </g>`;
    })}</g>`;
  }

  _renderRoutes() {
    const sd = this._sim;
    if (!sd || !this._layers.emergency) return nothing;
    return sd.responses
      .filter(r => r.state === 'dispatched' && !this._taskClosed(r))
      .map(r => {
        const route = this._routeOf(r);
        if (!route) return nothing;
        const d = `M${route.pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`;
        return svg`<path class=${`routeline ${r.type}`} d=${d}></path>`;
      });
  }

  _taskClosed(r) {
    const tk = this._sim?.tasks.find(x => x.sys_id === r.task);
    return !!(tk && tk.closed);
  }

  /** The incident at its true location, and dispatched response vehicles. Both come from ServiceNow records. */
  _renderScenarioMarkers() {
    const sd = this._sim;
    if (!sd || !sd.scenario) return nothing;
    const scn = sd.scenario;
    const L = sd.session.lap_length_m || SIM_L;
    const out = [];
    if (this._layers.incidents) {
      const p = crashPoint(scn.stop_distance_m, scn.lateral_offset_m, L);
      const [x, y] = project(p.x, p.y);
      const sel = this._sel === 'scenario';
      out.push(svg`<g id="rc-crashmarker" class="marker crashmk hidden" data-fid="scenario" tabindex="0" role="button" aria-label=${`${scn.incident_number}: ${scn.name}`} style=${`transform: translate(${x}px, ${y}px) scale(var(--inv)) translate(0px, -72px)`}>
        <path class="leader" d="M0 14L0 40" style="stroke:#d6342a"></path>
        <circle class="pulse" r="13"></circle>
        <circle class="mk-shadow" r="13" cx="1" cy="2"></circle>
        <circle class="mk-ring" r="13" style=${`stroke:${SEV.critical};stroke-width:${sel ? 3.4 : 2.6}`}></circle>
        <path class="mk-glyph solid" d=${MARKER_GLYPH.emergency} style=${`fill:${SEV.critical};transform:scale(1.15)`}></path>
      </g>`);
    }
    if (this._layers.emergency) {
      sd.responses
        .filter(r => r.state === 'dispatched' && !this._taskClosed(r))
        .forEach(r => {
          const fid = `resp-${r.sys_id}`;
          const sel = this._sel === fid;
          out.push(svg`<g class=${classMap({resp: true, sel, [r.type]: true})} data-fid=${fid} data-rid=${r.sys_id} tabindex="0" role="button" aria-label=${`${r.label}, ${r.task_number}`}>
            <circle class="sh" cx="1" cy="2" r="12"></circle>
            <circle class="rbody" r="12"></circle>
            <path class="rglyph" d=${RESP_GLYPH[r.type]}></path>
          </g>`);
        });
    }
    return out;
  }

  _renderAlert() {
    const sd = this._sim;
    const scn = sd?.scenario;
    if (!scn) return nothing;
    const v = sd.vehicles.find(x => x.sys_id === scn.vehicle);
    const ts = sd.session.track_status;
    const second = ts === 'red' ? t('Red flag · session suspended · recovery in progress') : ts === 'amber' ? t('Amber caution · cars returning to the pits') : t('Response assessment required');
    return html`<button class=${classMap({rcalert: true, red: ts === 'red'})} type="button" @click=${() => this._select('scenario')} aria-label=${t('Open incident response')}>
      <span class="adot"></span>
      <span class="atxt"><b>${t('TRACK INCIDENT')} · ${scn.corner_name}</b>
        <small>${v ? `${t('Car')} ${v.racing_number} ${t('stopped in runoff area')}` : ''} · ${scn.incident_number} · ${second}</small></span>
    </button>`;
  }

  _scnPost(path, body, okText, busyKey) {
    return this._runAction(busyKey, () => this._simRequest('POST', path, body), okText);
  }

  /**
   * `persisted` (optional) is checked against the authoritative ServiceNow state after a failed or lost response, so a
   * request the server did complete is never reported as failed (or retried as a duplicate).
   */
  async _runAction(busyKey, call, okText, persisted) {
    if (this._simBusy) return null;
    this._simBusy = busyKey;
    this._simMsg = null;
    let r = {ok: false, status: 0, result: null};
    try {
      r = await call();
      if (r.ok && r.result?.ok) {
        this._applySim(r.result, r.t0, r.t1);
        this._simMsg = {ok: true, text: okText};
      } else {
        this._simMsg = {
          ok: false,
          text: r.result?.error || (r.timedOut ? t('ServiceNow did not respond in time. Checking the stored result.') : fill(t('Request failed (HTTP {0})'), r.status))
        };
        await this._loadSim();
        if (r.status === 0 && persisted?.()) {
          r = {...r, ok: true, result: {ok: true}, reconciled: true};
          this._simMsg = {ok: true, text: okText};
        }
      }
    } catch {
      this._simMsg = {ok: false, text: t('The action could not be completed. Check ServiceNow and try again.')};
    } finally {
      this._simBusy = null;
      this._invalidate();
    }
    return r;
  }

  _statusChip(state) {
    const m = {pending: 'warn', approved: 'ok', applied: 'ok', rejected: 'bad', blocked: 'bad', cancelled: '', planned: '', dispatched: 'ok', not_sent: '', simulated_delivered: 'ok'};
    return html`<span class=${`chip ${m[state] || ''}`}>${String(state || '').replace('_', ' ')}</span>`;
  }

  /** Genuine task state -> step status. Nothing is inferred beyond the persisted task and dispatch records. */
  _stepOf(tk, sd) {
    if (!tk) return {k: 'pending', st: t('Pending')};
    if (tk.closed) return {k: 'done', st: t('Completed')};
    const r = sd.responses.find(x => x.task === tk.sys_id);
    if (tk.state_value === 2 || (r && r.state === 'dispatched')) return {k: 'prog2', st: t('In progress')};
    return {k: 'pending', st: t('Pending')};
  }

  _openDetails(tab) {
    this._scnTab = tab;
    this._scnView = 'details';
  }

  /** Incident panel: a three-second summary first; every operational control lives under "Operational details". */
  _renderScenarioCard() {
    const sd = this._sim;
    const live = sd?.scenario;
    const closed = !live && this._closedScn;
    const scn = live || closed?.scn;
    if (!sd || !scn) return nothing;
    const tasks = live ? sd.tasks : closed.tasks;
    const v = live ? sd.vehicles.find(x => x.sys_id === scn.vehicle) : closed.vehicle;
    const ts = sd.session.track_status;
    const order = ['fire', 'medical', 'recovery', 'debris', 'inspection'];
    const steps = order.map(k => {
      const tk = tasks.find(x => x.key === k);
      return {tk, label: tk ? tk.label : k, ...(closed ? {k: 'done', st: t('Completed')} : this._stepOf(tk, sd))};
    });
    const done = steps.filter(x => x.k === 'done').length;
    const total = steps.length;
    const pend = sd.decisions.filter(d => d.state === 'pending');
    const can = sd.canOperate && !this._simBusy;
    let primary = null;
    if (live) {
      if (pend.length) primary = {label: t('View pending decision'), fn: () => this._openDetails('decisions')};
      else if (done === total && !sd.blockers.length && can) primary = {label: t('Request return to green'), fn: () => this._restriction('green')};
      else if (done === total) primary = {label: t('Review restart readiness'), fn: () => this._openDetails('restart')};
      else if (done === 0 && ts !== 'red' && can && sd.session.state === 'running') primary = {label: t('Request red flag'), fn: () => (this._rfDlg = {mode: 'pit', reason: ''})};
      else if (done === 0) primary = {label: t('Coordinate response'), fn: () => this._openDetails('response')};
      else primary = {label: t('Review restart readiness'), fn: () => this._openDetails('restart')};
    }
    const trk = live ? ts : 'green';
    const trkLabel = this._trackLabel(trk);
    const head = html`<button class="x" @click=${() => this._backToOverview()} aria-label=${t('Close and return to overview')}>${icon('close', 18)}</button>`;
    if (live && this._scnView === 'details') return this._renderScenarioDetails(scn, v, head);
    return html`<aside class="card wide scn2" aria-label=${t('Incident response')}>
      ${head}
      <p class="eyebrow2">${closed ? t('Incident recovered') : t('Track incident')} · ${t('Simulation')}</p>
      <h2>${scn.corner_name}</h2>
      <p class="sub">${v ? html`<b>${v.abbreviation}</b> · #${v.racing_number} · ${v.team}` : ''} · ${t('Sector')} ${scn.sector_number}${this._link('incident', scn.incident, scn.incident_number)}</p>
      <div class="trkrow">
        <span class=${`trkpill ${trk}`}>${trkLabel}</span>
        <span class="ses">${closed ? t('Restart approved · session running') : fill(t('Session {0}'), sd.session.state)}${!closed && sd.restriction?.state === 'pending' ? ` · ${t('red flag awaiting approval')}` : ''}</span>
      </div>
      <div class="prog"><span>${t('Response')}</span><b>${fill(t('{0} of {1} response steps complete'), done, total)}</b></div>
      <div class="bar" role="progressbar" aria-label=${t('Response progress')} aria-valuemin="0" aria-valuemax=${total} aria-valuenow=${done}><i style=${`width:${(done / total) * 100}%`}></i></div>
      <ul class="steps">
        ${steps.map(x => html`<li class=${x.k}><span class="ic" aria-hidden="true">${x.k === 'done' ? '✓' : ''}</span><span>${x.label}</span><span class="st">${x.st}</span></li>`)}
      </ul>
      ${this._simMsg ? html`<p class=${classMap({simmsg: true, bad: !this._simMsg.ok})} role="status">${this._simMsg.text}</p>` : nothing}
      <div class="actions2">
        ${primary ? html`<button class="act primary big" type="button" ?disabled=${!!this._simBusy} @click=${primary.fn}>${this._simBusy ? t('Working…') : primary.label}</button>` : nothing}
        ${live ? html`<button class="act big" type="button" @click=${() => this._openDetails(this._scnTab)}>${t('Operational details')}</button>` : html`<button class="act big" type="button" @click=${() => this._backToOverview()}>${t('Overview')}</button>`}
      </div>
    </aside>`;
  }

  /** Secondary view: one section at a time. Every action calls the same governed endpoints as before. */
  _renderScenarioDetails(scn, v, head) {
    const sd = this._sim;
    const can = sd.canOperate && !this._simBusy;
    const ts = sd.session.track_status;
    const respOf = tk => sd.responses.find(r => r.task === tk.sys_id);
    const pendingOf = type => sd.decisions.find(d => d.type === type && d.state === 'pending');
    const btn = (label, fn, enabled = true, key = label, primary = false) => html`<button class=${classMap({act: true, primary})} type="button" ?disabled=${!can || !enabled} @click=${fn}>${this._simBusy === key ? t('Working…') : label}</button>`;
    const tab = this._scnTab;
    const decRow = d => html`<li>
      <div class="row2"><a class="rec-link" href=${this._recordLink(DEC_TABLE, d.sys_id)} target="_blank" rel="noopener noreferrer">${d.number}</a><span>${t(DEC_LABEL[d.type] || d.type)}</span>${this._statusChip(d.state)}</div>
      <span>${d.reason}${d.response_mode ? ` · ${d.response_mode === 'freeze' ? t('Immediate simulation freeze') : t('Slow and proceed to pits')}` : ''}</span>
      <span class="mut">${t('Requested by')} ${d.requested_by}${d.approval ? ` · ${t('approver')} ${d.approval.approver}: ${d.approval.state}` : ''}${d.blocked_reason ? ` · ${d.blocked_reason}` : ''}</span>
      ${d.can_decide
        ? html`<div class="row2"><button class="act primary sm" type="button" ?disabled=${!!this._simBusy} @click=${() => this._scnPost(`/decision/${d.sys_id}/decide`, {outcome: 'approve'}, t('Approval recorded in ServiceNow'), `a${d.sys_id}`)}>${t('Approve')}</button><button class="act sm" type="button" ?disabled=${!!this._simBusy} @click=${() => this._scnPost(`/decision/${d.sys_id}/decide`, {outcome: 'reject'}, t('Rejection recorded in ServiceNow'), `r${d.sys_id}`)}>${t('Reject')}</button></div>`
        : nothing}
    </li>`;
    let body = nothing;
    if (tab === 'response') {
      body = html`<ul class="recs">
        ${sd.tasks.map(tk => {
          const r = respOf(tk);
          return html`<li>
            <div class="row2"><a class="rec-link" href=${this._recordLink('incident_task', tk.sys_id)} target="_blank" rel="noopener noreferrer">${tk.number}</a><span>${tk.label}</span><span class=${`chip ${tk.closed ? 'ok' : tk.state_value === 2 ? 'warn' : ''}`}>${tk.state}</span></div>
            <span class="mut">${tk.group}${r ? ` · ${t('Dispatch')}: ${r.state}` : ''}</span>
            ${tk.closed
              ? nothing
              : html`<div class="row2">
                  ${r && r.state === 'planned' ? html`<button class="act sm" type="button" ?disabled=${!can} @click=${() => this._scnPost(`/response/${r.sys_id}/dispatch`, {}, fill(t('{0} dispatch authorised'), r.label.split(' (')[0]), `d${r.sys_id}`)}>${this._simBusy === `d${r.sys_id}` ? t('Working…') : t('Dispatch')}</button>` : nothing}
                  <button class="act sm" type="button" ?disabled=${!can} @click=${() => this._scnPost(`/task/${tk.sys_id}/complete`, {}, fill(t('{0} completed in ServiceNow'), tk.number), `c${tk.sys_id}`)}>${this._simBusy === `c${tk.sys_id}` ? t('Working…') : t('Mark complete')}</button>
                </div>`}
          </li>`;
        })}
      </ul>`;
    } else if (tab === 'decisions') {
      const list = sd.decisions.filter(d => d.type !== 'announcement');
      body = html`${list.length ? html`<ul class="recs dec">${list.map(decRow)}</ul>` : html`<p class="note">${t('No race-control decisions requested yet.')}</p>`}
        <div class="actions">${btn(t('Request red flag'), () => (this._rfDlg = {mode: 'pit', reason: ''}), ts !== 'red' && !pendingOf('red_flag') && sd.session.state === 'running', 'rf')}</div>`;
    } else if (tab === 'comms') {
      const list = sd.decisions.filter(d => d.type === 'announcement');
      body = html`${list.length
        ? html`<ul class="recs dec">${list.map(d => html`${decRow(d)}<li><span>“${d.message}”</span><span class="mut">${t('Audience')}: ${d.audience} · ${t('Delivery')}: ${this._statusChip(d.delivery_state)} ${d.delivery_state === 'simulated_delivered' ? t('simulated, no real system') : ''}</span></li>`)}</ul>`
        : html`<p class="note">${t('No announcement prepared yet.')}</p>`}
        <div class="actions">${btn(t('Prepare public announcement'), () => this._scnPost('/decision/request', {type: 'announcement'}, t('Announcement prepared for approval'), 'ann'), !pendingOf('announcement'), 'ann')}</div>`;
    } else {
      body = html`<ul class="recs ck">
          ${sd.checklist.map(c => html`<li class=${c.done ? 'done' : ''}><span class="box">${c.done ? '✓' : ''}</span><span>${c.label}${c.ref ? html` · ${this._link(c.ref.table, c.ref.sys_id, c.ref.number)}` : ''}<br /><small>${c.group}</small></span></li>`)}
        </ul>
        ${sd.blockers.length ? html`<p class="note bl">${t('Blocking')}: ${sd.blockers.map(b => b.label).join(' · ')}</p>` : html`<p class="note">${t('All prerequisites complete. Restart still needs its own approval.')}</p>`}
        <div class="actions">${btn(t('Request return to green'), () => this._scnPost('/decision/request', {type: 'restart'}, t('Restart requested. Pending approval'), 'rs'), !sd.blockers.length && !pendingOf('restart'), 'rs', true)}</div>`;
    }
    const tabs = [['response', t('Response')], ['decisions', t('Decisions')], ['comms', t('Communications')], ['restart', t('Restart')]];
    return html`<aside class="card wide scn2" aria-label=${t('Operational details')}>
      ${head}
      <button class="backlink" type="button" @click=${() => (this._scnView = 'summary')}>← ${t('Summary')}</button>
      <h2 style="font-size:24px;margin-top:6px">${scn.corner_name}</h2>
      <p class="sub" style="font-size:16px">${v ? `${v.abbreviation} · #${v.racing_number}` : ''} · ${this._trackLabel(ts)}</p>
      <div class="tabs" role="tablist">${tabs.map(([id, label]) => html`<button type="button" role="tab" aria-selected=${String(tab === id)} @click=${() => (this._scnTab = id)}>${label}</button>`)}</div>
      <div class="det" role="tabpanel">${body}</div>
      ${this._simMsg ? html`<p class=${classMap({simmsg: true, bad: !this._simMsg.ok})} role="status">${this._simMsg.text}</p>` : nothing}
      <p class="foot">${t('Fictional simulation. Nothing here is connected to real race-control, public-address or emergency systems.')}</p>
    </aside>`;
  }

  _renderResponseCard(f) {
    const sd = this._sim;
    const r = sd?.responses.find(x => x.sys_id === f.rid);
    if (!r) return nothing;
    const route = this._routeOf(r);
    const tk = sd.tasks.find(x => x.sys_id === r.task);
    const row = (k, v) => html`<dt>${k}</dt><dd>${v || '—'}</dd>`;
    return html`<aside class="card" aria-label=${t('Response vehicle')}>
      <button class="x" @click=${() => this._backToOverview()} aria-label=${t('Close and return to overview')}>${icon('close', 18)}</button>
      <h2 class="title">${r.label.split(' (')[0]}</h2>
      <p class="kind">${t('Response vehicle')} · ${t('simulated')}</p>
      <dl>
        ${row(t('Task'), tk ? this._link('incident_task', tk.sys_id, tk.number) : r.task_number)}
        ${row(t('Task state'), tk?.state)}
        ${row(t('Dispatch'), r.state)}
        ${row(t('Dispatched by'), r.dispatched_by)}
        ${row(t('From'), r.origin_name)}
        ${row(t('Route'), route ? fill(t('{0} m over mapped service roads'), Math.round(route.length)) : t('No safe mapped route: destination only'))}
      </dl>
      <div class="rule"></div>
      <p class="note">${t('Shown because ServiceNow records an authorised dispatch. Position is interpolated along the route from the persisted dispatch time.')}</p>
      <div class="actions">
        <a class="act primary" href=${this._recordLink(RESP_TABLE, r.sys_id)} target="_blank" rel="noopener noreferrer">${t('Open dispatch record')} ↗</a>
        <button class="act" type="button" @click=${() => this._backToOverview()}>${t('Overview')}</button>
      </div>
    </aside>`;
  }

  _trackLabel(ts) {
    const m = {green: 'GREEN', caution: 'LOCAL CAUTION', amber: 'AMBER CAUTION', red: 'RED FLAG'};
    return t(m[ts] || String(ts || '').toUpperCase());
  }

  /** One crash dialog for both entry points (top-left button and Live Timing). It posts to the one existing trigger operation. */
  _renderIncidentDialog() {
    const dlg = this._incDlg;
    const sd = this._sim;
    if (!dlg || !sd) return nothing;
    const onTrack = sd.vehicles.filter(v => v.state === 'on_track');
    const v = sd.vehicles.find(x => x.sys_id === dlg.vehicleId);
    const p = dlg.preview;
    return html`<button class="scrim" type="button" tabindex="-1" aria-label=${t('Close dialog')} @click=${() => (this._incDlg = null)}></button>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="crash-h">
        <p class="eyebrow" style="margin:0 0 4px">${t('Simulation · operator only')}</p>
        <h2 id="crash-h" class="mtitle">${t('Simulate crash')}</h2>
        <dl class="mdl">
          <dt>${t('Session')}</dt><dd>${sd.session.session_label} · ${sd.session.state}</dd>
        </dl>
        <label class="sel"><span>${t('Vehicle')}</span>
          <select @change=${e => this._openIncidentDialog(e.target.value)}>
            ${onTrack.map(x => html`<option value=${x.sys_id} ?selected=${x.sys_id === dlg.vehicleId}>${x.abbreviation} · #${x.racing_number} · ${x.driver_name}</option>`)}
          </select></label>
        ${v ? html`<p class="kind" style="margin:0 0 10px"><span class="tdot" style=${`background:${v.team_color}`}></span>${v.driver_name} · ${v.team}</p>` : nothing}
        <fieldset class="opts">
          <legend>${t('Crash location')}</legend>
          <label class="radio"><input type="radio" name="cm" .checked=${dlg.mode === 'next'} @change=${() => this._openIncidentDialog(dlg.vehicleId, {mode: 'next', corner: ''})} />
            <span><b>${t('Next eligible corner')}</b><small>${t('Safe default: the car keeps running and crashes at the next configured corner.')}</small></span></label>
          <label class="radio"><input type="radio" name="cm" .checked=${dlg.mode === 'immediate'} @change=${() => this._openIncidentDialog(dlg.vehicleId, {mode: 'immediate', corner: dlg.corner || sd.corners[0]?.name || ''})} />
            <span><b>${t('Crash immediately at a configured location')}</b><small>${t('Demo mode: ServiceNow places the car on the approach to the corner, then it crashes within seconds.')}</small></span></label>
          ${dlg.mode === 'immediate'
            ? html`<label class="sel" style="margin:6px 0 0 26px"><span>${t('Corner')}</span>
                <select aria-label=${t('Crash corner')} @change=${e => this._openIncidentDialog(dlg.vehicleId, {corner: e.target.value})}>
                  ${sd.corners.map(c => html`<option value=${c.name} ?selected=${c.name === dlg.corner}>${c.name} · S${c.sector}</option>`)}
                </select></label>`
            : nothing}
        </fieldset>
        ${p
          ? html`<dl class="mdl">
              <dt>${t('Corner')}</dt><dd>${p.corner} · S${p.sector}</dd>
              <dt>${t('Crash in about')}</dt><dd>${p.secondsUntilIncident} s${p.repositioned ? ` · ${t('car placed on the approach')}` : ''}</dd>
            </dl>`
          : html`<p class=${classMap({note: true, bad: !!dlg.error})}>${dlg.error || t('Checking with ServiceNow…')}</p>`}
        <p class="note warnnote">${t('Fictional simulation. It creates real ServiceNow records (incident, tasks, dispatch plans) but nothing at the real circuit.')}</p>
        <div class="actions">
          <button class="act primary" type="button" ?disabled=${!p || !!this._simBusy} @click=${() => this._confirmIncident()}>${this._simBusy === 'trigger' ? t('Working…') : t('Confirm simulation')}</button>
          <button class="act" type="button" @click=${() => (this._incDlg = null)}>${t('Cancel')}</button>
        </div>
      </div>`;
  }

  async _openIncidentDialog(vehicleId, patch = {}) {
    const sd = this._sim;
    if (!sd) return;
    const onTrack = sd.vehicles.filter(v => v.state === 'on_track');
    const prev = this._incDlg;
    const id = vehicleId || prev?.vehicleId || (onTrack.find(v => v.abbreviation === 'VER') || onTrack[0])?.sys_id;
    if (!id) {
      this._simMsg = {ok: false, text: t('No vehicle is on track')};
      return;
    }
    const dlg = {vehicleId: id, key: prev?.key || (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`), mode: patch.mode ?? prev?.mode ?? 'next', corner: patch.corner ?? prev?.corner ?? '', preview: null, error: '', n: (prev?.n || 0) + 1};
    this._incDlg = dlg;
    this._menuOpen = false;
    if (!prev) this.updateComplete.then(() => this.renderRoot.querySelector('.modal select')?.focus());
    const q = `vehicle=${id}&mode=${dlg.mode}${dlg.mode === 'immediate' && dlg.corner ? `&corner=${encodeURIComponent(dlg.corner)}` : ''}`;
    const r = await this._simRequest('GET', `/scenario/preview?${q}`);
    if (this._incDlg?.n !== dlg.n) return; // a newer choice superseded this preview
    this._incDlg = {...dlg, preview: r.ok && r.result?.ok ? r.result : null, error: r.result?.error || (r.ok ? '' : fill(t('Request failed (HTTP {0})'), r.status))};
  }

  async _confirmIncident() {
    const dlg = this._incDlg;
    if (!dlg) return;
    const body = {vehicleId: dlg.vehicleId, requestKey: dlg.key, mode: dlg.mode};
    if (dlg.mode === 'immediate') body.corner = dlg.corner;
    const r = await this._runAction('trigger', () => this._simRequest('POST', '/scenario/trigger', body), t('Incident created in ServiceNow'), () => this._sim?.scenario?.request_key === dlg.key);
    if (r?.ok && r.result?.ok) {
      this._incDlg = null;
      this._timingOpen = false;
      this._select('scenario');
    } else {
      this._incDlg = {...dlg, error: this._simMsg?.text};
    }
  }

  /* ------------------------------------------------------- V5: Race Control menu, restrictions, approvals, follow */

  async _restriction(status, opts = {}) {
    const okText = status === 'amber' ? t('AMBER CAUTION confirmed by ServiceNow') : status === 'red' ? t('Red flag requested. Not in force until approved') : t('Request recorded in ServiceNow');
    return this._runAction(`rs-${status}`, () => this._simRequest('POST', '/restriction/request', {status, reason: opts.reason || undefined, responseMode: opts.responseMode}), okText);
  }

  async _confirmRed() {
    const d = this._rfDlg;
    if (!d) return;
    const r = await this._restriction('red', {reason: d.reason, responseMode: d.mode});
    if (r?.ok && r.result?.ok) {
      this._rfDlg = null;
      this._apprOpen = true;
    } else this._rfDlg = {...d, error: this._simMsg?.text};
  }

  async _resetDemo() {
    this._menuOpen = false;
    this._confirmDemo = false;
    this._follow = null;
    this._wxClose();
    const r = await this._runAction('demo-reset', () => this._simRequest('POST', '/demo/reset', {}), t('Demonstration reset: FP1 running'));
    if (r?.ok && r.result?.ok) {
      this._sel = null;
      this._timingOpen = false;
      this._incDlg = null;
      this._rfDlg = null;
      this._apprOpen = false;
      this._animateTo(this._fitView, 900);
      this._loadSn();
    }
  }

  _followVehicle(vid) {
    this._select(`veh-${vid}`);
  }

  _renderFollowChip() {
    const fid = this._follow;
    if (!fid) return nothing;
    const v = fid.startsWith('veh-') ? this._sim?.vehicles.find(x => x.sys_id === fid.slice(4)) : null;
    const r = fid.startsWith('resp-') ? this._sim?.responses.find(x => x.sys_id === fid.slice(5)) : null;
    if (!v && !r) return nothing;
    return html`<div class=${classMap({followchip: true, low: !!this._sim?.scenario})} role="status"><span class="tdot" style=${`background:${v ? v.team_color : '#c97a0a'}`}></span><span>${t('FOLLOWING')} <b>${v ? v.abbreviation : r.label.split(' (')[0]}</b>${v ? ` · #${v.racing_number}` : ''}</span><button type="button" @click=${() => (this._follow = null)}>${t('Stop following')}</button></div>`;
  }

  _renderWeatherButton() {
    const wx = this._sim?.weather;
    const warn = !!wx?.warning;
    const f = wx?.forecast;
    const tip = warn ? fill(t('Weather warning: heavy rain {0}% in 60 min (simulated)'), f.probability_pct) : f ? t('Weather: forecast available') : t('Weather: no forecast stored');
    return html`<button class=${classMap({tbtn: true, 'wx-warnbtn': warn, 'wx-enter': !!this._wxEnter})} type="button" aria-label=${tip} aria-haspopup="dialog" aria-expanded=${String(this._wxOpen)} @click=${() => this._wxToggle()}>${icon('cloud', 18)}${warn ? html`<span class="wxdot" aria-hidden="true">${f.probability_pct}%</span>` : nothing}<span class="tip" aria-hidden="true">${tip}</span></button>`;
  }

  _renderOpsBar() {
    const sd = this._sim;
    if (!sd || !sd.canOperate) return nothing;
    const s = sd.session;
    const ts = s.track_status;
    const running = s.state === 'running';
    const crashWhy = sd.scenario ? t('An incident scenario is already active') : !running ? t('The session must be running') : ts !== 'green' ? t('The track must be green') : !sd.vehicles.some(v => v.state === 'on_track') ? t('No car is on track') : '';
    const pending = sd.decisions.filter(d => d.state === 'pending');
    const pendingRed = pending.some(d => d.type === 'red_flag');
    const pendingRestart = pending.some(d => d.type === 'restart');
    const busy = !!this._simBusy;
    const item = (label, fn, o = {}) => html`<button class=${classMap({mi: true, danger: o.danger})} type="button" ?disabled=${busy || o.disabled} @click=${() => {
      this._menuOpen = false;
      fn();
    }}><span>${label}</span>${o.hint ? html`<small>${o.hint}</small>` : nothing}</button>`;
    const clearsAmber = ts === 'amber' && !sd.scenario;
    const open = sd.blockers.filter(b => !String(b.key).startsWith('pending_')).length;
    const items = [];
    if (ts !== 'green') {
      items.push(item(clearsAmber ? t('Green · clear amber') : t('Green · request restart'), () => this._restriction('green'), {disabled: pendingRestart || (!clearsAmber && sd.blockers.length > 0), hint: pendingRestart ? t('Restart awaiting approval') : !clearsAmber && open ? fill(t('{0} recovery item(s) outstanding'), open) : !clearsAmber && sd.blockers.length ? t('A decision is awaiting approval') : !clearsAmber ? t('Needs approval') : ''}));
    }
    if (running && (ts === 'green' || ts === 'caution')) items.push(item(t('Request amber caution'), () => this._restriction('amber'), {hint: fill(t('Cars slow to {0}% and return to the pits'), Math.round((sd.restriction?.speed_multiplier || 0.45) * 100))}));
    if (running && ts !== 'red') items.push(item(t('Request red flag'), () => (this._rfDlg = {mode: 'pit', reason: ''}), {danger: true, disabled: pendingRed, hint: pendingRed ? t('Awaiting approval') : t('Needs approval')}));
    if (pending.length) items.push(item(`${t('View pending approvals')} (${pending.length})`, () => {
      this._apprOpen = true;
      this._evOpen = false;
    }));
    if (sd.scenario) items.push(item(t('Open active scenario'), () => this._select('scenario')));
    items.push(item(t('Simulate Weather Warning'), () => this._wxSimulate(), {disabled: !!sd.weather?.warning, hint: sd.weather?.warning ? t('A simulated warning is already active') : t('Fictional scenario. Does not change the track')}));
    const reset = this._confirmDemo
      ? html`<button class="mi danger" type="button" ?disabled=${busy} @click=${() => this._resetDemo()}><span>${t('Confirm: archive scenario and reset')}</span><small>${t('Restores FP1 running, three cars on track, five in the pits')}</small></button>`
      : html`<button class="mi" type="button" ?disabled=${busy} @click=${() => (this._confirmDemo = true)}><span>${t('Reset demo…')}</span></button>`;
    return html`<div class="opsbar">
      <button class="crashbtn" type="button" ?disabled=${!!crashWhy || busy} title=${crashWhy || t('Simulate a crash for a car')} @click=${() => this._openIncidentDialog()}>${t('Simulate crash')}</button>
      <div class="rcwrap">
        <button class="rcbtn" type="button" aria-haspopup="true" aria-expanded=${String(this._menuOpen)} @click=${() => {
          this._menuOpen = !this._menuOpen;
          this._confirmDemo = false;
          if (this._menuOpen) this._evOpen = false;
        }}>${t('Race Control')}${pending.length ? html`<span class="badge">${pending.length}</span>` : nothing}<span aria-hidden="true">▾</span></button>
        ${this._menuOpen
          ? html`<div class="rcmenu" role="group" aria-label=${t('Race Control actions')}>
              <div class="mhead"><span>${t('Track')}</span><b>${this._trackLabel(ts)}</b></div>
              ${items}
              <div class="msep"></div>
              ${reset}
            </div>`
          : nothing}
      </div>
    </div>`;
  }

  _renderApprovals() {
    const sd = this._sim;
    if (!this._apprOpen || !sd) return nothing;
    const pending = sd.decisions.filter(d => d.state === 'pending');
    const modeTxt = m => (m === 'freeze' ? t('Immediate simulation freeze') : m === 'pit' ? t('Slow and proceed to pits') : '');
    return html`<section class="apprcard" aria-label=${t('Pending approvals')}>
      <header><span class="eyebrow" style="margin:0">${t('Pending approvals')}</span><button class="xs" type="button" @click=${() => (this._apprOpen = false)} aria-label=${t('Close approvals')}>${icon('close', 14)}</button></header>
      ${pending.length
        ? html`<ul>${pending.map(
            d => html`<li>
              <div class="row2"><a class="rec-link" href=${this._recordLink(DEC_TABLE, d.sys_id)} target="_blank" rel="noopener noreferrer">${d.number}</a><b>${t(DEC_LABEL[d.type] || d.type)}</b></div>
              <span class="mut">${d.reason}${d.response_mode ? ` · ${modeTxt(d.response_mode)}` : ''}</span>
              <span class="mut">${t('Requested by')} ${d.requested_by} · ${t('approver')} ${d.approval?.approver || '—'}</span>
              ${d.can_decide
                ? html`<div class="row2"><button class="act primary sm" type="button" ?disabled=${!!this._simBusy} @click=${() => this._scnPost(`/decision/${d.sys_id}/decide`, {outcome: 'approve'}, t('Approval recorded in ServiceNow'), `a${d.sys_id}`)}>${t('Approve')}</button><button class="act sm" type="button" ?disabled=${!!this._simBusy} @click=${() => this._scnPost(`/decision/${d.sys_id}/decide`, {outcome: 'reject'}, t('Rejection recorded in ServiceNow'), `r${d.sys_id}`)}>${t('Reject')}</button></div>`
                : html`<span class="mut">${t('Waiting for the designated approver')}</span>`}
            </li>`
          )}</ul>`
        : html`<p class="note" style="padding:6px 2px">${t('Nothing is waiting for approval.')}</p>`}
      ${this._simMsg ? html`<p class=${classMap({simmsg: true, bad: !this._simMsg.ok})} role="status">${this._simMsg.text}</p>` : nothing}
    </section>`;
  }

  _renderRedDialog() {
    const d = this._rfDlg;
    if (!d) return nothing;
    return html`<button class="scrim" type="button" tabindex="-1" aria-label=${t('Close dialog')} @click=${() => (this._rfDlg = null)}></button>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="red-h">
        <p class="eyebrow" style="margin:0 0 4px">${t('Race control decision')}</p>
        <h2 id="red-h" class="mtitle">${t('Request red flag')}</h2>
        <p class="note">${t('A red flag suspends the session. It only takes effect after the designated approver approves it in ServiceNow. Until then the track status does not change.')}</p>
        <fieldset class="opts">
          <legend>${t('Response mode')}</legend>
          <label class="radio"><input type="radio" name="rm" .checked=${d.mode === 'pit'} @change=${() => (this._rfDlg = {...d, mode: 'pit'})} />
            <span><b>${t('Slow and proceed to pits')}</b><small>${t('Standard: cars slow down and return to the pit lane. Pit exit stays blocked.')}</small></span></label>
          <label class="radio"><input type="radio" name="rm" .checked=${d.mode === 'freeze'} @change=${() => (this._rfDlg = {...d, mode: 'freeze'})} />
            <span><b>${t('Immediate simulation freeze')}</b><small>${t('Demo mode: every car stops where it is. The frozen positions are stored in ServiceNow, so every viewer sees the same.')}</small></span></label>
        </fieldset>
        <label class="sel"><span>${t('Reason')}</span><input type="text" class="txt" maxlength="200" .value=${d.reason} placeholder=${t('Vehicle immobilised, recovery required')} @input=${e => (this._rfDlg = {...d, reason: e.target.value})} /></label>
        ${d.error ? html`<p class="note bad">${d.error}</p>` : nothing}
        <div class="actions">
          <button class="act primary" type="button" ?disabled=${!!this._simBusy} @click=${() => this._confirmRed()}>${this._simBusy === 'rs-red' ? t('Working…') : t('Submit for approval')}</button>
          <button class="act" type="button" @click=${() => (this._rfDlg = null)}>${t('Cancel')}</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------- Now Assist bridge */

  _flashCrash() {
    this._crashFlash = Date.now();
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => (this._crashFlash = 0), 3300);
  }

  _panelW() {
    return Math.min(this._sel === 'scenario' ? 560 : PANEL_W, Math.round(this._SW * 0.46));
  }

  /**
   * What the Now Assist conversation can read. The platform feeds this shared context to the model on every turn
   * (tool results are not returned to the model in the same turn), so it carries the facts the user may ask about.
   * Every value comes from ServiceNow records already loaded by the page.
   */
  _pushAiContext() {
    const sd = this._sim;
    if (!sd || !this.setAiContext) return;
    const rs = sd.restriction;
    const ms = this._sessionMs();
    const lbl = {parked: 'in the pits', entering: 'entering the pits', approaching: 'returning to the pits', leaving: 'leaving the pits', track: 'on track', crashing: 'stopping after a crash', stopped: 'stopped (incident)', retired: 'retired'};
    const cars = sd.vehicles.map(v => ({v, ph: phaseOf(v, ms)}));
    const ctx = {
      session: sd.session.session_label,
      sessionState: sd.session.state,
      trackStatus: sd.session.track_status,
      requestedRestriction: rs?.state === 'pending' ? `${rs.requested} (awaiting approval, not in force)` : null,
      restrictionResponseMode: rs?.response_mode || null,
      carsOnTrack: cars.filter(x => ['track', 'approaching', 'leaving'].includes(x.ph)).map(x => x.v.abbreviation),
      carsInPits: cars.filter(x => ['parked', 'entering'].includes(x.ph)).map(x => x.v.abbreviation),
      vehicles: cars.map(x => `${x.v.abbreviation} #${x.v.racing_number} ${x.v.driver_name} (${x.v.team}): ${lbl[x.ph] || x.v.state}`),
      openIncidents: this._currentEvents().map(e => `${e.number} P${e.priority} ${e.state} at ${e.location || 'circuit'}: ${e.desc}`),
      activeCrashScenario: sd.scenario ? `${sd.scenario.incident_number} at ${sd.scenario.corner_name}` : null,
      responseTasks: sd.tasks.map(x => `${x.number} ${x.label}: ${x.state}`),
      restartBlockers: sd.blockers.map(b => b.label),
      pendingApprovals: sd.decisions.filter(d => d.state === 'pending').map(d => `${d.number} ${d.type} requested by ${d.requested_by}, approver ${d.approval?.approver || 'n/a'}`),
      weather: this._aiWeather(sd.weather),
      lastToolOutcome: this._lastTool ? `${this._lastTool.tool} ${this._lastTool.ok ? 'CONFIRMED by ServiceNow' : 'FAILED'}${this._lastTool.error ? `: ${this._lastTool.error}` : ''}${this._lastTool.records.length ? ` (records ${this._lastTool.records.join(', ')})` : ''}${this._lastTool.note ? `. ${this._lastTool.note}` : ''}` : null
    };
    const sig = JSON.stringify(ctx);
    if (sig === this._aiSig) return;
    this._aiSig = sig;
    this.setAiContext(ctx);
  }

  _aiWeather(wx) {
    if (!wx?.forecast) return 'No weather forecast is stored in ServiceNow';
    const f = wx.forecast;
    return {
      source: `${f.source_name}${f.simulated ? ' (SIMULATED scenario, not a real forecast)' : ''}`,
      forecast: `${f.probability_pct}% chance of more than ${f.threshold_mm} mm in 60 min, expected ${f.expected_mm} mm, onset about ${f.onset_min} min, peak ${f.peak_from_min}-${f.peak_to_min} min`,
      warning: wx.warning ? `${wx.warning.number} ${wx.warning.severity}; track status stays ${this._sim.session.track_status} (a warning does not change it)` : 'none',
      stages: wx.stages.map(x => `${x.label}: ${x.done ? 'yes' : 'no'}`),
      tasks: wx.tasks.map(x => `${x.number} ${x.label} (${x.group}): ${x.state}`),
      announcement: wx.communication ? `${wx.communication.number} ${wx.communication.state}, delivery ${wx.communication.delivery_state === 'simulated_delivered' ? 'SIMULATED only' : 'not delivered'}` : 'none'
    };
  }

  /** Called by the Now Assist client tools. Runs the governed server operation; the server decides, this only presents the result. */
  async _aiTool(name, args) {
    const res = await this._aiToolRun(name, args);
    // Same-turn feedback: the platform does not return a client tool's result to the model within the same turn
    // (see aiel-utils/execute-action-client-tool in @servicenow/aiux). The confirmed outcome is therefore also published in the
    // shared widget context, which the model reads on its next turn. It is the real result, never a prediction.
    try {
      this._lastTool = {tool: name, at: new Date().toISOString(), ok: !!res?.ok, error: res?.error || null, note: res?.note || null, records: JSON.stringify(res ?? {}).match(/(TASK|INC|RCD|RCW)\d{5,}/g)?.slice(0, 12) || []};
      this._pushAiContext();
    } catch {
      /* context is best effort */
    }
    return res;
  }

  async _aiToolRun(name, args) {
    if (name === 'FocusMapLocation') {
      const ok = this._aiFocus(String(args.target || ''), String(args.follow) === 'true');
      return {ok, tool: name, message: ok ? 'Map updated' : 'Target not found on the map'};
    }
    const r = await this._simRequest('POST', '/ai/tool', {tool: name, args});
    const res = r.result;
    if (!res) return {ok: false, status: r.status, error: 'The Race Control service did not respond'};
    const isState = res.session && typeof res.session === 'object' && Array.isArray(res.vehicles);
    if (isState) this._applySim(res, r.t0, r.t1);
    else if (r.ok) this._loadSim();
    if (res.scenario && name === 'CreateIncidentScenario') this._select('scenario');
    if (!isState) return res;
    // state-bearing replies are summarised; the full record stays in ServiceNow
    return {ok: res.ok, tool: name, error: res.error, note: res.note, blockers: res.blockers, track_status: res.session.track_status, session_state: res.session.state, restriction: res.restriction, pending_approvals: (res.pendingApprovals || []).map(d => ({number: d.number, type: d.type, reason: d.reason, approver: d.approval?.approver})), incident: res.scenario ? res.scenario.incident_number : null};
  }

  _aiFocus(target, follow) {
    const sd = this._sim;
    if (/overview|full circuit|whole circuit|entire circuit|fit|reset (the )?(view|map|camera)/i.test(target)) {
      this._follow = null;
      this._evOpen = false;
      this._backToOverview();
      return true;
    }
    if (/incident|event/i.test(target) && !/^incident$/i.test(target.trim())) {
      // presentation only: open the Events list (current, unresolved events)
      this._menuOpen = false;
      this._evOpen = true;
      return true;
    }
    const key = target.toUpperCase().replace('#', '');
    const v = sd?.vehicles.find(x => x.abbreviation === key || String(x.racing_number) === key);
    if (v) {
      if (follow) this._followVehicle(v.sys_id);
      else this._select(`veh-${v.sys_id}`);
      return true;
    }
    if (/^incident/i.test(target) && sd?.scenario) {
      this._select('scenario');
      return true;
    }
    const f = Object.values(this._all()).find(x => x.name && String(x.name).toLowerCase() === target.toLowerCase());
    if (f) {
      this._select(f.id);
      return true;
    }
    return false;
  }

  /** Floating contextual card: rendered only while something is selected. */
  _renderCard() {
    const f = this._sel ? this._all()[this._sel] : null;
    if (!f) return nothing;
    if (f.kind === 'scenario') return this._renderScenarioCard();
    if (f.kind === 'response') return this._renderResponseCard(f);
    if (f.vid) return this._renderVehicleCard(f);
    if (f.kind === 'incident') return this._renderIncidentCard(f);
    if (f.kind === 'ci') return this._renderCiCard(f);
    const {facts, note} = describe(f);
    return html`<aside class="card" aria-label=${t('Location detail')}>
      <button class="x" @click=${() => this._backToOverview()} aria-label=${t('Close and return to overview')}>${icon('close', 18)}</button>
      <h2 class="title">${f.name}</h2>
      <p class="kind">${kindLabel(f.kind)}</p>
      <dl>
        ${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
      </dl>
      <div class="rule"></div>
      ${this._renderSnSection(f)}
      <div class="rule"></div>
      <p class="note">${note}</p>
      <div class="actions">
        <button class="act" type="button" @click=${() => this._focusOn(f)}>${t('Focus')}</button>
        <button class="act" type="button" @click=${() => this._backToOverview()}>${t('Back to overview')}</button>
      </div>
    </aside>`;
  }

  /** Compact live activity feed, derived from the ServiceNow audit trail and record creation times. */
  _renderFeed() {
    const evs = this._allEvents();
    const label = {created: t('Created'), priority: t('Priority'), assigned: t('Assignment'), resolved: t('Resolved'), state: t('State'), ci: t('CI status')};
    return html`<div class="feed">
      ${this._feedOpen
        ? html`<section class="feedcard" aria-label=${t('Live activity')}>
            <header><span class="eyebrow" style="margin:0">${t('Live activity')}</span><button class="xs" type="button" @click=${() => (this._feedOpen = false)} aria-label=${t('Collapse activity')}>${icon('close', 14)}</button></header>
            ${evs.length
              ? html`<ul>
                  ${evs.slice(0, 14).map(
                    e => html`<li class=${`ev ${e.kind}`}>
                      <span class="evd"></span>
                      <div>
                        <div class="evt"><button class="lnk" type="button" @click=${() => (this._all()[`inc-${e.sysId}`] ? this._select(`inc-${e.sysId}`) : window.open(this._recordLink(e.table, e.sysId), '_blank', 'noopener'))}>${e.ref}</button> · ${e.text}</div>
                        <div class="evm">${label[e.kind] || ''} · <time datetime=${e.ts} title=${this._fmtTime(e.ts)}>${this._ago(e.ts)}</time>${e.by ? ` · ${e.by}` : ''}</div>
                      </div>
                    </li>`
                  )}
                </ul>`
              : html`<p class="note">${t('No recorded activity yet.')}</p>`}
            <p class="foot">${this._auditState && this._auditState !== 'ok' && this._auditState !== 'n/a' ? fill(t('Audit trail {0}. Showing creation events only.'), this._auditState) : t('From the ServiceNow audit trail.')}</p>
          </section>`
        : nothing}
      <button class="feedbtn" type="button" aria-expanded=${String(this._feedOpen)} @click=${() => {
        this._feedOpen = !this._feedOpen;
        if (this._feedOpen) this._timingOpen = false;
      }}>
        <span>${t('Activity')}</span>${evs.length ? html`<b>${Math.min(evs.length, 99)}</b>` : nothing}
      </button>
    </div>`;
  }

  _renderToast() {
    const tt = this._toast;
    if (!tt) return nothing;
    return html`<div class=${classMap({toast: true, low: !!this._sim?.scenario})} role="status" key=${tt.key}><span class=${`evd ${tt.kind}`}></span><div><b>${tt.ref}</b> · ${tt.text}</div></div>`;
  }

  /** Secondary panel: data sources, coverage and configuration notes. Closed by default. */
  _renderDiagnostics() {
    if (!this._diagOpen) return nothing;
    const sn = this._sn;
    const s = this._assoc.stats;
    const ready = sn.state === 'ready';
    const row = (label, value, linked) => html`<div class="cov"><span class=${classMap({pip: true, on: linked})}></span><span class="lbl2">${label}</span><span class="val">${value}</span></div>`;
    const placed = n => (ready ? (n ? fill(t('{0} placed'), n) : t('Not configured')) : '—');
    const osmLink = (mapped, linked) => (ready ? fill(t('{0} mapped · {1} linked'), mapped, linked) : '—');
    const link = this._linkStatus();
    const synced = this._syncedAt ? new Intl.DateTimeFormat(undefined, {timeStyle: 'medium'}).format(this._syncedAt) : '—';
    return html`<aside class="card wide" aria-label=${t('Data sources and diagnostics')}>
      <button class="x" @click=${() => (this._diagOpen = false)} aria-label=${t('Close diagnostics')}>${icon('close', 18)}</button>
      <h2 class="title">${t('Data sources')}</h2>
      <p class="kind">${t('Diagnostics')}</p>
      <dl>
        <dt>${t('ServiceNow')}</dt><dd>${link.v}</dd>
        <dt>${t('Refresh')}</dt><dd>${fill(t('Change check every {0} s'), SN_CONFIG.pollMs / 1000)}</dd>
        <dt>${t('Last full read')}</dt><dd>${synced}</dd>
        <dt>${t('Open events')}</dt><dd>${ready ? s.incidents + s.alerts : '—'}</dd>
        <dt>${t('Circuit geometry')}</dt><dd>${t('OpenStreetMap, static')}</dd>
        <dt>${t('Session records')}</dt><dd>${t('Not configured')}</dd>
        <dt>${t('Weather source')}</dt><dd>${t('Not configured')}</dd>
        <dt>${t('Simulation')}</dt><dd>${this._sim ? fill(t('{0} · {1} vehicle records'), this._sim.session.name, this._sim.vehicles.length) : t('No session record')}</dd>
        <dt>${t('Track status')}</dt><dd>${this._sim ? this._sim.session.track_status : '—'}</dd>
        <dt>${t('Time scale')}</dt><dd>${this._sim ? `×${this._sim.session.time_scale}` : '—'}</dd>
      </dl>
      <div class="rule"></div>
      <p class="eyebrow">${t('Venue records read')}</p>
      <dl>
        <dt>${t('Locations')}</dt><dd>${ready ? s.locations : '—'}</dd>
        <dt>${t('Configuration items')}</dt><dd>${ready ? s.cis : '—'}</dd>
        <dt>${t('Open tasks')}</dt><dd>${ready ? s.tasks : '—'}</dd>
        <dt>${t('Response groups')}</dt><dd>${ready ? s.teams : '—'}</dd>
      </dl>
      ${ready && sn.teams.length
        ? html`<ul class="recs" style="margin-top:8px">${sn.teams.map(g => html`<li><a class="rec-link" href=${this._recordLink('sys_user_group', g.sysId)} target="_blank" rel="noopener noreferrer">${g.name}</a></li>`)}</ul>
            <p class="note" style="margin-top:6px">${t('A group existing does not mean a team is deployed. No staffing is modelled.')}</p>`
        : nothing}
      <div class="rule"></div>
      <p class="eyebrow">${t('Facility coverage')}</p>
      ${row(t('Pit garages'), placed(s.pitGarages), s.pitGarages > 0)}
      ${row(t('Race control tower'), placed(s.raceControl), s.raceControl > 0)}
      ${row(t('Paddock facilities'), ready ? fill(t('{0} mapped · {1} linked'), OSM_MAIN, s.paddock) : '—', s.paddock > 0)}
      ${row(t('Grandstands'), osmLink(OSM_STANDS, s.grandstands), s.grandstands > 0)}
      ${row(t('Medical centre'), placed(s.medical), s.medical > 0)}
      ${row(t('Marshal posts'), placed(s.marshals), s.marshals > 0)}
      ${row(t('Emergency access gates'), osmLink(OSM_GATES, s.gates), s.gates > 0)}
      ${row(t('Track sectors'), placed(s.sectors), s.sectors > 0)}
      ${row(t('Cameras, Wi-Fi and other CIs'), ready ? (s.cis ? fill(t('{0} located'), s.cis) : t('None located')) : '—', s.cis > 0)}
      <p class="note" style="margin-top:8px">${ready && !s.locations
        ? t('No cmn_location records for Paul Ricard exist on this instance yet. Markers appear automatically once locations with coordinates are created.')
        : ready
          ? fill(t('{0} venue locations read, {1} containers, {2} without usable coordinates.'), s.locations, s.containers, s.unplaced)
          : t('Waiting for ServiceNow.')}</p>
      <div class="rule"></div>
      <p class="eyebrow">${t('Marker types')}</p>
      <div class="legend">
        ${MARKER_LEGEND.map(([k, label]) => html`<div><svg width="18" height="18" viewBox="-10 -10 20 20" aria-hidden="true"><circle r="9" fill="#fff" stroke="#6b7580" stroke-width="1.6"></circle><path d=${MARKER_GLYPH[k]} fill="none" stroke="#232b34" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>${t(label)}</div>`)}
      </div>
      <div class="legend" style="margin-top:10px">
        ${SEV_LEGEND.map(([k, label]) => html`<div><span class="sw" style=${`background:${SEV[k]}`}></span>${t(label)}</div>`)}
      </div>
      <p class="note" style="margin-top:8px">${t('Dashed rings mark representative (simulated) positions. Solid rings are verified or record-based.')}</p>
    </aside>`;
  }

  _renderControls() {
    const btn = (name, label, onClick, extra = {}) => html`<button
      class="btn"
      type="button"
      aria-label=${label}
      aria-expanded=${extra.expanded === undefined ? nothing : String(extra.expanded)}
      ?disabled=${extra.disabled}
      @click=${onClick}
    >${icon(name)}<span class="tip" aria-hidden="true">${extra.tip || label}</span></button>`;
    return html`<div class="controls">
      ${this._layersOpen
        ? html`<div class="popover" role="dialog" aria-label=${t('Layers')}>
            <p class="eyebrow">${t('Operational layers')}</p>
            ${OPS_LAYERS.map(
              l => html`<label class="toggle two"><input type="checkbox" .checked=${this._layers[l.id]} aria-describedby=${`ls-${l.id}`} @change=${e => this._toggleLayer(l.id, e.target.checked)} /><span class="tl"><span>${t(l.label)}</span><small id=${`ls-${l.id}`}>${this._layerStatus(l.id)}</small></span></label>`
            )}
            <details class="base">
              <summary>${t('Base map')}</summary>
              ${BASE_LAYERS.map(
                l => html`<label class="toggle"><input type="checkbox" .checked=${this._layers[l.id]} @change=${e => this._toggleLayer(l.id, e.target.checked)} /><span>${t(l.label)}</span></label>`
              )}
            </details>
            <p class="foot">${t('Layer switches only change what you see. They never modify records.')}</p>
          </div>`
        : nothing}
      <div class="cluster" role="group" aria-label=${t('Map controls')}>
        ${btn('plus', t('Zoom in'), () => this._zoomBtn(1.6))}
        ${btn('minus', t('Zoom out'), () => this._zoomBtn(1 / 1.6))}
        ${btn('fit', t('Fit entire circuit'), () => this._fitAll())}
        ${btn('back', t('Back to overview'), () => this._backToOverview(), {disabled: this._atOv && !this._sel})}
      </div>
      <div class="cluster" role="group" aria-label=${t('Map options')}>
        ${btn('layers', t('Layers'), () => {
          this._layersOpen = !this._layersOpen;
          if (this._layersOpen) this._diagOpen = false;
        }, {expanded: this._layersOpen})}
      </div>
      <div class="credit">${t('Geometry © OpenStreetMap contributors (ODbL), static. Building heights are stylised.')}</div>
    </div>`;
  }

  _renderSessionChips() {
    const sd = this._sim;
    if (!sd) {
      return html`<div class="status" role="status"><span class="sdot amber"></span><span class="k">${t('Session')}</span><span class="v">${this._simOk ? t('Unconfigured') : t('Unavailable')}</span></div>`;
    }
    const s = sd.session;
    const c = this._simCounts();
    const cls = s.state === 'running' ? 'ok' : s.state === 'suspended' ? 'crit' : s.state === 'paused' ? 'warn' : s.state === 'completed' ? '' : 'amber';
    const ts = s.track_status;
    const rs = sd.restriction;
    const trackTxt = ts === 'caution' ? `${this._trackLabel(ts)}${sd.scenario ? ` · S${sd.scenario.sector_number}` : ''}` : this._trackLabel(ts);
    const sub = ts === 'red' && rs?.response_mode ? (rs.response_mode === 'freeze' ? t('FREEZE') : t('TO PITS')) : '';
    const pendingRed = rs?.state === 'pending' && rs.requested === 'red';
    const tcls = ts === 'red' ? 'crit' : ts === 'caution' || ts === 'amber' ? 'warn' : 'ok';
    return html`<div class="status chip-session" role="status" title=${t('Session state from the ServiceNow session record')}><span class=${`sdot ${cls}`}></span><span class="k">${t('Session')}</span><span class="v">${s.session_label} · ${s.state}</span></div>
      <div class=${classMap({status: true, trackchip: true, redchip: ts === 'red', amberchip: ts === 'amber'})} role="status" title=${t('Effective track status from the ServiceNow session record')}><span class=${`sdot ${tcls}`}></span><span class="k">${t('Track')}</span><span class="v">${trackTxt}${sub ? ` · ${sub}` : ''}</span>${pendingRed ? html`<span class="pendtag" title=${t('A red flag has been requested and is waiting for approval. It is not in force.')}>${t('RED REQUESTED')}</span>` : nothing}</div>
      <div class="status chip-cars" role="status" title=${t('Vehicle states from ServiceNow, with pit transitions resolved against the session clock')}><span class="k">${t('Cars')}</span><span class="v">${c.on} ${t('on track')} · ${c.pits} ${t('in pits')}${c.stopped ? ` · ${c.stopped} ${t('stopped')}` : ''}</span></div>`;
  }

  _linkStatus() {
    const sn = this._sn;
    if (sn.state === 'loading') return {cls: '', v: t('Connecting')};
    if (sn.state === 'error' || !this._linkOk) return {cls: 'warn', v: t('Unavailable')};
    const n = sn.locations.length;
    return {cls: 'ok', v: n ? t('Connected') : t('Connected · no circuit records')};
  }

  /** The current, unresolved events that are placed on the map. Archived scenario incidents are closed in ServiceNow, so never counted. */
  _currentEvents() {
    const out = [];
    Object.values(this._assoc.records || {}).forEach(f => {
      if (f.kind !== 'incident' || f.rec.resolved) return;
      const i = f.rec;
      out.push({key: f.id, kind: 'incident', number: i.number, desc: i.desc, priority: i.priority || 9, state: i.state, location: i.location, sysId: i.sysId, scenario: this._sim?.scenario?.incident === i.sysId});
    });
    Object.entries(this._assoc.bundles || {}).forEach(([fid, b]) => {
      (b.alerts || []).forEach(a => out.push({key: fid, kind: 'alert', number: a.number, desc: a.desc, priority: a.severity || 9, state: a.state, location: this._all()[fid]?.name || '', sysId: a.sysId, scenario: false}));
    });
    return out.sort((a, b) => a.priority - b.priority || (a.number < b.number ? -1 : 1));
  }

  _eventsStatus() {
    const sn = this._sn;
    if (sn.state !== 'ready' || !sn.locations.length) return {cls: '', v: '—', n: 0};
    const list = this._currentEvents();
    const crit = list.some(e => e.priority === 1);
    return {cls: list.length ? (crit ? 'crit' : 'warn') : 'ok', v: String(list.length), n: list.length};
  }

  _openEvent(e) {
    this._evOpen = false;
    this._select(e.scenario ? 'scenario' : e.key);
  }

  _renderEventsPanel() {
    if (!this._evOpen) return nothing;
    const list = this._currentEvents();
    const pcls = p => (p === 1 ? 'crit' : p === 2 ? 'warnc' : 'low');
    return html`<section class="evpanel" aria-label=${t('Current events')}>
      <header><span class="eyebrow" style="margin:0">${t('Current events')}</span><button class="xs" type="button" @click=${() => (this._evOpen = false)} aria-label=${t('Close events')}>${icon('close', 14)}</button></header>
      ${list.length
        ? html`<ul>${list.map(
            e => html`<li><button type="button" class=${`evrow ${pcls(e.priority)}`} @click=${() => this._openEvent(e)} aria-label=${`${e.number}, ${e.desc}`}>
              <span class="evd"></span>
              <span class="evb"><span class="evh"><b>${e.number}</b><span class="evp">${e.kind === 'alert' ? t('Alert') : 'P'}${e.priority < 9 ? e.priority : ''}</span><span class="evs">${e.state}</span></span>
              <span class="evt2">${e.desc}</span>
              <span class="evl">${e.location || '—'}${e.scenario ? ` · ${t('Simulation')}` : ''}</span></span>
            </button></li>`
          )}</ul>`
        : html`<p class="note" style="padding:6px 2px">${t('No open events.')}</p>`}
      <p class="foot">${t('Open incidents and alerts placed on the map. Resolved and archived simulation incidents are not counted.')}</p>
    </section>`;
  }

  render() {
    const {ground, elevated} = this._scene();
    const off = Object.entries(this._layers)
      .filter(([, on]) => !on)
      .flatMap(([id]) => (id === 'facilities' ? ['layers-off-buildings', 'layers-off-pit'] : [`layers-off-${id}`]));
    const rootCls = ['map', `tier-${this._tier}`, this._dragging ? 'dragging' : '', ...off].filter(Boolean).join(' ');
    const stageStyle = `width: ${this._SW}px; height: ${this._SH}px; transform: translate(${this._offX || 0}px, ${this._offY || 0}px) scale(${this._scale})`;
    const grain = this._noise ? `background-image:url(${this._noise})` : '';
    const link = this._linkStatus();
    const ev = this._eventsStatus();
    return html`
      <div class="stage" style=${stageStyle}>
        <svg
          class=${rootCls}
          viewBox="0 0 ${this._SW} ${this._SH}"
          role="group"
          tabindex="0"
          aria-label=${t('Circuit Paul Ricard interactive map')}
          aria-describedby="rc-help"
          @wheel=${this._onWheel}
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}
          @click=${this._onMapClick}
          @keydown=${this._onKey}
        >
          <defs>${unsafeSVG(defsMarkup(this._noise))}</defs>
          <rect width=${this._SW} height=${this._SH} fill="#e9dfc8"></rect>
          <g class="view">
            <g transform=${`scale(1 ${GROUND_Y})`}>
              ${unsafeSVG(ground)}
              <path id="rc-centreline" d=${CENTRELINE_D} fill="none" stroke="none"></path>
              <g id="rc-hit-lines">${this._renderLines()}</g>
              ${this._renderRestrictions()}
            </g>
            ${unsafeSVG(elevated)}
            <g id="rc-hit-buildings">${this._renderBuildingHits()}</g>
            <g id="rc-selection">${this._renderSelection()}</g>
            ${this._renderSignals()}
            <g id="rc-vehicles" data-slot="vehicles">${this._renderPitCluster()}${this._renderCars(false)}${this._renderScenarioMarkers()}${this._renderCars(true)}${this._renderCarLabel()}</g>
            <g data-layer="names">${this._renderLabels()}</g>
            <g id="rc-markers">${this._renderMarkers()}</g>
            <g id="rc-ops" data-slot="servicenow-markers">${this._renderOps()}</g>
          </g>
        </svg>
        <p id="rc-help" class="sr-only">${t('Use arrow keys to pan, plus and minus to zoom, zero to fit the whole circuit, Escape to return to the overview, and Tab to move between locations.')}</p>
        ${this._crashFlash ? html`<div class="crashflash" aria-hidden="true"></div>` : nothing}
        <div class="sun"></div>
        <div class="grain" style=${grain}></div>

        <header class=${classMap({topbar: true, redflag: this._sim?.session.track_status === 'red'})}>
          <div class="brand">
            <div class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <div class="wordmark">${t('Race Control')}<b>360</b></div>
          </div>
          <div class="sep"></div>
          <div class="circuit">
            <span class="name">${t('Circuit Paul Ricard')}</span>
            <span class="loc">${t('Le Castellet · France')}</span>
          </div>
          <div class="spacer"></div>
          ${this._renderSessionChips()}
          <div class="status chip-link" role="status">
            <span class=${`sdot ${link.cls}`}></span>
            <span class="k">${t('ServiceNow')}</span>
            <span class="v">${link.v}</span>
          </div>
          <button class="status evbtn" type="button" aria-haspopup="dialog" aria-expanded=${String(this._evOpen)} title=${t('Show current events')} @click=${() => {
            this._evOpen = !this._evOpen;
            if (this._evOpen) {
              this._menuOpen = false;
              this._apprOpen = false;
            }
          }}>
            <span class=${`sdot ${ev.cls}`}></span>
            <span class="k">${t('Events')}</span>
            <span class="v">${ev.v}</span>
          </button>
          <button class="tbtn" type="button" aria-label=${t('Data sources and diagnostics')} aria-expanded=${String(this._diagOpen)} @click=${() => {
            this._diagOpen = !this._diagOpen;
            if (this._diagOpen) {
              this._sel = null;
              this._layersOpen = false;
            }
          }}>${icon('info', 18)}<span class="tip" aria-hidden="true">${t('Data sources')}</span></button>
          ${this._renderWeatherButton()}
          <button class="tbtn" type="button" aria-label=${this._immersive ? t('Exit full screen') : t('Enter full screen')} aria-pressed=${String(this._immersive)} @click=${() => this._setImmersive(!this._immersive)}>${icon(this._immersive ? 'minimise' : 'expand', 18)}<span class="tip" aria-hidden="true">${this._immersive ? t('Exit full screen (Esc)') : t('Immersive view')}</span></button>
        </header>

        ${this._renderControls()}
        ${this._renderOpsBar()}
        ${this._renderEventsPanel()}
        ${this._renderApprovals()}
        ${this._renderFollowChip()}
        ${this._renderCard()}
        ${this._renderDiagnostics()}
        ${renderWeatherPanel(this)}
        ${this._renderAlert()}
        ${this._renderToast()}
        ${this._renderTiming()}
        ${this._renderFeed()}
        ${this._renderIncidentDialog()}
        ${this._renderRedDialog()}
      </div>
    `;
  }
}
