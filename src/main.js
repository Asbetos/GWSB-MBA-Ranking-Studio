/**
 * GWU Ranking Predictor v3 — Main bootstrap.
 */

import { loadCfmArtifacts } from './cfm-models.js';
import { initTabs } from './tabs.js';
import { initStudio } from './studio.js';
import { initModelInsightsTab } from './model-insights.js';
import { initMethodologyComparisonTab } from './methodology-comparison.js';

async function init() {
  try {
    console.log('[init] Loading CFM artifacts...');
    await loadCfmArtifacts();

    // Lazy-init handlers FIRST so the initial tab activation event fires through them.
    initModelInsightsTab();
    initMethodologyComparisonTab();
    initTabs();

    // Studio initialises the model artifacts + sliders + simulation pipeline.
    await initStudio();

    console.log('[init] App ready.');
  } catch (err) {
    console.error('[init] Failed:', err);
    showError(err.message);
  }
}

function showError(msg) {
  const r = document.getElementById('rank-display');
  if (r) { r.textContent = '⚠'; r.style.fontSize = '4rem'; }
  const sub = document.getElementById('rank-subtitle');
  if (sub) { sub.textContent = `Error: ${msg}`; sub.style.color = '#fb7185'; }
}

init();
