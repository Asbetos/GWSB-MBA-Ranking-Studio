/**
 * Indirect levers (CFM-driven). Sit alongside the direct sliders in the studio.
 * Whenever any lever moves, predict the 9 core features and bubble them up.
 */

import {
  getLeverMetadata,
  getGwuPredictorValues,
  predictAllCoreFeatures,
} from './cfm-models.js';

let leverValues = {};
let onChangeCallback = null;
let debounceTimer = null;

function fmt(format, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (format) {
    case 'percent': return `${(value * 100).toFixed(1)}%`;
    case 'dollar':  return `$${Math.round(value).toLocaleString()}`;
    case 'binary':  return value >= 0.5 ? 'Yes' : 'No';
    default:        return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
}

function buildLever(meta) {
  const id = `lever-${meta.key.replace(/[^a-z0-9]+/gi, '_')}`;
  const wrap = document.createElement('div');
  wrap.className = 'slider-container';
  wrap.dataset.leverKey = meta.key;
  wrap.innerHTML = `
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-xs font-semibold text-gray-300" for="${id}-range">${meta.label}</label>
      <span class="text-xs font-mono font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-md" data-role="value">${fmt(meta.format, meta.gwu_current)}</span>
    </div>
    <input type="range" id="${id}-range" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${meta.gwu_current}" />
    <div class="flex justify-between mt-1 text-[10px] text-gray-600">
      <span>${fmt(meta.format, meta.min)}</span>
      <span>${fmt(meta.format, meta.max)}</span>
    </div>
  `;
  return wrap;
}

function attachLever(wrap, meta) {
  const r = wrap.querySelector('input[type="range"]');
  const d = wrap.querySelector('[data-role="value"]');
  r.addEventListener('input', e => {
    let v = parseFloat(e.target.value);
    if (meta.format === 'binary') v = v >= 0.5 ? 1 : 0;
    leverValues[meta.key] = v;
    d.textContent = fmt(meta.format, v);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (onChangeCallback) {
        const row = { ...getGwuPredictorValues(), ...leverValues };
        const predicted = predictAllCoreFeatures(row);
        onChangeCallback(predicted, leverValues);
      }
    }, 200);
  });
}

export function initLeverSliders(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  onChangeCallback = onChange;
  const metadata = getLeverMetadata();
  for (const m of metadata) {
    leverValues[m.key] = m.gwu_current;
    const wrap = buildLever(m);
    attachLever(wrap, m);
    container.appendChild(wrap);
  }
  // Compute initial predicted core features
  if (onChangeCallback) {
    const row = { ...getGwuPredictorValues(), ...leverValues };
    onChangeCallback(predictAllCoreFeatures(row), leverValues);
  }
}

export function resetLeverSliders() {
  const metadata = getLeverMetadata();
  for (const m of metadata) {
    leverValues[m.key] = m.gwu_current;
    const wrap = document.querySelector(`[data-lever-key="${CSS.escape(m.key)}"]`);
    if (!wrap) continue;
    wrap.querySelector('input[type="range"]').value = m.gwu_current;
    wrap.querySelector('[data-role="value"]').textContent = fmt(m.format, m.gwu_current);
  }
  if (onChangeCallback) {
    const row = { ...getGwuPredictorValues(), ...leverValues };
    onChangeCallback(predictAllCoreFeatures(row), leverValues);
  }
}

export const getLeverValues = () => ({ ...leverValues });
