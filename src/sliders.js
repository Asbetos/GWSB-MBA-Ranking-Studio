/**
 * Direct sliders: 9 indicator sliders + composite GMAT/GRE control.
 * Compact card layout (smaller padding, designed for the dual-panel studio).
 */

import { getFeatureRanges, getGWUValues, getGmatInputConfig, computeBlendedGMAT, getSbpConfig, computeSBPRatio } from './model.js';

const FEATURE_ORDER = [
  'EmployedAtGrad', 'Employed3Mo', 'AvgSalaryBonus', 'SalaryByProfession',
  'MedianGPA', 'AcceptanceRate', 'PeerScore', 'RecruiterScore',
  'GMAT_Combined',
];

let currentValues = {};
let gmatState = { scale: 'old', gmat_score: null, gre_q: null, gre_v: null, gre_aw: null, gre_enabled: false };
let sbpState = {};
let onChangeCallback = null;
let debounceTimer = null;

function fmt(value, format) {
  switch (format) {
    case 'percent': return `${(value * 100).toFixed(1)}%`;
    case 'dollar':  return `$${Math.round(value).toLocaleString()}`;
    case 'number':
    default: return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
}

function buildSlider(featureKey, config, initialValue) {
  const c = document.createElement('div');
  c.className = 'slider-container';
  c.id = `slider-${featureKey}`;
  const { min, max, step, label, format } = config;
  c.innerHTML = `
    <div class="flex items-center justify-between gap-2 mb-1.5">
      <label class="text-xs font-semibold text-gray-300 truncate" for="range-${featureKey}" title="${label}">${label}</label>
      <span role="button" tabindex="0" class="text-xs font-mono font-bold text-magenta-300 bg-magenta-500/10 px-2 py-0.5 rounded-md cursor-pointer hover:bg-magenta-500/20 transition whitespace-nowrap" id="value-${featureKey}" title="Click to edit numerically">${fmt(initialValue, format)}</span>
      <input type="number" id="input-${featureKey}" class="hidden w-24 bg-ink-800 border border-magenta-500/40 text-magenta-300 rounded px-1.5 py-0.5 text-xs font-mono text-right focus:outline-none focus:border-magenta-500" min="${min}" max="${max}" step="${step}" value="${initialValue}" />
    </div>
    <input type="range" id="range-${featureKey}" min="${min}" max="${max}" step="${step}" value="${initialValue}" aria-label="${label}" />
    <div class="flex justify-between mt-1">
      <span class="text-micro text-gray-600">${fmt(min, format)}</span>
      <span class="text-micro text-gray-600">${fmt(max, format)}</span>
    </div>
  `;
  return c;
}

function buildGmatComposite(gmatCfg, gwuValues) {
  const wrap = document.createElement('div');
  wrap.className = 'slider-container md:col-span-2';
  wrap.id = 'slider-GMAT_Combined';
  const sd = gmatCfg.gmat_scale_default || 'old';
  const oldR = gmatCfg.gmat_old_range, newR = gmatCfg.gmat_new_range;
  const qR = gmatCfg.gre_q_range, vR = gmatCfg.gre_v_range, awR = gmatCfg.gre_aw_range;
  const initG = sd === 'old' ? (gwuValues.gmat_old ?? Math.round((oldR.min + oldR.max) / 2)) : (gwuValues.gmat_new ?? Math.round((newR.min + newR.max) / 2));
  const initQ = gwuValues.gre_q ?? Math.round((qR.min + qR.max) / 2);
  const initV = gwuValues.gre_v ?? Math.round((vR.min + vR.max) / 2);
  const initAW = gwuValues.gre_aw ?? ((awR.min + awR.max) / 2);
  const greOn = !!gmatCfg.gre_default_enabled;
  gmatState = { scale: sd, gmat_score: initG, gre_q: initQ, gre_v: initV, gre_aw: initAW, gre_enabled: greOn };

  wrap.innerHTML = `
    <div class="flex items-center justify-between gap-2 mb-1.5">
      <label class="text-xs font-semibold text-gray-300">GMAT / GRE Score</label>
      <span class="text-xs font-mono font-bold text-magenta-300 bg-magenta-500/10 px-2 py-0.5 rounded-md whitespace-nowrap" id="value-GMAT_Combined">—</span>
    </div>
    <div class="flex gap-1 mb-2" role="group" aria-label="GMAT scale">
      <button type="button" data-gmat-scale="old" class="gmat-scale-btn ${sd === 'old' ? 'active' : ''}">Old GMAT</button>
      <button type="button" data-gmat-scale="new" class="gmat-scale-btn ${sd === 'new' ? 'active' : ''}">New GMAT</button>
    </div>
    <input type="range" id="range-GMAT_Score" min="${sd === 'old' ? oldR.min : newR.min}" max="${sd === 'old' ? oldR.max : newR.max}" step="${sd === 'old' ? oldR.step : newR.step}" value="${initG}" aria-label="GMAT score" />
    <div class="flex justify-between mt-1 text-micro text-gray-600">
      <span id="gmat-min-label">${sd === 'old' ? oldR.min : newR.min}</span>
      <span class="text-magenta-300 font-mono" id="gmat-score-display">${Math.round(initG)}</span>
      <span id="gmat-max-label">${sd === 'old' ? oldR.max : newR.max}</span>
    </div>
    <div class="mt-3 pt-2 border-t border-white/5">
      <label class="flex items-center gap-1.5 text-micro text-gray-400 cursor-pointer">
        <input type="checkbox" id="gre-toggle" ${greOn ? 'checked' : ''} class="accent-magenta-500" />
        GRE (40Q + 40V + 20AW)
      </label>
      <div id="gre-controls" class="mt-1.5 ${greOn ? '' : 'hidden'} space-y-1.5">
        <div>
          <div class="flex justify-between text-micro text-gray-500"><span>GRE Q</span><span class="text-cyan-300 font-mono" id="gre-q-display">${initQ}</span></div>
          <input type="range" id="range-GRE_Q" min="${qR.min}" max="${qR.max}" step="${qR.step}" value="${initQ}" aria-label="GRE quantitative" />
        </div>
        <div>
          <div class="flex justify-between text-micro text-gray-500"><span>GRE V</span><span class="text-cyan-300 font-mono" id="gre-v-display">${initV}</span></div>
          <input type="range" id="range-GRE_V" min="${vR.min}" max="${vR.max}" step="${vR.step}" value="${initV}" aria-label="GRE verbal" />
        </div>
        <div>
          <div class="flex justify-between text-micro text-gray-500"><span>GRE AW</span><span class="text-cyan-300 font-mono" id="gre-aw-display">${initAW.toFixed(1)}</span></div>
          <input type="range" id="range-GRE_AW" min="${awR.min}" max="${awR.max}" step="${awR.step}" value="${initAW}" aria-label="GRE analytical writing" />
        </div>
      </div>
    </div>
  `;
  return wrap;
}

function attachGmatHandlers(wrap, gmatCfg, fireChange) {
  const oldR = gmatCfg.gmat_old_range, newR = gmatCfg.gmat_new_range;
  const r = wrap.querySelector('#range-GMAT_Score');
  const disp = wrap.querySelector('#gmat-score-display');
  const minL = wrap.querySelector('#gmat-min-label');
  const maxL = wrap.querySelector('#gmat-max-label');
  const btns = wrap.querySelectorAll('.gmat-scale-btn');
  const greToggle = wrap.querySelector('#gre-toggle');
  const greCtrls = wrap.querySelector('#gre-controls');
  const chip = wrap.querySelector('#value-GMAT_Combined');
  const qR = wrap.querySelector('#range-GRE_Q'), vR = wrap.querySelector('#range-GRE_V'), awR = wrap.querySelector('#range-GRE_AW');
  const qD = wrap.querySelector('#gre-q-display'), vD = wrap.querySelector('#gre-v-display'), awD = wrap.querySelector('#gre-aw-display');

  const update = () => {
    const blended = computeBlendedGMAT({
      scale: gmatState.scale, gmat_score: gmatState.gmat_score,
      gre_q: gmatState.gre_enabled ? gmatState.gre_q : null,
      gre_v: gmatState.gre_enabled ? gmatState.gre_v : null,
      gre_aw: gmatState.gre_enabled ? gmatState.gre_aw : null,
      gre_enabled: gmatState.gre_enabled,
    });
    chip.textContent = blended.toFixed(1);
    currentValues.GMAT_Combined = {
      scale: gmatState.scale, gmat_score: gmatState.gmat_score,
      gre_q: gmatState.gre_enabled ? gmatState.gre_q : null,
      gre_v: gmatState.gre_enabled ? gmatState.gre_v : null,
      gre_aw: gmatState.gre_enabled ? gmatState.gre_aw : null,
      gre_enabled: gmatState.gre_enabled,
    };
    fireChange();
  };

  r.addEventListener('input', e => { gmatState.gmat_score = parseFloat(e.target.value); disp.textContent = Math.round(gmatState.gmat_score); update(); });
  for (const b of btns) {
    b.addEventListener('click', () => {
      const s = b.dataset.gmatScale;
      if (s === gmatState.scale) return;
      gmatState.scale = s;
      const rg = s === 'old' ? oldR : newR;
      r.min = rg.min; r.max = rg.max; r.step = rg.step;
      let v = gmatState.gmat_score;
      if (v == null || v < rg.min || v > rg.max) v = Math.round((rg.min + rg.max) / 2);
      r.value = v; gmatState.gmat_score = v;
      disp.textContent = Math.round(v); minL.textContent = rg.min; maxL.textContent = rg.max;
      btns.forEach(bb => bb.classList.toggle('active', bb.dataset.gmatScale === s));
      update();
    });
  }
  greToggle.addEventListener('change', e => { gmatState.gre_enabled = e.target.checked; greCtrls.classList.toggle('hidden', !gmatState.gre_enabled); update(); });
  qR.addEventListener('input', e => { gmatState.gre_q = parseFloat(e.target.value); qD.textContent = Math.round(gmatState.gre_q); if (gmatState.gre_enabled) update(); });
  vR.addEventListener('input', e => { gmatState.gre_v = parseFloat(e.target.value); vD.textContent = Math.round(gmatState.gre_v); if (gmatState.gre_enabled) update(); });
  awR.addEventListener('input', e => { gmatState.gre_aw = parseFloat(e.target.value); awD.textContent = gmatState.gre_aw.toFixed(1); if (gmatState.gre_enabled) update(); });
  update();
}

// ============================================================
// Composite SBP control: 7 industries × {salary, n_reporting}
// ============================================================

function buildSBPComposite(sbpCfg, gwuSBP) {
  const wrap = document.createElement('div');
  wrap.className = 'slider-container md:col-span-2';
  wrap.id = 'slider-SalaryByProfession';

  const occs = sbpCfg.occupations;
  const cohort = sbpCfg.cohort;
  const sld = sbpCfg.slider;

  sbpState = {};
  for (const occ of occs) {
    const gw = gwuSBP?.[occ];
    sbpState[occ] = {
      salary: (gw?.salary != null) ? gw.salary : (cohort[occ]?.cohort_mean ?? 130000),
      n: (gw?.n_reporting != null) ? gw.n_reporting : 0,
    };
  }

  const rows = occs.map(occ => {
    const cm = cohort[occ]?.cohort_mean;
    const cmStr = cm ? `cohort $${Math.round(cm).toLocaleString()}` : 'no cohort data';
    const init = sbpState[occ];
    const safeKey = occ.replace(/[^a-z0-9]+/gi, '_');
    return `
      <div class="rounded-lg p-2" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
        <div class="flex items-center justify-between gap-2 mb-0.5">
          <p class="text-mini font-semibold text-white truncate" title="${occ}">${occ}</p>
          <span class="text-micro text-gray-500 whitespace-nowrap">${cmStr}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <input type="range" id="sbp-sal-${safeKey}" data-occ="${occ}" data-role="salary"
                 min="${sld.min}" max="${sld.max}" step="${sld.step}" value="${init.salary}" class="flex-1"
                 aria-label="${occ} median salary" />
          <input type="number" id="sbp-n-${safeKey}" data-occ="${occ}" data-role="n"
                 min="0" max="200" step="1" value="${init.n}"
                 class="w-11 bg-ink-800 border border-white/10 text-emerald-300 rounded px-1 py-0.5 text-micro font-mono text-right focus:outline-none focus:border-emerald-500"
                 title="number of reporting graduates" aria-label="${occ} reporting count" />
        </div>
        <div class="flex justify-between mt-0.5">
          <span class="text-micro text-magenta-300 font-mono" id="sbp-sal-disp-${safeKey}">$${Math.round(init.salary).toLocaleString()}</span>
          <span class="text-micro text-gray-500">n &ge; 3 required</span>
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="flex items-start justify-between gap-2 mb-1.5">
      <div class="min-w-0">
        <label class="text-xs font-semibold text-gray-300">Salary by Profession (cohort-relative)</label>
        <p class="text-micro text-gray-500 mt-0.5">n-weighted mean of (industry salary &divide; cohort mean). Industries with &lt;3 reporters excluded, mirroring US News.</p>
      </div>
      <span class="text-xs font-mono font-bold text-magenta-300 bg-magenta-500/10 px-2 py-0.5 rounded-md whitespace-nowrap" id="value-SalaryByProfession">—</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">${rows}</div>
  `;
  return wrap;
}

function attachSBPHandlers(wrap, fireChange) {
  const chip = wrap.querySelector('#value-SalaryByProfession');
  const update = () => {
    const ratio = computeSBPRatio(sbpState);
    chip.textContent = ratio !== null ? ratio.toFixed(3) : '—';
    currentValues.SalaryByProfession = { ...sbpState };
    fireChange();
  };
  wrap.querySelectorAll('input[data-role="salary"]').forEach(el => {
    el.addEventListener('input', e => {
      const occ = e.target.dataset.occ;
      sbpState[occ].salary = parseFloat(e.target.value);
      const safeKey = occ.replace(/[^a-z0-9]+/gi, '_');
      const disp = wrap.querySelector(`#sbp-sal-disp-${safeKey}`);
      if (disp) disp.textContent = '$' + Math.round(sbpState[occ].salary).toLocaleString();
      update();
    });
  });
  wrap.querySelectorAll('input[data-role="n"]').forEach(el => {
    el.addEventListener('input', e => {
      const occ = e.target.dataset.occ;
      const v = parseInt(e.target.value, 10);
      sbpState[occ].n = isNaN(v) ? 0 : Math.max(0, v);
      update();
    });
  });
  update();
}

export function initSliders(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const ranges = getFeatureRanges();
  const gwuValues = getGWUValues();
  const gmatCfg = getGmatInputConfig();
  onChangeCallback = onChange;

  const sbpCfg = getSbpConfig();
  for (const k of FEATURE_ORDER) {
    if (k === 'GMAT_Combined' || k === 'SalaryByProfession') continue;
    currentValues[k] = gwuValues[k] ?? ranges[k]?.data_median ?? ranges[k]?.min ?? 0;
  }
  currentValues.GMAT_Combined = null;
  currentValues.SalaryByProfession = null;

  const fireChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChangeCallback && onChangeCallback({ ...currentValues }), 250);
  };

  for (const k of FEATURE_ORDER) {
    if (k === 'GMAT_Combined') {
      const composite = buildGmatComposite(gmatCfg, gwuValues);
      container.appendChild(composite);
      attachGmatHandlers(composite, gmatCfg, fireChange);
      continue;
    }
    if (k === 'SalaryByProfession') {
      const composite = buildSBPComposite(sbpCfg, gwuValues.sbp_per_occupation || {});
      container.appendChild(composite);
      attachSBPHandlers(composite, fireChange);
      continue;
    }
    const cfg = ranges[k];
    if (!cfg) continue;
    const slider = buildSlider(k, cfg, currentValues[k]);
    container.appendChild(slider);
    const r = slider.querySelector(`#range-${k}`);
    const ni = slider.querySelector(`#input-${k}`);
    const d = slider.querySelector(`#value-${k}`);
    const set = (val) => {
      val = Math.max(cfg.min, Math.min(cfg.max, val));
      currentValues[k] = val;
      r.value = val; ni.value = val;
      d.textContent = fmt(val, cfg.format);
      fireChange();
    };
    r.addEventListener('input', e => set(parseFloat(e.target.value)));
    const enterEditMode = () => { d.classList.add('hidden'); ni.classList.remove('hidden'); ni.focus(); ni.select(); };
    d.addEventListener('click', enterEditMode);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEditMode(); }
    });
    const commit = () => {
      const v = parseFloat(ni.value);
      if (!isNaN(v) && v >= cfg.min && v <= cfg.max) set(v);
      else ni.value = currentValues[k];
      ni.classList.add('hidden'); d.classList.remove('hidden');
    };
    ni.addEventListener('blur', commit);
    ni.addEventListener('keydown', e => { if (e.key === 'Enter') ni.blur(); });
  }
  return { ...currentValues };
}

export function setSlidersFromCfm(predictedCore) {
  const ranges = getFeatureRanges();
  for (const k of FEATURE_ORDER) {
    if (k === 'GMAT_Combined' || k === 'SalaryByProfession') continue;
    if (!(k in predictedCore)) continue;
    const cfg = ranges[k];
    if (!cfg) continue;
    let val = predictedCore[k];
    val = Math.max(cfg.min, Math.min(cfg.max, val));
    currentValues[k] = val;
    const r = document.getElementById(`range-${k}`);
    const ni = document.getElementById(`input-${k}`);
    const d = document.getElementById(`value-${k}`);
    if (r) r.value = val;
    if (ni) ni.value = val;
    if (d) d.textContent = fmt(val, cfg.format);
  }
  if ('GMAT_Combined' in predictedCore && typeof predictedCore.GMAT_Combined === 'number') {
    // Convert raw GMAT (old-scale) prediction -> blended via percentile rank
    const predBlended = computeBlendedGMAT({
      scale: 'old', gmat_score: predictedCore.GMAT_Combined,
      gre_q: null, gre_v: null, gre_aw: null, gre_enabled: false,
    });
    currentValues.GMAT_Combined = {
      scale: 'old', gmat_score: predictedCore.GMAT_Combined,
      gre_q: null, gre_v: null, gre_aw: null, gre_enabled: false,
    };
    const chip = document.getElementById('value-GMAT_Combined');
    if (chip) chip.textContent = predBlended.toFixed(1);
  }
}

export function resetSliders() {
  const ranges = getFeatureRanges();
  const gwuValues = getGWUValues();
  const gmatCfg = getGmatInputConfig();
  const sbpCfg = getSbpConfig();
  for (const k of FEATURE_ORDER) {
    if (k === 'GMAT_Combined' || k === 'SalaryByProfession') continue;
    const cfg = ranges[k];
    if (!cfg) continue;
    const v = gwuValues[k] ?? cfg.data_median ?? cfg.min;
    currentValues[k] = v;
    const r = document.getElementById(`range-${k}`); if (r) r.value = v;
    const ni = document.getElementById(`input-${k}`); if (ni) ni.value = v;
    const d = document.getElementById(`value-${k}`); if (d) d.textContent = fmt(v, cfg.format);
  }
  // Reset SBP composite
  const sbpWrap = document.getElementById('slider-SalaryByProfession');
  if (sbpWrap) {
    const gwuSBP = gwuValues.sbp_per_occupation || {};
    sbpState = {};
    for (const occ of (sbpCfg.occupations || [])) {
      const gw = gwuSBP[occ];
      sbpState[occ] = {
        salary: gw?.salary ?? sbpCfg.cohort[occ]?.cohort_mean ?? 130000,
        n: gw?.n_reporting ?? 0,
      };
      const safeKey = occ.replace(/[^a-z0-9]+/gi, '_');
      const sal = sbpWrap.querySelector(`#sbp-sal-${safeKey}`);
      const nIn = sbpWrap.querySelector(`#sbp-n-${safeKey}`);
      const disp = sbpWrap.querySelector(`#sbp-sal-disp-${safeKey}`);
      if (sal) sal.value = sbpState[occ].salary;
      if (nIn) nIn.value = sbpState[occ].n;
      if (disp) disp.textContent = '$' + Math.round(sbpState[occ].salary).toLocaleString();
    }
    const ratio = computeSBPRatio(sbpState);
    sbpWrap.querySelector('#value-SalaryByProfession').textContent = ratio !== null ? ratio.toFixed(3) : '—';
    currentValues.SalaryByProfession = { ...sbpState };
  }
  // Reset GMAT composite by re-rendering the wrap children from scratch is complex;
  // instead we just reset the state and update the value chip.
  const wrap = document.getElementById('slider-GMAT_Combined');
  if (wrap) {
    const sd = gmatCfg.gmat_scale_default || 'old';
    const oldR = gmatCfg.gmat_old_range, newR = gmatCfg.gmat_new_range;
    const initG = sd === 'old' ? (gwuValues.gmat_old ?? Math.round((oldR.min + oldR.max) / 2)) : (gwuValues.gmat_new ?? Math.round((newR.min + newR.max) / 2));
    gmatState = { scale: sd, gmat_score: initG, gre_q: gwuValues.gre_q, gre_v: gwuValues.gre_v, gre_aw: gwuValues.gre_aw, gre_enabled: !!gmatCfg.gre_default_enabled };
    const r = wrap.querySelector('#range-GMAT_Score');
    const rg = sd === 'old' ? oldR : newR;
    r.min = rg.min; r.max = rg.max; r.step = rg.step; r.value = initG;
    wrap.querySelector('#gmat-score-display').textContent = Math.round(initG);
    wrap.querySelectorAll('.gmat-scale-btn').forEach(b => b.classList.toggle('active', b.dataset.gmatScale === sd));
    wrap.querySelector('#gre-toggle').checked = gmatState.gre_enabled;
    wrap.querySelector('#gre-controls').classList.toggle('hidden', !gmatState.gre_enabled);
    const blended = computeBlendedGMAT({
      scale: sd, gmat_score: initG,
      gre_q: gmatState.gre_enabled ? gmatState.gre_q : null,
      gre_v: gmatState.gre_enabled ? gmatState.gre_v : null,
      gre_aw: gmatState.gre_enabled ? gmatState.gre_aw : null,
      gre_enabled: gmatState.gre_enabled,
    });
    wrap.querySelector('#value-GMAT_Combined').textContent = blended.toFixed(1);
    currentValues.GMAT_Combined = {
      scale: sd, gmat_score: initG,
      gre_q: gmatState.gre_enabled ? gmatState.gre_q : null,
      gre_v: gmatState.gre_enabled ? gmatState.gre_v : null,
      gre_aw: gmatState.gre_enabled ? gmatState.gre_aw : null,
      gre_enabled: gmatState.gre_enabled,
    };
  }
  if (onChangeCallback) onChangeCallback({ ...currentValues });
}

export const getCurrentValues = () => ({ ...currentValues });
