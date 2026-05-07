/**
 * Indirect levers — grouped by the core feature each primarily affects, and
 * with submission-percentage levers reframed as absolute submitter counts
 * (more intuitive than fractions).
 */

import {
  getLeverMetadata, getGwuPredictorValues,
  predictAllCoreFeatures, getLeverPrimaryTargets, getCoreTargetLabel,
  getCfmTopFeatures, getCoreTargetSummaries,
} from './cfm-models.js';
import { getGWUValues } from './model.js';

let leverValues = {};       // canonical: keys are CFM feature names; submission %s stored as fractions
let onChangeCallback = null;
let debounceTimer = null;

// Levers that we render as ABSOLUTE COUNT instead of a percentage; the JS
// silently divides by full-time enrollment before passing to the CFM.
const COUNT_LEVERS = new Set([
  'gmat_data.percent_new_entrants_providing_gmat_old',
  'gmat_data.percent_new_entrants_providing_gmat_new',
  'gre_data.percent_new_entrants_providing_gre',
  'gpa_data.percent_new_entrants_providing_gpa',
  'specialty_masters_admissions.percent_providing_gpa',
  'specialty_masters_admissions.percent_providing_gre',
]);

const CORE_LABELS_FALLBACK = {
  EmployedAtGrad: 'Employed at Graduation',
  Employed3Mo: 'Employed 3 Months After',
  AvgSalaryBonus: 'Avg Salary + Bonus',
  MedianGPA: 'Median GPA',
  AcceptanceRate: 'Acceptance Rate',
  PeerScore: 'Peer Assessment',
  RecruiterScore: 'Recruiter Assessment',
  GMAT_Combined: 'GMAT/GRE Blended',
};

const CORE_COLORS = {
  EmployedAtGrad: '#34d399',
  Employed3Mo: '#22d3ee',
  AvgSalaryBonus: '#fbbf24',
  MedianGPA: '#a78bfa',
  AcceptanceRate: '#fb7185',
  PeerScore: '#f472b6',
  RecruiterScore: '#67e8f9',
  GMAT_Combined: '#84cc16',
  unranked: '#6b7280',
};

function fmt(format, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (format) {
    case 'percent': return `${(value * 100).toFixed(1)}%`;
    case 'dollar':  return `$${Math.round(value).toLocaleString()}`;
    case 'binary':  return value >= 0.5 ? 'Yes' : 'No';
    default:        return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
}

function getEnrollment() {
  const v = getGWUValues()?.fulltime_enrollment;
  return (v && v > 0) ? v : 73;     // GWU default fallback
}

function buildSimpleLever(meta) {
  const id = `lever-${meta.key.replace(/[^a-z0-9]+/gi, '_')}`;
  const wrap = document.createElement('div');
  wrap.className = 'slider-container';
  wrap.dataset.leverKey = meta.key;
  wrap.innerHTML = `
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-[11px] font-semibold text-gray-300 truncate" for="${id}-range" title="${meta.label}">${meta.label}</label>
      <span class="text-[11px] font-mono font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-md whitespace-nowrap" data-role="value">${fmt(meta.format, meta.gwu_current)}</span>
    </div>
    <input type="range" id="${id}-range" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${meta.gwu_current}" />
    <div class="flex justify-between mt-0.5 text-[9px] text-gray-600">
      <span>${fmt(meta.format, meta.min)}</span>
      <span>${fmt(meta.format, meta.max)}</span>
    </div>
  `;
  return wrap;
}

function buildCountLever(meta, enrollment) {
  // Reframe a fractional 0..1 lever as an absolute count 0..enrollment.
  const id = `lever-${meta.key.replace(/[^a-z0-9]+/gi, '_')}`;
  const initialCount = Math.round((meta.gwu_current ?? 0) * enrollment);
  const max = Math.max(enrollment, 100);
  const wrap = document.createElement('div');
  wrap.className = 'slider-container';
  wrap.dataset.leverKey = meta.key;
  wrap.dataset.role = 'count';
  wrap.innerHTML = `
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-[11px] font-semibold text-gray-300 truncate" for="${id}-range" title="${meta.label}">${meta.label}</label>
      <span class="text-[11px] font-mono font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-md whitespace-nowrap" data-role="value">${initialCount} of ${enrollment}</span>
    </div>
    <input type="range" id="${id}-range" min="0" max="${max}" step="1" value="${initialCount}" />
    <div class="flex justify-between mt-0.5 text-[9px] text-gray-600">
      <span>0</span>
      <span>${max}</span>
    </div>
  `;
  return wrap;
}

function attachLever(wrap, meta, enrollment) {
  const r = wrap.querySelector('input[type="range"]');
  const d = wrap.querySelector('[data-role="value"]');
  const isCount = wrap.dataset.role === 'count';
  r.addEventListener('input', e => {
    let displayVal;
    let storedFraction;     // what we send to the CFM
    if (isCount) {
      const cnt = parseInt(e.target.value, 10);
      displayVal = `${cnt} of ${enrollment}`;
      storedFraction = enrollment > 0 ? cnt / enrollment : 0;
    } else {
      let v = parseFloat(e.target.value);
      if (meta.format === 'binary') v = v >= 0.5 ? 1 : 0;
      displayVal = fmt(meta.format, v);
      storedFraction = v;
    }
    leverValues[meta.key] = storedFraction;
    d.textContent = displayVal;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (onChangeCallback) {
        const row = { ...getGwuPredictorValues(), ...leverValues };
        onChangeCallback(predictAllCoreFeatures(row), leverValues);
      }
    }, 200);
  });
}

function buildCfmPopover(target, label) {
  if (!target || target === 'unranked') return '';
  const top = getCfmTopFeatures(target, 8);
  if (!top.length) return '';
  const totalAbs = top.reduce((s, t) => s + Math.abs(t.coefficient), 0) || 1;
  const summaries = getCoreTargetSummaries() || [];
  const conf = (summaries.find(s => s.target_name === target) || {}).confidence || {};
  const rows = top.map(f => {
    const sign = f.coefficient >= 0 ? '+' : '−';
    const cls = f.coefficient >= 0 ? 'text-emerald-300' : 'text-rose-300';
    const pct = (Math.abs(f.coefficient) / totalAbs) * 100;
    const labelClean = f.feature.replace(/_/g, ' ').replace(/^[a-z_]+\./i, '').slice(0, 38);
    return `
      <div class="feat-row">
        <span class="feat-name" title="${f.feature}">${labelClean}</span>
        <span class="feat-bar-track"><span class="feat-bar" style="width: ${Math.min(100, pct).toFixed(1)}%"></span></span>
        <span class="feat-pct"><span class="${cls}">${sign}</span>${pct.toFixed(1)}%</span>
      </div>
    `;
  }).join('');
  const confBadge = conf.label
    ? `<span class="confidence-pill confidence-${conf.tone}">${conf.label}</span>`
    : '';
  return `
    <div class="cfm-hover-popover" role="tooltip">
      <div class="flex items-center justify-between mb-1.5">
        <h4>CFM · ${label}</h4>
        ${confBadge}
      </div>
      <div class="space-y-0.5">${rows}</div>
      <p class="text-[10px] text-gray-500 mt-2">% = |coefficient| share among the top 8 features used to predict ${label}.</p>
    </div>
  `;
}

function buildSection(target, label, levers, enrollment) {
  const sec = document.createElement('div');
  sec.className = 'lever-group';
  sec.dataset.target = target;
  const color = CORE_COLORS[target] || '#6b7280';
  const popover = buildCfmPopover(target, label);
  sec.innerHTML = `
    <div class="flex items-center gap-2 mt-2 mb-1.5 cfm-hover-host" tabindex="0" style="cursor: help;">
      <span class="lever-group-pip" style="background:${color}; box-shadow:0 0 8px ${color}aa;"></span>
      <p class="text-xs font-bold uppercase tracking-widest" style="color:${color}">${label}</p>
      <span class="text-[10px] text-gray-500">${levers.length} lever${levers.length === 1 ? '' : 's'} · hover for CFM features</span>
      ${popover}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 lever-section-${target}"></div>
  `;
  const grid = sec.querySelector(`.lever-section-${target}`);
  for (const meta of levers) {
    const isCount = COUNT_LEVERS.has(meta.key);
    const wrap = isCount ? buildCountLever(meta, enrollment) : buildSimpleLever(meta);
    attachLever(wrap, meta, enrollment);
    grid.appendChild(wrap);
  }
  return sec;
}

export function initLeverSliders(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  onChangeCallback = onChange;
  const metadata = getLeverMetadata();
  const primaries = getLeverPrimaryTargets();
  const enrollment = getEnrollment();

  // Group levers by primary affected core feature
  const groups = {};
  for (const m of metadata) {
    leverValues[m.key] = m.gwu_current;
    const target = primaries[m.key]?.target || 'unranked';
    if (!groups[target]) groups[target] = [];
    groups[target].push(m);
  }

  // Render groups in a sensible order
  const orderedTargets = [
    'AvgSalaryBonus', 'PeerScore', 'RecruiterScore', 'MedianGPA',
    'GMAT_Combined', 'AcceptanceRate', 'Employed3Mo', 'EmployedAtGrad', 'unranked',
  ];
  for (const target of orderedTargets) {
    if (!groups[target]?.length) continue;
    const label = CORE_LABELS_FALLBACK[target] || (target === 'unranked' ? 'Other' : target);
    container.appendChild(buildSection(target, label, groups[target], enrollment));
  }

  if (onChangeCallback) {
    const row = { ...getGwuPredictorValues(), ...leverValues };
    onChangeCallback(predictAllCoreFeatures(row), leverValues);
  }
}

export function resetLeverSliders() {
  const metadata = getLeverMetadata();
  const enrollment = getEnrollment();
  for (const m of metadata) {
    leverValues[m.key] = m.gwu_current;
    const wrap = document.querySelector(`[data-lever-key="${CSS.escape(m.key)}"]`);
    if (!wrap) continue;
    const isCount = COUNT_LEVERS.has(m.key);
    if (isCount) {
      const cnt = Math.round((m.gwu_current ?? 0) * enrollment);
      wrap.querySelector('input[type="range"]').value = cnt;
      wrap.querySelector('[data-role="value"]').textContent = `${cnt} of ${enrollment}`;
    } else {
      wrap.querySelector('input[type="range"]').value = m.gwu_current;
      wrap.querySelector('[data-role="value"]').textContent = fmt(m.format, m.gwu_current);
    }
  }
  if (onChangeCallback) {
    const row = { ...getGwuPredictorValues(), ...leverValues };
    onChangeCallback(predictAllCoreFeatures(row), leverValues);
  }
}

export const getLeverValues = () => ({ ...leverValues });
