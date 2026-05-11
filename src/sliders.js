/**
 * Direct sliders: 9 indicator sliders + composite GMAT/GRE control + composite
 * Salary-by-Profession control. Input format mirrors v2 exactly:
 *   - GMAT composite has Include-GMAT and Include-GRE toggle switches, full
 *     scale labels (200–800 / 205–805), the cohort-floor fallback note, and the
 *     "Blended percentile (vs. cohort)" subtitle.
 *   - SBP composite uses the three-input row: salary number input + slider + n input.
 *   - Direct sliders show a red-border error message when the typed number is
 *     outside the indicator's valid range.
 */

import { getFeatureRanges, getGWUValues, getGmatInputConfig, computeBlendedGMAT, getSbpConfig, computeSBPRatio } from './model.js';

const FEATURE_ORDER = [
  'EmployedAtGrad', 'Employed3Mo', 'AvgSalaryBonus', 'SalaryByProfession',
  'MedianGPA', 'AcceptanceRate', 'PeerScore', 'RecruiterScore',
  'GMAT_Combined',
];

let currentValues = {};
let gmatState = { scale: 'old', gmat_score: null, gre_q: null, gre_v: null, gre_aw: null, gre_enabled: false, gmat_enabled: true };
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
      <div class="flex flex-col items-end">
        <span role="button" tabindex="0" class="text-xs font-mono font-bold text-magenta-300 bg-magenta-500/10 px-2 py-0.5 rounded-md cursor-pointer hover:bg-magenta-500/20 transition whitespace-nowrap" id="value-${featureKey}" title="Click to edit numerically">${fmt(initialValue, format)}</span>
        <input type="number" id="input-${featureKey}" class="hidden w-24 bg-ink-800 border border-magenta-500/40 text-magenta-300 rounded px-1.5 py-0.5 text-xs font-mono text-right focus:outline-none focus:border-magenta-500" min="${min}" max="${max}" step="${step}" value="${initialValue}" aria-label="${label} numeric input" />
      </div>
    </div>
    <div id="error-${featureKey}" class="hidden text-rose-400 text-micro text-right mb-1 -mt-1">Invalid range (${fmt(min, format)}&ndash;${fmt(max, format)})</div>
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
  const oldR = gmatCfg.gmat_old_range || { min: 200, max: 800, step: 5 };
  const newR = gmatCfg.gmat_new_range || { min: 205, max: 805, step: 5 };
  const qR = gmatCfg.gre_q_range, vR = gmatCfg.gre_v_range, awR = gmatCfg.gre_aw_range;
  const initG = sd === 'old' ? (gwuValues.gmat_old ?? Math.round((oldR.min + oldR.max) / 2)) : (gwuValues.gmat_new ?? Math.round((newR.min + newR.max) / 2));
  const initQ = gwuValues.gre_q ?? Math.round((qR.min + qR.max) / 2);
  const initV = gwuValues.gre_v ?? Math.round((vR.min + vR.max) / 2);
  const initAW = gwuValues.gre_aw ?? ((awR.min + awR.max) / 2);
  const greOn = !!gmatCfg.gre_default_enabled;
  const gmatOn = true;
  gmatState = { scale: sd, gmat_score: initG, gre_q: initQ, gre_v: initV, gre_aw: initAW, gre_enabled: greOn, gmat_enabled: gmatOn };

  wrap.innerHTML = `
    <div class="flex items-center justify-between gap-2 mb-1.5">
      <label class="text-xs font-semibold text-gray-300">GMAT / GRE Score</label>
      <span class="text-xs font-mono font-bold text-magenta-300 bg-magenta-500/10 px-2 py-0.5 rounded-md whitespace-nowrap" id="value-GMAT_Combined">&mdash;</span>
    </div>

    <div class="pb-2 border-b border-white/5">
      <label class="toggle-switch text-mini mb-2">
        <input type="checkbox" id="gmat-toggle" ${gmatOn ? 'checked' : ''} />
        <span class="toggle-switch-track" aria-hidden="true"><span class="toggle-switch-knob"></span></span>
        <span class="text-gray-300 font-semibold">Include GMAT input</span>
      </label>
      <div id="gmat-controls" class="${gmatOn ? '' : 'hidden'}">
        <div class="flex gap-1 mb-2" role="group" aria-label="GMAT scale">
          <button type="button" data-gmat-scale="old" class="gmat-scale-btn px-2 py-0.5 rounded ${sd === 'old' ? 'active' : ''}">Old GMAT (200&ndash;800)</button>
          <button type="button" data-gmat-scale="new" class="gmat-scale-btn px-2 py-0.5 rounded ${sd === 'new' ? 'active' : ''}">New GMAT (205&ndash;805)</button>
        </div>
        <input type="range" id="range-GMAT_Score" min="${sd === 'old' ? oldR.min : newR.min}" max="${sd === 'old' ? oldR.max : newR.max}" step="${sd === 'old' ? oldR.step : newR.step}" value="${initG}" aria-label="GMAT score" />
        <div class="flex justify-between mt-1 text-micro text-gray-600">
          <span id="gmat-min-label">${sd === 'old' ? oldR.min : newR.min}</span>
          <span class="text-magenta-300 font-mono" id="gmat-score-display">${Math.round(initG)}</span>
          <span id="gmat-max-label">${sd === 'old' ? oldR.max : newR.max}</span>
        </div>
      </div>
    </div>

    <div class="mt-3 pt-2 border-t border-white/5">
      <label class="toggle-switch text-mini">
        <input type="checkbox" id="gre-toggle" ${greOn ? 'checked' : ''} />
        <span class="toggle-switch-track" aria-hidden="true"><span class="toggle-switch-knob"></span></span>
        <span class="text-gray-300 font-semibold">Include GRE input</span>
        <span class="text-micro text-gray-500">(40% Q + 40% V + 20% AW)</span>
      </label>
      <p class="text-micro text-gray-500 mt-1 leading-snug">If both GMAT and GRE are off, the cohort floor is used (matches US News missing-data rule).</p>
      <div id="gre-controls" class="mt-2 ${greOn ? '' : 'hidden'} space-y-1.5">
        <div>
          <div class="flex justify-between text-micro text-gray-500"><span>GRE Quantitative</span><span class="text-cyan-300 font-mono" id="gre-q-display">${initQ}</span></div>
          <input type="range" id="range-GRE_Q" min="${qR.min}" max="${qR.max}" step="${qR.step}" value="${initQ}" aria-label="GRE quantitative" />
        </div>
        <div>
          <div class="flex justify-between text-micro text-gray-500"><span>GRE Verbal</span><span class="text-cyan-300 font-mono" id="gre-v-display">${initV}</span></div>
          <input type="range" id="range-GRE_V" min="${vR.min}" max="${vR.max}" step="${vR.step}" value="${initV}" aria-label="GRE verbal" />
        </div>
        <div>
          <div class="flex justify-between text-micro text-gray-500"><span>GRE Analytical Writing</span><span class="text-cyan-300 font-mono" id="gre-aw-display">${initAW.toFixed(1)}</span></div>
          <input type="range" id="range-GRE_AW" min="${awR.min}" max="${awR.max}" step="${awR.step}" value="${initAW}" aria-label="GRE analytical writing" />
        </div>
      </div>
    </div>

    <p class="text-micro text-gray-500 mt-2 leading-snug">Blended percentile (vs. cohort) &mdash; fed to the scoring engine.</p>
  `;
  return wrap;
}

function attachGmatHandlers(wrap, gmatCfg, fireChange) {
  const oldR = gmatCfg.gmat_old_range || { min: 200, max: 800, step: 5 };
  const newR = gmatCfg.gmat_new_range || { min: 205, max: 805, step: 5 };
  const r = wrap.querySelector('#range-GMAT_Score');
  const disp = wrap.querySelector('#gmat-score-display');
  const minL = wrap.querySelector('#gmat-min-label');
  const maxL = wrap.querySelector('#gmat-max-label');
  const btns = wrap.querySelectorAll('.gmat-scale-btn');
  const gmatToggle = wrap.querySelector('#gmat-toggle');
  const gmatCtrls = wrap.querySelector('#gmat-controls');
  const greToggle = wrap.querySelector('#gre-toggle');
  const greCtrls = wrap.querySelector('#gre-controls');
  const chip = wrap.querySelector('#value-GMAT_Combined');
  const qR = wrap.querySelector('#range-GRE_Q'), vR = wrap.querySelector('#range-GRE_V'), awR = wrap.querySelector('#range-GRE_AW');
  const qD = wrap.querySelector('#gre-q-display'), vD = wrap.querySelector('#gre-v-display'), awD = wrap.querySelector('#gre-aw-display');

  const update = () => {
    const payload = {
      scale: gmatState.scale,
      gmat_score: gmatState.gmat_enabled ? gmatState.gmat_score : null,
      gre_q: gmatState.gre_enabled ? gmatState.gre_q : null,
      gre_v: gmatState.gre_enabled ? gmatState.gre_v : null,
      gre_aw: gmatState.gre_enabled ? gmatState.gre_aw : null,
      gre_enabled: gmatState.gre_enabled,
      gmat_enabled: gmatState.gmat_enabled,
    };
    const blended = computeBlendedGMAT(payload);
    chip.textContent = blended.toFixed(1);
    currentValues.GMAT_Combined = payload;
    fireChange();
  };

  r.addEventListener('input', e => { gmatState.gmat_score = parseFloat(e.target.value); disp.textContent = Math.round(gmatState.gmat_score); if (gmatState.gmat_enabled) update(); });
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
  gmatToggle.addEventListener('change', e => { gmatState.gmat_enabled = e.target.checked; gmatCtrls.classList.toggle('hidden', !gmatState.gmat_enabled); update(); });
  greToggle.addEventListener('change', e => { gmatState.gre_enabled = e.target.checked; greCtrls.classList.toggle('hidden', !gmatState.gre_enabled); update(); });
  qR.addEventListener('input', e => { gmatState.gre_q = parseFloat(e.target.value); qD.textContent = Math.round(gmatState.gre_q); if (gmatState.gre_enabled) update(); });
  vR.addEventListener('input', e => { gmatState.gre_v = parseFloat(e.target.value); vD.textContent = Math.round(gmatState.gre_v); if (gmatState.gre_enabled) update(); });
  awR.addEventListener('input', e => { gmatState.gre_aw = parseFloat(e.target.value); awD.textContent = gmatState.gre_aw.toFixed(1); if (gmatState.gre_enabled) update(); });
  update();
}

// ============================================================
// Composite SBP control: 7 industries × {salary, n_reporting}
// 3-input row layout matches v2 exactly: salary number input + salary slider + n input
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
        <div class="flex items-center justify-between gap-2 mb-1">
          <p class="text-mini font-semibold text-white truncate" title="${occ}">${occ}</p>
          <span class="text-micro text-gray-500 whitespace-nowrap">${cmStr}</span>
        </div>
        <div class="sbp-row">
          <input type="number" id="sbp-sal-input-${safeKey}" data-occ="${occ}" data-role="salary-input"
                 class="sbp-salary-input"
                 min="${sld.min}" max="${sld.max}" step="${sld.step}" value="${Math.round(init.salary)}"
                 aria-label="${occ} median salary (number)" />
          <input type="range" id="sbp-sal-${safeKey}" data-occ="${occ}" data-role="salary"
                 min="${sld.min}" max="${sld.max}" step="${sld.step}" value="${init.salary}"
                 aria-label="${occ} median salary" />
          <input type="number" id="sbp-n-${safeKey}" data-occ="${occ}" data-role="n"
                 min="0" max="200" step="1" value="${init.n}"
                 class="bg-ink-800 border border-emerald-500/30 text-emerald-300 rounded px-1 py-0.5 text-micro font-mono text-right focus:outline-none focus:border-emerald-500"
                 style="width: 100%;" title="number of reporting graduates" aria-label="${occ} reporting count" />
        </div>
        <div class="flex justify-between mt-0.5">
          <span class="text-micro text-gray-500">salary $</span>
          <span class="text-micro text-gray-500">n reporting (&ge;3 to count)</span>
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="flex items-start justify-between gap-2 mb-1.5">
      <div class="min-w-0">
        <label class="text-xs font-semibold text-gray-300">Salary by Profession (cohort-relative)</label>
        <p class="text-micro text-gray-500 mt-0.5 leading-snug">n-weighted mean of (industry salary &divide; cohort mean). Industries with &lt;3 reporters excluded, mirroring US News.</p>
      </div>
      <span class="text-xs font-mono font-bold text-magenta-300 bg-magenta-500/10 px-2 py-0.5 rounded-md whitespace-nowrap" id="value-SalaryByProfession">&mdash;</span>
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
  // Slider drives both: state + paired number input
  wrap.querySelectorAll('input[data-role="salary"]').forEach(el => {
    el.addEventListener('input', e => {
      const occ = e.target.dataset.occ;
      const v = parseFloat(e.target.value);
      sbpState[occ].salary = v;
      const safeKey = occ.replace(/[^a-z0-9]+/gi, '_');
      const numInput = wrap.querySelector(`#sbp-sal-input-${safeKey}`);
      if (numInput) numInput.value = Math.round(v);
      update();
    });
  });
  // Number input drives both: state + paired slider
  wrap.querySelectorAll('input[data-role="salary-input"]').forEach(el => {
    const commit = (clamp = false) => {
      const occ = el.dataset.occ;
      const safeKey = occ.replace(/[^a-z0-9]+/gi, '_');
      const slider = wrap.querySelector(`#sbp-sal-${safeKey}`);
      let v = parseFloat(el.value);
      if (isNaN(v)) return;
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      if (clamp) v = Math.max(min, Math.min(max, v));
      sbpState[occ].salary = v;
      slider.value = Math.max(min, Math.min(max, v));
      update();
    };
    el.addEventListener('input', () => commit(false));
    el.addEventListener('blur', () => commit(true));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
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
    const errEl = slider.querySelector(`#error-${k}`);

    const validateInput = (val) => !isNaN(val) && val >= cfg.min && val <= cfg.max;
    const toggleError = (isInvalid) => {
      if (isInvalid) {
        errEl?.classList.remove('hidden');
        ni.classList.remove('border-magenta-500/40', 'text-magenta-300', 'focus:border-magenta-500');
        ni.classList.add('border-rose-500', 'text-rose-400', 'focus:border-rose-500');
      } else {
        errEl?.classList.add('hidden');
        ni.classList.add('border-magenta-500/40', 'text-magenta-300', 'focus:border-magenta-500');
        ni.classList.remove('border-rose-500', 'text-rose-400', 'focus:border-rose-500');
      }
    };
    const set = (val) => {
      val = Math.max(cfg.min, Math.min(cfg.max, val));
      currentValues[k] = val;
      r.value = val; ni.value = val;
      d.textContent = fmt(val, cfg.format);
      toggleError(false);
      fireChange();
    };
    r.addEventListener('input', e => set(parseFloat(e.target.value)));
    ni.addEventListener('input', e => toggleError(!validateInput(parseFloat(e.target.value))));
    const enterEditMode = () => { d.classList.add('hidden'); ni.classList.remove('hidden'); ni.focus(); ni.select(); };
    d.addEventListener('click', enterEditMode);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEditMode(); }
    });
    const commit = () => {
      const v = parseFloat(ni.value);
      if (validateInput(v)) set(v);
      else { ni.value = currentValues[k]; toggleError(false); }
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
    const payload = {
      scale: 'old', gmat_score: predictedCore.GMAT_Combined,
      gre_q: null, gre_v: null, gre_aw: null, gre_enabled: false, gmat_enabled: true,
    };
    const predBlended = computeBlendedGMAT(payload);
    currentValues.GMAT_Combined = payload;
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
      const salNum = sbpWrap.querySelector(`#sbp-sal-input-${safeKey}`);
      const nIn = sbpWrap.querySelector(`#sbp-n-${safeKey}`);
      if (sal) sal.value = sbpState[occ].salary;
      if (salNum) salNum.value = Math.round(sbpState[occ].salary);
      if (nIn) nIn.value = sbpState[occ].n;
    }
    const ratio = computeSBPRatio(sbpState);
    sbpWrap.querySelector('#value-SalaryByProfession').textContent = ratio !== null ? ratio.toFixed(3) : '—';
    currentValues.SalaryByProfession = { ...sbpState };
  }
  // Reset GMAT composite state + UI
  const wrap = document.getElementById('slider-GMAT_Combined');
  if (wrap) {
    const sd = gmatCfg.gmat_scale_default || 'old';
    const oldR = gmatCfg.gmat_old_range || { min: 200, max: 800, step: 5 };
    const newR = gmatCfg.gmat_new_range || { min: 205, max: 805, step: 5 };
    const qR = gmatCfg.gre_q_range, vR = gmatCfg.gre_v_range, awR = gmatCfg.gre_aw_range;
    const initG = sd === 'old' ? (gwuValues.gmat_old ?? Math.round((oldR.min + oldR.max) / 2)) : (gwuValues.gmat_new ?? Math.round((newR.min + newR.max) / 2));
    const initQ = gwuValues.gre_q ?? Math.round((qR.min + qR.max) / 2);
    const initV = gwuValues.gre_v ?? Math.round((vR.min + vR.max) / 2);
    const initAW = gwuValues.gre_aw ?? ((awR.min + awR.max) / 2);
    const greOn = !!gmatCfg.gre_default_enabled;
    gmatState = { scale: sd, gmat_score: initG, gre_q: initQ, gre_v: initV, gre_aw: initAW, gre_enabled: greOn, gmat_enabled: true };

    const r = wrap.querySelector('#range-GMAT_Score');
    const rg = sd === 'old' ? oldR : newR;
    r.min = rg.min; r.max = rg.max; r.step = rg.step; r.value = initG;
    wrap.querySelector('#gmat-score-display').textContent = Math.round(initG);
    wrap.querySelector('#gmat-min-label').textContent = rg.min;
    wrap.querySelector('#gmat-max-label').textContent = rg.max;
    wrap.querySelectorAll('.gmat-scale-btn').forEach(b => b.classList.toggle('active', b.dataset.gmatScale === sd));
    wrap.querySelector('#gmat-toggle').checked = true;
    wrap.querySelector('#gmat-controls').classList.remove('hidden');
    wrap.querySelector('#gre-toggle').checked = greOn;
    wrap.querySelector('#gre-controls').classList.toggle('hidden', !greOn);
    wrap.querySelector('#range-GRE_Q').value = initQ;
    wrap.querySelector('#range-GRE_V').value = initV;
    wrap.querySelector('#range-GRE_AW').value = initAW;
    wrap.querySelector('#gre-q-display').textContent = Math.round(initQ);
    wrap.querySelector('#gre-v-display').textContent = Math.round(initV);
    wrap.querySelector('#gre-aw-display').textContent = initAW.toFixed(1);

    const payload = {
      scale: sd, gmat_score: initG,
      gre_q: greOn ? initQ : null,
      gre_v: greOn ? initV : null,
      gre_aw: greOn ? initAW : null,
      gre_enabled: greOn, gmat_enabled: true,
    };
    const blended = computeBlendedGMAT(payload);
    wrap.querySelector('#value-GMAT_Combined').textContent = blended.toFixed(1);
    currentValues.GMAT_Combined = payload;
  }
  if (onChangeCallback) onChangeCallback({ ...currentValues });
}

export const getCurrentValues = () => ({ ...currentValues });
