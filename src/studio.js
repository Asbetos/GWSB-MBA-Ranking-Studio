/**
 * The What-If Studio orchestrator.
 *
 * Wires:
 *   - Direct sliders  (9 indicators)
 *   - Indirect levers (CFM-driven)
 *   - Model selector  (5 engines)
 *   - Monte Carlo simulation -> rank/score/CI/chart
 *
 * Behavior:
 *   - Indirect lever change -> predicts the 9 core features -> updates direct sliders -> re-simulates.
 *   - Direct slider change  -> takes precedence over CFM prediction -> re-simulates.
 *   - Model selector change -> re-simulates with the new engine.
 *   - User can mix direct + indirect freely; the latest input on each indicator wins.
 */

import {
  loadModel, simulateRank,
  getGWUSchoolName, getGWUCurrentRank, getGWUCurrentScore,
  setCurrentEngine, getCurrentEngine, MODEL_KEYS, MODEL_META,
} from './model.js';
import { initSliders, resetSliders, setSlidersFromCfm, getCurrentValues } from './sliders.js';
import { initLeverSliders, resetLeverSliders } from './lever-sliders.js';
import { updateResults, showCurrentInfo } from './results.js';

let lastSliderValues = null;

function runSimulation() {
  if (!lastSliderValues) return;
  try {
    const results = simulateRank(lastSliderValues);
    updateResults(results);
    paintEngineBadge();
  } catch (err) {
    console.error('[studio] simulation failed', err);
  }
}

function paintEngineBadge() {
  const eng = getCurrentEngine();
  const meta = MODEL_META[eng];
  const badge = document.getElementById('active-engine-badge');
  if (badge) {
    badge.textContent = meta.label;
    badge.style.color = meta.color;
    badge.style.boxShadow = `0 0 12px ${meta.color}55`;
    badge.style.borderColor = `${meta.color}55`;
  }
  // Update rank display gradient to subtly reflect engine color
  const rankEl = document.getElementById('rank-display');
  if (rankEl) {
    rankEl.style.background = `linear-gradient(135deg, #ec4899 0%, ${meta.color} 50%, #06b6d4 100%)`;
    rankEl.style.backgroundClip = 'text';
    rankEl.style.webkitBackgroundClip = 'text';
    rankEl.style.color = 'transparent';
    rankEl.style.backgroundSize = '200% 200%';
  }
}

function buildModelSelector(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const k of MODEL_KEYS) {
    const meta = MODEL_META[k];
    const btn = document.createElement('button');
    btn.className = `model-btn ${meta.cssClass} ${k === getCurrentEngine() ? 'active' : ''}`;
    btn.dataset.engine = k;
    btn.innerHTML = `
      <span class="model-dot" style="background: ${meta.color};"></span>
      <span>${meta.label}</span>
    `;
    btn.title = meta.description;
    btn.addEventListener('click', () => {
      if (getCurrentEngine() === k) return;
      setCurrentEngine(k);
      wrap.querySelectorAll('.model-btn').forEach(b => b.classList.toggle('active', b.dataset.engine === k));
      runSimulation();
    });
    wrap.appendChild(btn);
  }
}

function handleDirectChange(values) {
  lastSliderValues = values;
  runSimulation();
}

function handleLeverChange(predictedCore /*, leverValues */) {
  // Update the direct sliders to reflect CFM-predicted core features.
  setSlidersFromCfm(predictedCore);
  // Pull the (now-updated) direct slider state and re-simulate.
  lastSliderValues = getCurrentValues();
  runSimulation();
}

export async function initStudio() {
  await loadModel();
  // Header info
  showCurrentInfo(getGWUSchoolName(), getGWUCurrentRank(), getGWUCurrentScore());
  // Model selector
  buildModelSelector('model-selector');
  // Direct sliders
  const initialValues = initSliders('direct-sliders-container', handleDirectChange);
  if (initialValues) handleDirectChange(initialValues);
  // Indirect levers
  initLeverSliders('lever-sliders-container', handleLeverChange);

  // Reset buttons
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    resetSliders();
    resetLeverSliders();
  });
}
