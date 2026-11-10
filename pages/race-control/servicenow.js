/* ------------------------------------------------------------------ *
 * Race Control 360 — ServiceNow integration layer (read-only)
 *
 * WHAT THIS DOES
 *  - Reads cmn_location records that belong to Circuit Paul Ricard, the
 *    cmdb_ci records located there, and the open incidents / event alerts
 *    that reference them.
 *  - Places a record on the map ONLY when its cmn_location carries real
 *    latitude/longitude inside the circuit area. It is attached to an OSM
 *    facility when the point falls inside that footprint, otherwise it gets
 *    its own marker.
 *  - Never creates, guesses or defaults an identifier, status, position or
 *    count. Empty result = empty map layer.
 *
 * HOW TO CONNECT DATA (see SN_CONFIG)
 *  - Create a cmn_location tree whose name or full name contains "Paul Ricard"
 *    (or list sys_ids in SN_CONFIG.locationSysIds), with latitude/longitude.
 *  - Point cmdb_ci.location at those locations.
 *  - Optionally map an OSM facility id to a location with SN_CONFIG.facilityLinks.
 * ------------------------------------------------------------------ */
import {FACILITIES, META, project} from './scene.js';
import {pointAt, nearestOnLoop} from './vehicles.js';

export const SN_CONFIG = {
  /** Encoded query selecting Paul Ricard locations in cmn_location. */
  locationQuery: 'correlation_idSTARTSWITHrc360:^ORnameLIKEPaul Ricard^ORfull_nameLIKEPaul Ricard^ORfull_nameLIKELe Castellet',
  /** Extra cmn_location sys_ids to include regardless of name. */
  locationSysIds: [],
  /** OSM facility id (e.g. 'bld-158903945') -> cmn_location sys_id. Used when a location has no coordinates. */
  facilityLinks: {},
  /** Vehicle source. null = not configured. See loadVehicles() for the shape. */
  vehicles: null,
  /** Not yet connected: no table exists on this instance for these. */
  trackRestrictions: null,
  weather: null,
  /** Change-detection heartbeat (4 tiny requests). A full reload only happens when something changed. */
  pollMs: 3000,
  /** Safety full reload even if the heartbeat saw nothing. */
  refreshMs: 60000
};

const LAT0 = META.origin[0];
const LON0 = META.origin[1];
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110574;
/** Plausible window around the circuit for a coordinate to be trusted. */
const LAT_RANGE = [43.22, 43.28];
const LON_RANGE = [5.74, 5.83];

const val = x => (x && typeof x === 'object' ? x.value ?? '' : x ?? '');
const disp = x => (x && typeof x === 'object' ? x.display_value || x.value || '' : x ?? '');

async function getTable(fetchJson, table, query, fields, limit = 500) {
  const p = new URLSearchParams({
    sysparm_query: query,
    sysparm_fields: fields,
    sysparm_limit: String(limit),
    sysparm_display_value: 'all',
    sysparm_exclude_reference_link: 'true'
  });
  return fetchJson(`/api/now/table/${table}?${p}`);
}

const chunk = (a, n) => {
  const o = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
};

/** Load everything. Each call is independent so one denied table does not hide the others. */
export async function loadOperationalData(fetchJson) {
  const out = {
    state: 'ready', // ready | error
    http: 0,
    locations: [],
    cis: [],
    incidents: [],
    alerts: [],
    tasks: [],
    teams: [],
    notes: [],
    loadedAt: new Date()
  };
  let q = SN_CONFIG.locationQuery;
  if (SN_CONFIG.locationSysIds.length) q += `^ORsys_idIN${SN_CONFIG.locationSysIds.join(',')}`;
  const loc = await getTable(
    fetchJson,
    'cmn_location',
    q,
    'sys_id,name,full_name,latitude,longitude,cmn_location_type,parent,correlation_id,cmn_location_source,managed_by_group',
    500
  );
  out.http = loc.status;
  if (!loc.ok) {
    out.state = 'error';
    return out;
  }
  out.locations = loc.rows.map(r => ({
    sysId: val(r.sys_id),
    name: disp(r.name) || disp(r.full_name),
    fullName: disp(r.full_name),
    lat: parseFloat(val(r.latitude)),
    lon: parseFloat(val(r.longitude)),
    type: disp(r.cmn_location_type),
    parentId: val(r.parent),
    corr: val(r.correlation_id),
    provenance: val(r.cmn_location_source),
    teamId: val(r.managed_by_group),
    team: disp(r.managed_by_group)
  }));
  const ids = out.locations.map(l => l.sysId);

  const teamsP = getTable(fetchJson, 'sys_user_group', 'active=true^descriptionLIKERace Control 360^ORnameLIKEPaul Ricard', 'sys_id,name,description', 100);
  if (!ids.length) {
    const t = await teamsP;
    out.teams = t.ok ? t.rows.map(r => ({sysId: val(r.sys_id), name: disp(r.name)})) : [];
    return out;
  }

  const idChunks = chunk(ids, 100);
  const ciRes = await Promise.all(
    idChunks.map(c =>
      getTable(
        fetchJson,
        'cmdb_ci',
        `locationIN${c.join(',')}`,
        'sys_id,name,sys_class_name,operational_status,install_status,location,short_description,support_group,sys_updated_on',
        500
      )
    )
  );
  ciRes.forEach(r => {
    if (!r.ok) out.notes.push(`cmdb_ci ${r.status}`);
    else
      r.rows.forEach(x =>
        out.cis.push({
          sysId: val(x.sys_id),
          name: disp(x.name),
          cls: val(x.sys_class_name),
          clsLabel: disp(x.sys_class_name),
          opStatus: disp(x.operational_status),
          opValue: val(x.operational_status),
          install: disp(x.install_status),
          locationId: val(x.location),
          group: disp(x.support_group),
          groupId: val(x.support_group),
          updated: val(x.sys_updated_on)
        })
      );
  });

  const ciIds = out.cis.map(c => c.sysId);
  const FIELDS = 'sys_id,number,short_description,description,priority,state,incident_state,location,cmdb_ci,category,assignment_group,assigned_to,impact,urgency,sys_created_on,sys_updated_on,resolved_at';
  // Venue incidents: tied to a venue location or CI through the real reference fields (not by name or distance).
  // Active ones, plus anything touched in the last 12 hours so a resolution stays visible as "resolved".
  const venue = 'location.correlation_idSTARTSWITHrc360:';
  const venueCi = 'cmdb_ci.correlation_idSTARTSWITHrc360:';
  const recent = '^sys_updated_onRELATIVEGE@hour@ago@12';
  const incQuery = `${venue}^active=true^NQ${venueCi}^active=true^NQ${venue}${recent}^NQ${venueCi}${recent}`;
  const incJobs = [getTable(fetchJson, 'incident', incQuery, FIELDS, 200)];
  // Non-venue locations that were matched by name (legacy discovery) are covered by the IN queries below.
  const legacy = ids.filter(id => !out.locations.find(l => l.sysId === id && l.corr.startsWith('rc360:')));
  chunk(legacy, 100).forEach(c => incJobs.push(getTable(fetchJson, 'incident', `active=true^locationIN${c.join(',')}`, FIELDS, 200)));
  const alertJobs = chunk(ciIds, 100).map(c =>
    getTable(fetchJson, 'em_alert', `state!=Closed^cmdb_ciIN${c.join(',')}`, 'sys_id,number,description,severity,state,cmdb_ci', 200)
  );
  const [incRes, alertRes, teams] = await Promise.all([Promise.all(incJobs), Promise.all(alertJobs), teamsP]);
  const seen = new Set();
  incRes.forEach(r => {
    if (!r.ok) out.notes.push(`incident ${r.status}`);
    else
      r.rows.forEach(x => {
        const id = val(x.sys_id);
        if (seen.has(id)) return;
        seen.add(id);
        const st = parseInt(val(x.incident_state) || val(x.state), 10) || 0;
        out.incidents.push({
          sysId: id,
          number: disp(x.number),
          desc: disp(x.short_description),
          detail: disp(x.description),
          priority: parseInt(val(x.priority), 10) || 0,
          priorityLabel: disp(x.priority),
          state: disp(x.incident_state) || disp(x.state),
          stateValue: st,
          resolved: st >= 6,
          category: disp(x.category),
          locationId: val(x.location),
          location: disp(x.location),
          ciId: val(x.cmdb_ci),
          ci: disp(x.cmdb_ci),
          group: disp(x.assignment_group),
          groupId: val(x.assignment_group),
          assignedTo: disp(x.assigned_to),
          created: val(x.sys_created_on),
          updated: val(x.sys_updated_on)
        });
      });
  });
  alertRes.forEach(r => {
    if (!r.ok) out.notes.push(`em_alert ${r.status}`);
    else
      r.rows.forEach(x =>
        out.alerts.push({
          sysId: val(x.sys_id),
          number: disp(x.number),
          desc: disp(x.description),
          severity: parseInt(val(x.severity), 10) || 0,
          severityLabel: disp(x.severity),
          state: disp(x.state),
          ciId: val(x.cmdb_ci)
        })
      );
  });
  // open tasks under the venue incidents
  const incIds = out.incidents.filter(i => !i.resolved).map(i => i.sysId);
  if (incIds.length) {
    const tr = await Promise.all(chunk(incIds, 100).map(c => getTable(fetchJson, 'incident_task', `active=true^incidentIN${c.join(',')}`, 'sys_id,number,short_description,state,assignment_group,incident', 200)));
    tr.forEach(r => {
      if (!r.ok) out.notes.push(`incident_task ${r.status}`);
      else
        r.rows.forEach(x =>
          out.tasks.push({sysId: val(x.sys_id), number: disp(x.number), desc: disp(x.short_description), state: disp(x.state), group: disp(x.assignment_group), incidentId: val(x.incident)})
        );
    });
  }
  out.teams = teams.ok ? teams.rows.map(r => ({sysId: val(r.sys_id), name: disp(r.name)})) : [];
  return out;
}

const INC_STATE = {1: 'New', 2: 'In Progress', 3: 'On Hold', 6: 'Resolved', 7: 'Closed', 8: 'Canceled'};
const OP_STATUS = {1: 'Operational', 2: 'Non-Operational', 3: 'Repair in Progress', 4: 'DR Standby', 5: 'Ready', 6: 'Retired'};

/**
 * Recent real changes, taken from the platform audit trail (sys_audit) plus record creation times.
 * Returns [] if the audit table is not readable by the current user; never fabricates entries.
 */
export async function loadActivity(fetchJson, data, groupNames = {}) {
  const incIds = data.incidents.map(i => i.sysId);
  const ciIds = data.cis.map(c => c.sysId);
  const events = [];
  data.incidents.forEach(i => events.push({id: `c-${i.sysId}`, ts: i.created, kind: 'created', table: 'incident', sysId: i.sysId, ref: i.number, text: i.desc}));
  if (!incIds.length && !ciIds.length) return {events, audit: 'n/a'};
  const f = 'sys_id,tablename,documentkey,fieldname,oldvalue,newvalue,sys_created_on,user';
  const since = '^sys_created_onRELATIVEGE@dayofweek@ago@3';
  const parts = [];
  if (incIds.length) parts.push(`tablename=incident^documentkeyIN${incIds.join(',')}^fieldnameINpriority,incident_state,assignment_group,assigned_to${since}`);
  if (ciIds.length) parts.push(`tablenameSTARTSWITHcmdb_ci^documentkeyIN${ciIds.join(',')}^fieldname=operational_status${since}`);
  const r = await getTable(fetchJson, 'sys_audit', `${parts.join('^NQ')}`, f, 60);
  if (!r.ok) return {events, audit: `unavailable (${r.status})`};
  const incBy = Object.fromEntries(data.incidents.map(i => [i.sysId, i]));
  const ciBy = Object.fromEntries(data.cis.map(c => [c.sysId, c]));
  r.rows.forEach(row => {
    const field = val(row.fieldname);
    const key = val(row.documentkey);
    const o = val(row.oldvalue);
    const n = val(row.newvalue);
    const base = {id: val(row.sys_id), ts: val(row.sys_created_on), by: disp(row.user)};
    const inc = incBy[key];
    const ci = ciBy[key];
    if (inc) {
      const rec = {...base, table: 'incident', sysId: key, ref: inc.number};
      if (field === 'priority') events.push({...rec, kind: 'priority', text: `Priority P${o || '?'} → P${n || '?'}`});
      else if (field === 'incident_state') events.push({...rec, kind: n >= 6 ? 'resolved' : 'state', text: `State ${INC_STATE[o] || o || '?'} → ${INC_STATE[n] || n || '?'}`});
      else if (field === 'assignment_group') events.push({...rec, kind: 'assigned', text: `Assigned to ${groupNames[n] || (n ? 'another group' : 'no group')}`});
      else if (field === 'assigned_to') events.push({...rec, kind: 'assigned', text: n ? 'Assigned to a user' : 'Unassigned from user'});
    } else if (ci) {
      events.push({...base, table: ci.cls || 'cmdb_ci', sysId: key, ref: ci.name, kind: 'ci', text: `Status ${OP_STATUS[o] || o || '?'} → ${OP_STATUS[n] || n || '?'}`});
    }
  });
  events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return {events: events.slice(0, 40), audit: 'ok'};
}

/**
 * Cheap change detection: newest sys_updated_on + total count for each venue table.
 * Four tiny requests; compare the returned signature to know if a full reload is needed.
 */
export async function heartbeat(fetchJson) {
  const q = (table, query) => {
    const p = new URLSearchParams({sysparm_query: `${query}^ORDERBYDESCsys_updated_on`, sysparm_fields: 'sys_updated_on', sysparm_limit: '1', sysparm_exclude_reference_link: 'true'});
    return fetchJson(`/api/now/table/${table}?${p}`);
  };
  const rs = await Promise.all([
    q('incident', 'location.correlation_idSTARTSWITHrc360:^NQcmdb_ci.correlation_idSTARTSWITHrc360:^NQcorrelation_idSTARTSWITHrc360:'),
    q('cmdb_ci', 'correlation_idSTARTSWITHrc360:'),
    q('cmn_location', 'correlation_idSTARTSWITHrc360:'),
    q('incident_task', 'incident.location.correlation_idSTARTSWITHrc360:')
  ]);
  if (rs.some(r => !r.ok)) return null;
  return rs.map(r => `${r.total ?? '?'}|${val(r.rows[0]?.sys_updated_on)}`).join(';');
}

/** Visual marker family for an incident, from its real category text. Falls back to IT. */
export function incidentKind(inc, ciClass = '') {
  if (/hvac|power_eq|ups|circuit_breaker/.test(ciClass)) return 'facilities';
  if (/_iot/.test(ciClass) && /gate|access|secur/i.test(`${inc.desc} ${inc.ci || ''}`)) return 'security';
  const c = `${inc.category || ''} ${inc.desc || ''}`;
  if (/secur/i.test(c)) return 'security';
  if (/emerg|medical|fire|injur|safety|ambulance/i.test(c)) return 'emergency';
  if (/facilit|building|hvac|power|water|cleaning/i.test(c)) return 'facilities';
  return 'it';
}

/* ---------------------------------------------------------------- association */
const KIND_RULES = [
  [/race\s*control|control\s*tower|tour\s*de\s*contr/i, 'race-control', 'facilities'],
  [/medical|m[ée]dic|infirm|\bhospital\b|\bclinic\b|ambulance/i, 'medical', 'emergency'],
  [/marshal|commissaire/i, 'marshal', 'emergency'],
  [/\bgate\b|portail|\bporte\b/i, 'gate-sn', 'emergency'],
  [/pit\s*garage|garage|\bboxes?\b|\bpit\b/i, 'pit-garage', 'facilities'],
  [/paddock|hospitality|village/i, 'paddock', 'facilities'],
  [/grand\s*stand|tribune/i, 'grandstand-sn', 'facilities']
];
export function classify(name) {
  for (const [re, kind, layer] of KIND_RULES) if (re.test(name)) return {kind, layer};
  return {kind: 'sn-location', layer: 'facilities'};
}

const HOST_COMPAT = {
  grandstand: ['grandstand-sn', 'sn-location'],
  gate: ['gate-sn', 'sn-location'],
  'main-building': ['paddock', 'sn-location'],
  helipad: ['sn-location'],
  bleachers: ['grandstand-sn', 'sn-location'],
  'named-building': ['sn-location']
};

const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

export const toWorld = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const validCoord = l => Number.isFinite(l.lat) && Number.isFinite(l.lon) && l.lat >= LAT_RANGE[0] && l.lat <= LAT_RANGE[1] && l.lon >= LON_RANGE[0] && l.lon <= LON_RANGE[1];

/** correlation_id kind -> map kind / layer. The id is written by the venue setup; it is an explicit relationship, not a naming guess. */
const CORR_KIND = {
  garage: ['pit-garage', 'facilities'],
  'race-control': ['race-control', 'facilities'],
  medical: ['medical', 'emergency'],
  marshal: ['marshal', 'emergency'],
  paddock: ['paddock', 'facilities'],
  sector: ['sector', 'facilities']
};
const parseCorr = c => {
  const m = /^rc360:([a-z-]+):(.+)$/.exec(c || '');
  return m ? {kind: m[1], key: m[2]} : null;
};

/**
 * Join ServiceNow records to circuit facilities.
 *  1. rc360:osm:<map feature id>  -> the OSM-verified facility with that id (explicit link)
 *  2. rc360:<kind>:<key> + coordinates -> its own marker at the record's position
 *  3. rc360:group / rc360:venue   -> containers, no marker
 *  4. anything else (e.g. discovered by name) -> previous coordinate/keyword behaviour
 * Incidents, CIs and tasks attach through their real location / cmdb_ci reference fields.
 */
export function associate(data) {
  const dynamic = {};
  const bundles = {}; // fid -> {location, cis, incidents, alerts, tasks}
  const locFid = {}; // location sys_id -> fid
  const unplaced = [];
  const containers = [];
  const osm = Object.values(FACILITIES);
  const polys = osm.filter(f => f.geom.type === 'poly');
  const points = osm.filter(f => f.geom.type === 'point' && (f.kind === 'gate' || f.kind === 'helipad'));

  const bundle = fid => (bundles[fid] ||= {location: null, cis: [], incidents: [], alerts: [], tasks: []});
  const addDynamic = (l, kind, layer, x, y, extra = {}) => {
    const id = `sn-${l.sysId}`;
    const under = polys.find(f => inPoly(x, y, f.geom.pts));
    dynamic[id] = {z: under ? under.renderedHeightM || 0 : 0, id, kind, layer, name: l.name, osm: '', source: 'servicenow', provenance: l.provenance, geom: {type: 'point', pts: [[x, y]]}, anchor: [x, y], ...extra};
    bundle(id).location = l;
    locFid[l.sysId] = id;
  };

  data.locations.forEach(l => {
    const corr = parseCorr(l.corr);
    const linked = Object.entries(SN_CONFIG.facilityLinks).find(([, id]) => id === l.sysId);
    if (linked && FACILITIES[linked[0]]) {
      bundle(linked[0]).location = l;
      locFid[l.sysId] = linked[0];
      return;
    }
    if (corr && (corr.kind === 'group' || corr.kind === 'venue')) {
      containers.push(l);
      return;
    }
    if (corr && corr.kind === 'osm' && FACILITIES[corr.key]) {
      bundle(corr.key).location = l;
      locFid[l.sysId] = corr.key;
      return;
    }
    if (!validCoord(l)) {
      unplaced.push(l);
      return;
    }
    const [x, y] = toWorld(l.lat, l.lon);
    if (corr && CORR_KIND[corr.kind]) {
      addDynamic(l, CORR_KIND[corr.kind][0], CORR_KIND[corr.kind][1], x, y);
      return;
    }
    // legacy: location found by name with coordinates and no explicit mapping
    const {kind, layer} = classify(l.name);
    const host =
      polys.find(f => inPoly(x, y, f.geom.pts)) ||
      points.find(f => Math.hypot(f.anchor[0] - x, f.anchor[1] - y) < 15);
    if (host && !bundles[host.id]?.location && (HOST_COMPAT[host.kind] || ['sn-location']).includes(kind)) {
      bundle(host.id).location = l;
      locFid[l.sysId] = host.id;
      return;
    }
    addDynamic(l, kind, layer, x, y);
  });

  data.cis.forEach(c => {
    const fid = locFid[c.locationId];
    if (fid) bundle(fid).cis.push(c);
  });
  const ciFid = {};
  data.cis.forEach(c => (ciFid[c.sysId] = locFid[c.locationId]));
  const ciBy = Object.fromEntries(data.cis.map(c => [c.sysId, c]));
  const incFid = {};
  data.incidents.forEach(i => {
    const fid = locFid[i.locationId] || ciFid[i.ciId];
    if (fid) {
      bundle(fid).incidents.push(i);
      incFid[i.sysId] = fid;
    }
  });
  data.alerts.forEach(a => {
    const fid = ciFid[a.ciId];
    if (fid) bundle(fid).alerts.push(a);
  });
  data.tasks.forEach(t => {
    const fid = incFid[t.incidentId];
    if (fid) bundle(fid).tasks.push(t);
  });

  // Pseudo-facilities so incidents and CIs can be selected, focused and described exactly like facilities.
  const records = {};
  const hostPoint = fid => {
    const f = dynamic[fid] || FACILITIES[fid];
    return f ? {anchor: f.anchor, z: f.z || (f.geom.type === 'poly' ? f.renderedHeightM || 0 : 0)} : null;
  };
  data.incidents.forEach(i => {
    const fid = incFid[i.sysId];
    const h = fid && hostPoint(fid);
    if (!h) return;
    records[`inc-${i.sysId}`] = {id: `inc-${i.sysId}`, kind: 'incident', host: fid, name: i.number, geom: {type: 'point', pts: [h.anchor]}, anchor: h.anchor, z: h.z, source: 'servicenow', rec: i, ciClass: ciBy[i.ciId]?.cls || ''};
  });
  data.cis.forEach(c => {
    const fid = locFid[c.locationId];
    const h = fid && hostPoint(fid);
    if (!h) return;
    records[`ci-${c.sysId}`] = {id: `ci-${c.sysId}`, kind: 'ci', host: fid, name: c.name, geom: {type: 'point', pts: [h.anchor]}, anchor: h.anchor, z: h.z, source: 'servicenow', rec: c};
  });

  const count = pred => Object.entries(bundles).filter(([id, b]) => b.location && pred(dynamic[id] || FACILITIES[id])).length;
  const activeInc = data.incidents.filter(i => !i.resolved && incFid[i.sysId]);
  const stats = {
    pitGarages: count(f => f.kind === 'pit-garage'),
    raceControl: count(f => f.kind === 'race-control'),
    paddock: count(f => f.kind === 'paddock' || f.kind === 'main-building'),
    grandstands: count(f => f.kind === 'grandstand' || f.kind === 'grandstand-sn'),
    medical: count(f => f.kind === 'medical'),
    marshals: count(f => f.kind === 'marshal'),
    gates: count(f => f.kind === 'gate' || f.kind === 'gate-sn'),
    sectors: count(f => f.kind === 'sector'),
    cis: data.cis.filter(c => locFid[c.locationId]).length,
    locations: data.locations.length,
    placed: Object.values(bundles).filter(b => b.location).length,
    unplaced: unplaced.length,
    containers: containers.length,
    incidents: activeInc.length,
    resolved: data.incidents.filter(i => i.resolved && incFid[i.sysId]).length,
    alerts: data.alerts.filter(a => ciFid[a.ciId]).length,
    tasks: data.tasks.length,
    teams: data.teams.length
  };
  return {dynamic, bundles, records, unplaced, containers, stats};
}

/* ---------------------------------------------------------------- vehicles */
/**
 * Vehicle source contract (SN_CONFIG.vehicles):
 *   {table, query, idField, labelField, latField, lonField}   position from coordinates, or
 *   {table, query, idField, labelField, distanceField}        metres along the loop from its first vertex
 * Returns [] when not configured. Positions are never generated.
 */
export async function loadVehicles(fetchJson, cfg = SN_CONFIG.vehicles) {
  if (!cfg) return [];
  const fields = [cfg.idField, cfg.labelField, cfg.latField, cfg.lonField, cfg.distanceField, 'sys_id'].filter(Boolean).join(',');
  const r = await getTable(fetchJson, cfg.table, cfg.query || 'sys_idISNOTEMPTY', fields, 100);
  if (!r.ok) return [];
  const out = [];
  r.rows.forEach(row => {
    let x;
    let y;
    let heading;
    if (cfg.distanceField) {
      const d = parseFloat(val(row[cfg.distanceField]));
      if (!Number.isFinite(d)) return;
      const p = pointAt(d);
      [x, y, heading] = [p.x, p.y, p.heading];
    } else {
      const lat = parseFloat(val(row[cfg.latField]));
      const lon = parseFloat(val(row[cfg.lonField]));
      if (!validCoord({lat, lon})) return;
      [x, y] = toWorld(lat, lon);
      heading = nearestOnLoop(x, y).heading;
    }
    out.push({
      id: `veh-${val(row.sys_id)}`,
      sysId: val(row.sys_id),
      table: cfg.table,
      label: disp(row[cfg.labelField]) || disp(row[cfg.idField]),
      x,
      y,
      heading
    });
  });
  return out;
}

export {project};
