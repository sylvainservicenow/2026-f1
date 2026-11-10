/* ------------------------------------------------------------------ *
 * Race Control 360 — V6 weather overlay and radar (presentation only)
 *
 * DATA INTEGRITY
 *  - Every number shown here comes from `_sim.weather`, which is read from ServiceNow
 *    (x_snc_lux1_rc_weather_scenario / _forecast / _warning, plus tasks and the decision).
 *  - The radar draws the synthetic precipitation cells STORED on the scenario record. Cell position and
 *    intensity are a deterministic function of those stored parameters and the selected minute
 *    (same formula as the server). Nothing is measured, fetched or invented in the browser.
 *  - When source_type is "simulated_scenario" the radar is labelled SIMULATED WEATHER SCENARIO. It is never
 *    presented as a meteorological radar observation.
 * ------------------------------------------------------------------ */
import {html, svg, css, nothing} from 'lit';
import {classMap} from 'lit/directives/class-map.js';
import {i18n} from '@servicenow/aiux/aiux-services';
import {LOOP_LENGTH_M, pointAt} from './vehicles.js';

// Runtime lookup helper; strings are literals at every call site.
// eslint-disable-next-line @servicenow/aiux-i18n/getmessage-no-variable-arg
const t = s => i18n.getMessage(s);
const fill = (s, ...v) => v.reduce((acc, x, i) => acc.replace(`{${i}}`, x), s);

export const WX_FRAMES = [0, 10, 20, 30, 45, 60];
const W = 420;
const H = 240;
const KM_X = 31; // map spans +-31 km east-west
const PX = W / (2 * KM_X);
const LEVELS = [
  {min: 0.3, color: '#4fb26a', label: 'Light', range: '0.3–2.5'},
  {min: 2.5, color: '#f0cf3a', label: 'Moderate', range: '2.5–7.5'},
  {min: 7.5, color: '#f08a24', label: 'Heavy', range: '7.5–15'},
  {min: 15, color: '#d6342a', label: 'Intense', range: '15+'}
];

/** Rain rate (mm/h) of one stored cell at (px, py) km from the circuit at minute `m`. Identical to the server formula. */
export function cellRate(c, m, px, py) {
  const cx = c.x0 + c.vx * m;
  const cy = c.y0 + c.vy * m;
  const sp = Math.hypot(c.vx, c.vy) || 1;
  const ux = c.vx / sp;
  const uy = c.vy / sp;
  const dx = px - cx;
  const dy = py - cy;
  const u = (dx * ux + dy * uy) / (c.stretch || 1);
  const w = -dx * uy + dy * ux;
  const sig = c.r / Math.sqrt(Math.log(c.peak / 0.3));
  return c.peak * Math.exp(-(u * u + w * w) / (sig * sig));
}
export const rateAtCircuit = (cells, m) => cells.reduce((a, c) => a + cellRate(c, m, 0, 0), 0);

// circuit outline: the same loop the map uses, scaled to the radar (about 3 km across)
const OUTLINE = (() => {
  const pts = [];
  const n = 120;
  for (let i = 0; i <= n; i++) pts.push(pointAt((i / n) * LOOP_LENGTH_M));
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const k = (PX / 1000) * 1.0; // metres -> px
  return pts.map(p => `${(W / 2 + (p.x - cx) * k).toFixed(1)},${(H / 2 + (p.y - cy) * k).toFixed(1)}`).join(' ');
})();

const toXY = (xKm, yKm) => [W / 2 + xKm * PX, H / 2 - yKm * PX];

const fmtClock = ms => {
  try {
    return new Intl.DateTimeFormat(undefined, {timeStyle: 'short'}).format(new Date(ms));
  } catch {
    return '';
  }
};

function radarCells(cells, m) {
  const out = [];
  LEVELS.forEach((lv, li) => {
    cells.forEach(c => {
      if (c.peak <= lv.min) return;
      const sig = c.r / Math.sqrt(Math.log(c.peak / 0.3));
      const rad = sig * Math.sqrt(Math.log(c.peak / lv.min));
      const [x, y] = toXY(c.x0 + c.vx * m, c.y0 + c.vy * m);
      const ang = (-Math.atan2(c.vy, c.vx) * 180) / Math.PI;
      out.push(svg`<ellipse cx=${x.toFixed(1)} cy=${y.toFixed(1)} rx=${(rad * (c.stretch || 1) * PX).toFixed(1)} ry=${(rad * PX).toFixed(1)} transform=${`rotate(${ang.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`} fill=${lv.color} fill-opacity=${(0.42 + li * 0.1).toFixed(2)}></ellipse>`);
    });
  });
  return out;
}

export function renderRadar(wx, minute) {
  const sc = wx.scenario;
  const cells = sc?.cells || [];
  const sim = wx.simulated;
  const issued = wx.forecast?.issued_ms || 0;
  const rate = rateAtCircuit(cells, minute);
  const rings = [10, 20, 30].map(km => svg`<circle cx=${W / 2} cy=${H / 2} r=${km * PX} fill="none" stroke="rgba(27,35,43,.14)" stroke-dasharray="2 4"></circle><text x=${W / 2 + km * PX - 3} y=${H / 2 - 3} text-anchor="end" class="wx-km">${km} km</text>`);
  const [cx, cy] = [W / 2, H / 2];
  const label = minute < 0.5 ? t('NOW') : fill(t('+{0} min'), Math.round(minute));
  return html`<figure class="wx-radar" aria-label=${fill(t('Precipitation radar, {0}. Simulated weather scenario'), label)}>
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-labelledby="wx-radar-t">
      <title id="wx-radar-t">${sim ? t('Simulated precipitation scenario around Circuit Paul Ricard') : t('Precipitation around Circuit Paul Ricard')}</title>
      <defs>
        <filter id="wx-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2"></feGaussianBlur></filter>
        <linearGradient id="wx-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef2ea"></stop><stop offset="1" stop-color="#e3e9e1"></stop></linearGradient>
        <clipPath id="wx-clip"><rect width=${W} height=${H} rx="10"></rect></clipPath>
      </defs>
      <g clip-path="url(#wx-clip)">
        <rect width=${W} height=${H} fill="url(#wx-bg)"></rect>
        <path d=${`M0 ${H * 0.78} C ${W * 0.25} ${H * 0.7}, ${W * 0.4} ${H * 0.9}, ${W * 0.62} ${H * 0.84} S ${W * 0.9} ${H * 0.7}, ${W} ${H * 0.76} L ${W} ${H} L 0 ${H} Z`} fill="rgba(120,160,190,.16)"></path>
        ${rings}
        <line x1="0" y1=${cy} x2=${W} y2=${cy} stroke="rgba(27,35,43,.07)"></line>
        <line x1=${cx} y1="0" x2=${cx} y2=${H} stroke="rgba(27,35,43,.07)"></line>
        <g filter="url(#wx-blur)" class="wx-cells">${radarCells(cells, minute)}</g>
        <polyline points=${OUTLINE} fill="none" stroke="#1b232b" stroke-opacity=".55" stroke-width="1.1" stroke-linejoin="round"></polyline>
        <circle cx=${cx} cy=${cy} r="9" fill="none" stroke="#2d6fd1" stroke-opacity=".5" class="wx-ping"></circle>
        <circle cx=${cx} cy=${cy} r="4" fill="#fff" stroke="#2d6fd1" stroke-width="2"></circle>
        <text x=${cx + 9} y=${cy + 14} class="wx-lbl">${t('Circuit Paul Ricard')}</text>
        <text x=${W - 10} y="16" text-anchor="end" class="wx-n">N ↑</text>
      </g>
    </svg>
    <figcaption class="wx-cap">
      <span class="wx-time">${label}${issued ? html` · <b>${fmtClock(issued + minute * 60000)}</b>` : nothing}</span>
      <span class="wx-rate">${fill(t('{0} mm/h at the circuit'), rate < 0.05 ? '0' : rate.toFixed(1))}</span>
    </figcaption>
    ${sim ? html`<div class="wx-sim" role="note">${t('SIMULATED WEATHER SCENARIO')} · ${t('not a meteorological observation')}</div>` : nothing}
  </figure>`;
}

function legend() {
  return html`<ul class="wx-leg" aria-label=${t('Precipitation intensity (mm/h)')}>${LEVELS.map(l => html`<li><i style=${`background:${l.color}`}></i>${t(l.label)}<small>${l.range}</small></li>`)}</ul>`;
}

function slider(host) {
  const m = host._wxMinute;
  return html`<div class="wx-ctl">
    <button class="wx-play" type="button" aria-label=${host._wxPlay ? t('Pause forecast progression') : t('Play forecast progression')} @click=${() => host._wxTogglePlay()}>${host._wxPlay ? svg`<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"></path></svg>` : svg`<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg>`}</button>
    <div class="wx-sl">
      <input type="range" min="0" max="60" step="1" .value=${String(Math.round(m))} aria-label=${t('Forecast time, minutes from now')} aria-valuetext=${m < 0.5 ? t('NOW') : fill(t('+{0} min'), Math.round(m))} @input=${e => host._wxSeek(Number(e.target.value))} />
      <div class="wx-ticks" aria-hidden="true">${WX_FRAMES.map(f => html`<button type="button" tabindex="-1" class=${classMap({on: Math.abs(m - f) < 1})} style=${`left:${(f / 60) * 100}%`} @click=${() => host._wxSeek(f)}>${f === 0 ? t('NOW') : `+${f}`}</button>`)}</div>
    </div>
  </div>`;
}

function facts(wx) {
  const f = wx.forecast;
  const onsetMs = f.issued_ms + f.onset_min * 60000;
  return html`<dl class="wx-facts">
    <div><dt>${t('Rain probability')}</dt><dd>${f.probability_pct}%</dd><small>${fill(t('more than {0} mm in 60 min'), f.threshold_mm)}</small></div>
    <div><dt>${t('Expected rainfall')}</dt><dd>${f.expected_mm} mm</dd><small>${t('next 60 minutes')}</small></div>
    <div><dt>${t('Estimated arrival')}</dt><dd>~${f.onset_min} min</dd><small>${fill(t('around {0}'), fmtClock(onsetMs))}</small></div>
    <div><dt>${t('Peak period')}</dt><dd>${f.peak_from_min}–${f.peak_to_min} min</dd><small>${fmtClock(f.issued_ms + f.peak_from_min * 60000)}–${fmtClock(f.issued_ms + f.peak_to_min * 60000)}</small></div>
  </dl>
  <p class="wx-cur"><b>${t('Now')}</b> ${f.current.conditions} · ${f.current.temp_c}°C · ${f.current.wind_kph} km/h ${f.current.wind_dir} · ${f.current.humidity_pct}%</p>`;
}

function timelineChart(wx, minute) {
  const tl = wx.scenario?.timeline || [];
  if (!tl.length) return nothing;
  const max = Math.max(5, ...tl.map(p => p.rate));
  return html`<div class="wx-tl" role="group" aria-label=${t('Forecast timeline')}>
    ${tl.map(p => {
      const active = Math.abs(minute - p.min) < 5;
      return html`<div class=${classMap({col: true, on: active})}>
        <span class="pr">${p.prob}%</span>
        <span class="bar"><i style=${`height:${Math.max(3, (p.rate / max) * 100)}%`}></i></span>
        <span class="rt">${p.rate} <small>mm/h</small></span>
        <span class="mn">${p.min === 0 ? t('NOW') : `+${p.min}`}</span>
      </div>`;
    })}
  </div>`;
}

function stages(wx) {
  const done = wx.stages.filter(x => x.done);
  const last = done[done.length - 1];
  const next = wx.stages.find(x => !x.done);
  return html`<p class="wx-stline" title=${wx.stages.map(x => `${x.done ? '✓' : '·'} ${t(x.label)}`).join('\n')}><b>${t('Response')}:</b> ${t(last.label)} (${done.length}/${wx.stages.length})${next ? html` · ${t('next')}: ${t(next.label)}` : nothing}</p>`;
}

function chip(state) {
  const m = {pending: 'warn', applied: 'ok', approved: 'ok', rejected: 'bad', simulated_delivered: 'ok', not_sent: ''};
  return html`<span class=${`chip ${m[state] || ''}`}>${String(state || '').replace(/_/g, ' ')}</span>`;
}

function prepView(host, wx) {
  const c = wx.communication;
  return html`<div class="wx-prep">
    <h3>${t('Preparation tasks')}</h3>
    ${wx.tasks.length
      ? html`<ul class="wx-list">${wx.tasks.map(
          x => html`<li><a class="rec-link" href=${host._recordLink('task', x.sys_id)} target="_blank" rel="noopener noreferrer">${x.number}</a><span>${x.label.replace(/ \(.*\)$/, '')}<small>${x.group || t('Unassigned')}</small></span><span class=${`chip ${x.completed ? 'ok' : x.closed ? '' : 'warn'}`}>${x.state}</span></li>`
        )}</ul>`
      : html`<p class="wx-empty">${t('No preparation tasks have been created yet.')}</p>`}
    <h3>${t('Spectator announcement')}</h3>
    ${c
      ? html`<div class="wx-ann">
          <div class="row2"><a class="rec-link" href=${host._recordLink('x_snc_lux1_rc_decision', c.sys_id)} target="_blank" rel="noopener noreferrer">${c.number}</a>${chip(c.state)}<span class="chip">${t('delivery')}: ${c.delivery_state === 'simulated_delivered' ? t('SIMULATED') : t('not delivered')}</span></div>
          <blockquote>${c.message}</blockquote>
          <p class="wx-note">${c.state === 'pending' ? fill(t('Awaiting approval by {0}. Nothing has been delivered.'), c.approval?.approver || '—') : c.state === 'applied' ? t('Approved. Delivery is simulated: no public-address or warning system is connected.') : t('Not approved.')}</p>
          ${c.can_decide && c.state === 'pending'
            ? html`<div class="row2"><button class="act primary sm" type="button" ?disabled=${!!host._simBusy} @click=${() => host._scnPost(`/decision/${c.sys_id}/decide`, {outcome: 'approve'}, t('Approval recorded in ServiceNow'), `a${c.sys_id}`)}>${t('Approve')}</button><button class="act sm" type="button" ?disabled=${!!host._simBusy} @click=${() => host._scnPost(`/decision/${c.sys_id}/decide`, {outcome: 'reject'}, t('Rejection recorded in ServiceNow'), `r${c.sys_id}`)}>${t('Reject')}</button></div>`
            : nothing}
        </div>`
      : html`<p class="wx-empty">${t('No announcement has been prepared.')}</p>`}
  </div>`;
}

/** Exactly one primary action, chosen from the authoritative state and the user's permissions. */
function primaryAction(host, wx, op, busy) {
  const c = wx.communication;
  if (!wx.tasks.length && op) return html`<button class="act primary sm" type="button" ?disabled=${busy} @click=${() => host._wxCreateTasks()}>${t('Create preparation tasks')}</button>`;
  if (!c && op) return html`<button class="act primary sm" type="button" ?disabled=${busy} @click=${() => host._wxAnnouncement()}>${t('Prepare announcement')}</button>`;
  if (c && c.state === 'pending') return html`<button class="act primary sm" type="button" @click=${() => host._wxViewApproval()}>${t('View pending approval')}</button>`;
  return nothing;
}

export function renderWeatherPanel(host) {
  if (!host._wxOpen) return nothing;
  const wx = host._sim?.weather;
  const op = !!host._sim?.canOperate;
  const busy = !!host._simBusy;
  const close = html`<button class="xs" type="button" @click=${() => host._wxClose()} aria-label=${t('Close weather')}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>`;
  if (!wx || !wx.forecast) {
    return html`<section class="wxpanel" role="dialog" aria-label=${t('Weather')}>
      <header><span class="eyebrow" style="margin:0">${t('Weather')} · ${t('Circuit Paul Ricard')}</span>${close}</header>
      <p class="wx-empty" style="padding:10px 2px 4px">${t('No forecast is stored in ServiceNow for this session.')}</p>
      ${op ? html`<div class="wx-acts"><button class="act sm" type="button" ?disabled=${busy} @click=${() => host._wxSimulate()}>${t('Simulate Weather Warning')}</button></div>` : nothing}
    </section>`;
  }
  const w = wx.warning;
  const track = host._sim.session.track_status;
  const hasTasks = wx.tasks.length > 0;
  const c = wx.communication;
  const sev = w?.severity === 'warning' ? t('WARNING') : t('WATCH');
  return html`<section class="wxpanel" role="dialog" aria-label=${t('Weather')}>
    <header>
      <span class="eyebrow" style="margin:0">${t('Weather')} · ${t('Circuit Paul Ricard')}</span>
      ${close}
    </header>
    ${w
      ? html`<div class="wx-warn" role="status">
          <b>${sev}: ${t('heavy rain approaching')}</b>
          <span>${w.impact}</span>
          <span class="wx-trk">${t('Track status')}: <b>${String(track).toUpperCase()}</b> · ${t('a weather warning does not change it')}</span>
        </div>`
      : html`<p class="wx-empty">${t('Forecast stored. It is below the warning thresholds.')}</p>`}
    <div class="wx-tabs" role="tablist">
      <button type="button" role="tab" aria-selected=${String(host._wxTab === 'forecast')} class=${classMap({on: host._wxTab === 'forecast'})} @click=${() => (host._wxTab = 'forecast')}>${t('Forecast')}</button>
      <button type="button" role="tab" aria-selected=${String(host._wxTab === 'prep')} class=${classMap({on: host._wxTab === 'prep'})} @click=${() => (host._wxTab = 'prep')}>${t('Preparations')}${hasTasks || c ? html`<span class="n">${wx.tasks.length + (c ? 1 : 0)}</span>` : nothing}</button>
    </div>
    ${host._wxTab === 'forecast'
      ? html`${renderRadar(wx, host._wxMinute)}${slider(host)}${legend()}${facts(wx)}${timelineChart(wx, host._wxMinute)}`
      : prepView(host, wx)}
    ${w ? stages(wx) : nothing}
    <p class="wx-src"><b>${t('Source')}:</b> ${wx.forecast.source_name}${wx.simulated ? ` · ${t('SIMULATED')}` : ''} · ${t('issued')} ${fmtClock(wx.forecast.issued_ms)}${' '}· ${t('valid to')} ${fmtClock(new Date(`${wx.forecast.valid_to.replace(' ', 'T')}Z`).getTime())}</p>
    ${w
      ? html`<div class="wx-acts">
          ${primaryAction(host, wx, op, busy)}
          ${hasTasks && host._wxTab !== 'prep' ? html`<button class="act sm" type="button" @click=${() => (host._wxTab = 'prep')}>${t('Review preparations')}</button>` : nothing}
          ${host._wxTab === 'prep' ? html`<button class="act sm" type="button" @click=${() => (host._wxTab = 'forecast')}>${t('Back to forecast')}</button>` : nothing}
          <a class="wx-open" href=${host._recordLink('x_snc_lux1_rc_weather_warning', w.sys_id)} target="_blank" rel="noopener noreferrer">${t('Open warning record')} ↗</a>
        </div>`
      : nothing}
    ${host._simMsg ? html`<p class=${classMap({simmsg: true, bad: !host._simMsg.ok})} role="status">${host._simMsg.text}</p>` : nothing}
  </section>`;
}

export const weatherStyles = css`
  .tbtn.wx-warnbtn {
    background: #fff4de;
    color: #b86a00;
    border-color: #e8921a;
  }
  .tbtn.wx-warnbtn:hover:not([disabled]) {
    background: #ffeccb;
    color: #9a5600;
  }
  .tbtn.wx-enter {
    animation: wxEnter 0.9s cubic-bezier(0.22, 0.7, 0.2, 1) 1;
  }
  @keyframes wxEnter {
    0% {
      transform: scale(0.8);
      box-shadow: 0 0 0 0 rgba(232, 146, 26, 0.55);
    }
    55% {
      transform: scale(1.12);
      box-shadow: 0 0 0 10px rgba(232, 146, 26, 0);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(232, 146, 26, 0);
    }
  }
  .wxdot {
    position: absolute;
    right: -3px;
    top: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 8px;
    background: #e8921a;
    color: #fff;
    font: 700 9.5px/16px var(--cond, system-ui);
    letter-spacing: 0.02em;
    text-align: center;
    border: 1.5px solid #fff;
    pointer-events: none;
  }
  .wxpanel {
    position: absolute;
    z-index: 9;
    right: 18px;
    top: 62px;
    width: 440px;
    max-width: calc(100vw - 36px);
    max-height: calc(100vh - 90px);
    overflow: auto;
    padding: 14px 16px 14px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    box-shadow: 0 16px 40px rgba(74, 58, 30, 0.24);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    animation: pop 0.28s var(--ease);
  }
  .wxpanel header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .wx-warn {
    display: grid;
    gap: 3px;
    padding: 9px 11px;
    margin-bottom: 9px;
    border-radius: 10px;
    background: #fff4de;
    border: 1px solid #f0c27a;
    color: #5b3a05;
    font-size: 12.5px;
    line-height: 1.35;
  }
  .wx-warn b {
    font-family: var(--cond);
    letter-spacing: 0.06em;
    font-size: 14px;
    color: #9a5600;
  }
  .wx-trk {
    color: #7a5a22;
    font-size: 11.5px;
  }
  .wx-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .wx-tabs button {
    appearance: none;
    border: 0;
    background: none;
    padding: 6px 10px;
    font: inherit;
    font-size: 12.5px;
    color: var(--ink2);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .wx-tabs button.on {
    color: var(--ink);
    border-bottom-color: var(--blue);
    font-weight: 600;
  }
  .wx-tabs button:focus-visible {
    outline: 2px solid var(--blue);
  }
  .wx-tabs .n {
    margin-left: 5px;
    font-size: 10px;
    background: rgba(27, 35, 43, 0.08);
    border-radius: 8px;
    padding: 1px 5px;
  }
  .wx-radar {
    position: relative;
    margin: 0;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--line);
  }
  .wx-radar svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .wx-km {
    font: 9px system-ui;
    fill: rgba(27, 35, 43, 0.4);
  }
  .wx-lbl {
    font: 600 10px system-ui;
    fill: #1b232b;
    paint-order: stroke;
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 3px;
  }
  .wx-n {
    font: 600 10px system-ui;
    fill: rgba(27, 35, 43, 0.5);
  }
  .wx-ping {
    transform-origin: 210px 120px;
    animation: wxPing 2.4s ease-out infinite;
  }
  @keyframes wxPing {
    from {
      transform: scale(0.7);
      opacity: 0.9;
    }
    to {
      transform: scale(2.4);
      opacity: 0;
    }
  }
  .wx-cap {
    position: absolute;
    left: 8px;
    top: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 3px 9px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.88);
    font-size: 11.5px;
    color: var(--ink);
  }
  .wx-time b {
    font-variant-numeric: tabular-nums;
  }
  .wx-rate {
    color: var(--ink2);
    font-variant-numeric: tabular-nums;
  }
  .wx-sim {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(27, 35, 43, 0.78);
    color: #fff;
    font: 600 9.5px/1.6 system-ui;
    letter-spacing: 0.08em;
  }
  .wx-ctl {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 10px 2px 2px;
  }
  .wx-play {
    appearance: none;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 15px;
    border: 1px solid var(--line-strong);
    background: #fff;
    color: var(--ink);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .wx-play:hover {
    border-color: var(--blue);
    color: var(--blue);
  }
  .wx-play:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 2px;
  }
  .wx-sl {
    position: relative;
    flex: 1;
    padding-top: 6px;
  }
  .wx-sl input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: #2d6fd1;
  }
  .wx-ticks {
    position: relative;
    height: 18px;
    margin: 2px 7px 0;
  }
  .wx-ticks button {
    position: absolute;
    transform: translateX(-50%);
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font: 600 10px system-ui;
    color: var(--ink3);
    cursor: pointer;
    letter-spacing: 0.04em;
  }
  .wx-ticks button.on {
    color: var(--blue);
  }
  .wx-leg {
    display: flex;
    gap: 12px;
    list-style: none;
    padding: 0;
    margin: 4px 2px 8px;
    font-size: 10.5px;
    color: var(--ink2);
  }
  .wx-leg li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .wx-leg i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
  }
  .wx-leg small {
    color: var(--ink3);
    font-size: 9.5px;
  }
  .wx-facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 14px;
    margin: 0 0 6px;
  }
  .wx-facts div {
    display: grid;
    gap: 0;
    padding: 6px 9px;
    border-radius: 9px;
    background: rgba(27, 35, 43, 0.04);
  }
  .wx-facts dt {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink2);
  }
  .wx-facts dd {
    margin: 0;
    font-family: var(--cond);
    font-weight: 600;
    font-size: 22px;
    line-height: 1.15;
  }
  .wx-facts small {
    font-size: 10.5px;
    color: var(--ink3);
  }
  .wx-cur {
    margin: 4px 2px 8px;
    font-size: 11.5px;
    color: var(--ink2);
  }
  .wx-tl {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
    margin: 4px 0 10px;
    height: 104px;
  }
  .wx-tl .col {
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    justify-items: center;
    gap: 1px;
    font-size: 10px;
    color: var(--ink2);
    padding: 3px 0;
    border-radius: 8px;
    transition: background 0.2s ease;
  }
  .wx-tl .col.on {
    background: rgba(45, 111, 209, 0.09);
    color: var(--ink);
  }
  .wx-tl .bar {
    width: 70%;
    display: flex;
    align-items: flex-end;
  }
  .wx-tl .bar i {
    display: block;
    width: 100%;
    border-radius: 3px 3px 0 0;
    background: linear-gradient(#2d6fd1, #7ba6e6);
    transition: height 0.3s ease;
  }
  .wx-tl .pr {
    font-weight: 600;
  }
  .wx-tl .rt small {
    font-size: 8.5px;
    color: var(--ink3);
  }
  .wx-tl .mn {
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .wx-stline {
    margin: 2px 2px 6px;
    font-size: 11.5px;
    color: var(--ink2);
  }
  .wx-open {
    margin-left: auto;
    align-self: center;
    font-size: 11.5px;
    color: var(--blue);
    text-decoration: none;
  }
  .wx-open:hover {
    text-decoration: underline;
  }
  .wx-stg {
    display: flex;
    list-style: none;
    margin: 4px 0 8px;
    padding: 0;
    gap: 2px;
  }
  .wx-stg li {
    flex: 1;
    display: grid;
    justify-items: center;
    gap: 3px;
    font-size: 9.5px;
    text-align: center;
    color: var(--ink3);
    line-height: 1.2;
    position: relative;
  }
  .wx-stg li i {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 2px solid #c9cfd6;
    background: #fff;
    z-index: 1;
  }
  .wx-stg li::before {
    content: '';
    position: absolute;
    top: 5px;
    left: -50%;
    width: 100%;
    height: 2px;
    background: #d9dee3;
  }
  .wx-stg li:first-child::before {
    display: none;
  }
  .wx-stg li.done {
    color: var(--ink);
  }
  .wx-stg li.done i {
    border-color: #2f9e6a;
    background: #2f9e6a;
  }
  .wx-stg li.done::before {
    background: #2f9e6a;
  }
  .wx-src {
    margin: 2px 2px 8px;
    font-size: 10.5px;
    color: var(--ink3);
    line-height: 1.4;
  }
  .wx-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .wx-empty {
    margin: 4px 2px 8px;
    font-size: 12.5px;
    color: var(--ink2);
  }
  .wx-prep h3 {
    margin: 10px 2px 4px;
    font-family: var(--cond);
    letter-spacing: 0.06em;
    font-size: 13px;
    text-transform: uppercase;
    color: var(--ink2);
  }
  .wx-list {
    list-style: none;
    margin: 0 0 4px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .wx-list li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .wx-list small {
    display: block;
    color: var(--ink3);
    font-size: 10.5px;
  }
  .wx-ann blockquote {
    margin: 6px 0;
    padding: 8px 10px;
    border-left: 3px solid #2d6fd1;
    background: rgba(27, 35, 43, 0.04);
    font-size: 12px;
    line-height: 1.4;
    border-radius: 0 8px 8px 0;
  }
  .wx-note {
    margin: 2px 0 6px;
    font-size: 11.5px;
    color: var(--ink2);
  }
  @media (prefers-reduced-motion: reduce) {
    .tbtn.wx-enter,
    .wx-ping,
    .wxpanel {
      animation: none;
    }
  }
`;
