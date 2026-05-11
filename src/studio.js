/**
 * The What-If Studio orchestrator.
 *
 * Wires:
 *   - Direct sliders  (9 indicators)
 *   - Indirect levers (CFM-driven)
 *   - Model selector  (5 engines)
 *   - Lever-mode toggle (direct | indirect — mutually exclusive)
 *   - Monte Carlo simulation -> rank/score/CI/chart
 *
 * Behavior:
 *   - Lever mode = direct (default): only direct slider edits drive the sim; indirect panel is dimmed and non-interactive.
 *   - Lever mode = indirect: only indirect lever edits drive the sim — they route through the CFMs to update the read-only direct sliders, which then feed the sim. The direct panel is dimmed and non-interactive.
 *   - Switching mode re-fires the simulation from the new mode's source-of-truth.
 *   - Model selector change re-simulates with the new engine without altering levers.
 */

import {
  loadModel, simulateRank,
  getGWUSchoolName, getGWUCurrentRank, getGWUCurrentScore,
  setCurrentEngine, getCurrentEngine, MODEL_KEYS, MODEL_META,
} from './model.js';
import { initSliders, resetSliders, setSlidersFromCfm, getCurrentValues } from './sliders.js';
import { initLeverSliders, resetLeverSliders, getLeverValues } from './lever-sliders.js';
import { getGwuPredictorValues, predictAllCoreFeatures } from './cfm-models.js';
import { updateResults, showCurrentInfo } from './results.js';

let lastSliderValues = null;
let currentMode = 'direct';   // 'direct' | 'indirect'

const MODE_COPY = {
  direct: '<strong class="text-white">Direct</strong> — simulation reads the nine US News methodology indicators straight from the sliders. Indirect levers are inactive.',
  indirect: '<strong class="text-white">Indirect</strong> — operational levers route through the Core Feature Models; the direct sliders display the CFM predictions read-only. Direct sliders are inactive.',
};

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
  const desc = document.getElementById('active-engine-desc');
  if (desc) {
    desc.innerHTML = `<strong style="color:${meta.color}">${meta.label}</strong> · ${meta.description}`;
  }
}

function applyModeToDom() {
  document.querySelectorAll('.mode-btn').forEach(b => {
    const active = b.dataset.mode === currentMode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.lever-panel').forEach(p => {
    p.classList.toggle('lever-inactive', p.dataset.leverPanel !== currentMode);
  });
  const desc = document.getElementById('mode-description');
  if (desc) desc.innerHTML = MODE_COPY[currentMode];
}

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  applyModeToDom();
  if (mode === 'direct') {
    // Direct sliders' current state becomes the source-of-truth.
    lastSliderValues = getCurrentValues();
    runSimulation();
  } else {
    // Re-run the latest indirect levers through the CFM → direct sliders.
    const row = { ...getGwuPredictorValues(), ...getLeverValues() };
    setSlidersFromCfm(predictAllCoreFeatures(row));
    lastSliderValues = getCurrentValues();
    runSimulation();
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
  if (currentMode !== 'direct') return;
  lastSliderValues = values;
  runSimulation();
}

function handleLeverChange(predictedCore /*, leverValues */) {
  if (currentMode !== 'indirect') return;
  // Indirect mode: CFM-predicted core features become the (read-only) direct slider state.
  setSlidersFromCfm(predictedCore);
  lastSliderValues = getCurrentValues();
  runSimulation();
}

export async function initStudio() {
  await loadModel();
  // Header info
  showCurrentInfo(getGWUSchoolName(), getGWUCurrentRank(), getGWUCurrentScore());
  // Model selector
  buildModelSelector('model-selector');
  // Direct sliders (initially the active mode)
  const initialValues = initSliders('direct-sliders-container', handleDirectChange);
  if (initialValues) {
    lastSliderValues = initialValues;
    runSimulation();
  }
  // Indirect levers (initialized but inactive on first render)
  initLeverSliders('lever-sliders-container', handleLeverChange);

  // Mode toggle wiring
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  applyModeToDom();

  // Reset button — semantics depend on current mode
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    resetSliders();
    resetLeverSliders();
    if (currentMode === 'direct') {
      lastSliderValues = getCurrentValues();
      runSimulation();
    }
    // Indirect: resetLeverSliders fires its own onChange that re-runs CFM → sim.
  });
}
