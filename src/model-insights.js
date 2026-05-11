/**
 * Tab — Model Insights.
 * Side-by-side performance for all 5 models, plus per-model details
 * (coefficients for ElasticNet, feature importances for tree models, layer
 * sizes for the MLP, meta-coefficients for Stacked).
 */

import Chart from 'chart.js/auto';
import { MODEL_KEYS, MODEL_META, getModelArtifact, getModelConfig } from './model.js';

let perfChart = null;
let importanceChart = null;
let inited = false;

const FEATURE_LABELS = {
  EmployedAtGrad: 'Employed at Grad',
  Employed3Mo: 'Employed 3-mo',
  AvgSalaryBonus: 'Salary + Bonus',
  SalaryByProfession: 'Salary by Profession',
  MedianGPA: 'Median GPA',
  AcceptanceRate: 'Acceptance Rate',
  PeerScore: 'Peer Score',
  RecruiterScore: 'Recruiter Score',
  GMAT_Combined: 'GMAT/GRE Blended',
};

function fmtN(v, d = 3) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(d);
}

function renderPerformanceMatrix() {
  const wrap = document.getElementById('mi-perf-matrix');
  if (!wrap) return;
  const rows = MODEL_KEYS.map(k => {
    const a = getModelArtifact(k);
    const p = a.performance_cv || {};
    const meta = MODEL_META[k];
    return `
      <tr class="border-b border-white/5 hover:bg-white/[0.02]">
        <td class="py-2.5 px-3 text-sm text-white">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="model-dot" style="background:${meta.color}; width:0.6rem; height:0.6rem; border-radius:9999px; box-shadow:0 0 8px ${meta.color}88; display:inline-block; flex-shrink:0;" aria-hidden="true"></span>
            <span class="font-semibold">${meta.label}</span>
            <span class="text-micro text-gray-500">${meta.short}</span>
          </div>
          <p class="text-micro text-gray-500 mt-0.5 leading-snug">${meta.description}</p>
        </td>
        <td class="py-2.5 px-3 text-right font-mono text-sm whitespace-nowrap" style="color:${meta.color}">${fmtN(p.mae, 2)}</td>
        <td class="py-2.5 px-3 text-right font-mono text-sm text-gray-200 whitespace-nowrap">${fmtN(p.rmse, 2)}</td>
        <td class="py-2.5 px-3 text-right font-mono text-sm text-gray-200 whitespace-nowrap">${fmtN(p.r2, 4)}</td>
        <td class="py-2.5 px-3 text-right font-mono text-sm text-gray-200 whitespace-nowrap">${fmtN(p.spearman, 4)}</td>
      </tr>
    `;
  }).join('');
  wrap.innerHTML = `
    <table class="w-full text-sm" style="min-width: 520px;">
      <thead>
        <tr class="text-gray-500 text-micro uppercase tracking-widest border-b border-white/10">
          <th class="text-left py-2 px-3 font-medium">Engine</th>
          <th class="text-right py-2 px-3 font-medium whitespace-nowrap" title="Mean Absolute Error — average score miss in published-score points.">MAE</th>
          <th class="text-right py-2 px-3 font-medium whitespace-nowrap" title="Root Mean Squared Error — penalizes large misses more than MAE.">RMSE</th>
          <th class="text-right py-2 px-3 font-medium whitespace-nowrap" title="Coefficient of determination — share of score variance explained; 1.00 = perfect.">R&sup2;</th>
          <th class="text-right py-2 px-3 font-medium whitespace-nowrap" title="Rank-order correlation against US News' published ranking; 1.00 = identical ordering.">Spearman &rho;</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="text-micro text-gray-500 mt-3 leading-snug">5-fold CV on the stacked 2024 + 2025 panel. MAE/RMSE: lower is better. R&sup2;, Spearman &rho;: higher is better. Read across rows to compare engines on the same metric; engines that agree on R&sup2; but diverge on Spearman &rho; are mis-ordering schools without mis-scoring them.</p>
  `;
}

function renderPerformanceChart() {
  const canvas = document.getElementById('mi-perf-chart');
  if (!canvas) return;
  const labels = MODEL_KEYS.map(k => MODEL_META[k].short);
  const colors = MODEL_KEYS.map(k => MODEL_META[k].color);
  const r2 = MODEL_KEYS.map(k => getModelArtifact(k).performance_cv?.r2 ?? 0);
  const mae = MODEL_KEYS.map(k => getModelArtifact(k).performance_cv?.mae ?? 0);

  if (perfChart) perfChart.destroy();
  perfChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'R² (CV)', data: r2, yAxisID: 'y1', backgroundColor: colors.map(c => c + 'cc'), borderRadius: 4 },
        { label: 'MAE (CV, lower better)', data: mae, yAxisID: 'y2', backgroundColor: colors.map(c => c + '66'), borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#c4b5fd', font: { size: 11 } } },
        tooltip: { backgroundColor: 'rgba(13, 5, 23, 0.95)' },
      },
      scales: {
        y1: { type: 'linear', position: 'left', min: 0.9, max: 1.0,
              ticks: { color: '#c4b5fd', callback: v => v.toFixed(3) },
              grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'R²', color: '#c4b5fd' } },
        y2: { type: 'linear', position: 'right', min: 0,
              ticks: { color: '#fb7185' }, grid: { display: false },
              title: { display: true, text: 'MAE', color: '#fb7185' } },
        x: { ticks: { color: '#a78bfa', font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderImportanceForModel(modelKey) {
  const canvas = document.getElementById('mi-importance-chart');
  const titleEl = document.getElementById('mi-importance-title');
  const subEl = document.getElementById('mi-importance-sub');
  if (!canvas) return;
  const a = getModelArtifact(modelKey);
  const meta = MODEL_META[modelKey];
  let labels, values, sub;

  if (modelKey === 'elasticnet') {
    labels = a.feature_names.map(f => FEATURE_LABELS[f] || f);
    values = a.coef.slice();
    sub = 'Standardized linear coefficients (signed). One-σ change in the indicator → Δ predicted score = bar value. Same coefficients as v2\'s Direct Score Model.';
  } else if (modelKey === 'randomforest' || modelKey === 'gradientboost') {
    labels = a.feature_names.map(f => FEATURE_LABELS[f] || f);
    values = (a.feature_importances || []).slice();
    sub = modelKey === 'randomforest'
      ? 'Random Forest feature importances (mean impurity decrease across all trees). Unsigned — magnitude reflects how often and how strongly the feature splits the data; direction must be inferred from partial dependence.'
      : 'Gradient Boosting feature importances (cumulative gain across boosting rounds). Unsigned — large magnitudes flag features the boosting sequence relies on most heavily.';
  } else if (modelKey === 'mlp') {
    // No first-class importance; use the L1 norm of input weights to first hidden layer
    labels = a.feature_names.map(f => FEATURE_LABELS[f] || f);
    const W0 = a.weights[0];
    values = W0.map(rowW => rowW.reduce((s, v) => s + Math.abs(v), 0));
    sub = `MLP input-layer leverage — L1 norm of each feature's weights into the first hidden layer (unsigned). Architecture: ${a.layer_sizes.join(' → ')}, ReLU activations. A proxy for influence in the absence of a closed-form importance.`;
  } else if (modelKey === 'stacked') {
    labels = a.base_order.map(n => MODEL_META[n].label);
    values = a.meta_coef.slice();
    sub = `Ridge meta-learner weights over the four base-engine predictions (signed). Intercept = ${fmtN(a.meta_intercept, 2)}. Weights sum to ≈ 1 and reveal which base engines the ensemble leans on for this panel.`;
  }

  // Sort by |value| desc
  const order = labels.map((_, i) => i).sort((a, b) => Math.abs(values[b]) - Math.abs(values[a]));
  const labelsS = order.map(i => labels[i]);
  const valuesS = order.map(i => values[i]);
  const colors = valuesS.map(v => v >= 0 ? meta.color + 'cc' : '#fb7185cc');

  if (importanceChart) importanceChart.destroy();
  importanceChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: labelsS, datasets: [{ data: valuesS, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: 'rgba(13, 5, 23, 0.95)', callbacks: { label: (it) => fmtN(it.raw, 4) } },
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#c4b5fd', font: { size: 11 } }, grid: { display: false } },
      },
    },
  });

  if (titleEl) {
    titleEl.innerHTML = `
      <span class="model-dot mr-2" style="background:${meta.color}; width:0.7rem; height:0.7rem; border-radius:9999px; box-shadow:0 0 10px ${meta.color}88; display:inline-block;"></span>
      ${meta.label} — feature signals
    `;
  }
  if (subEl) subEl.textContent = sub;
}

function attachInsightHandlers() {
  const wrap = document.getElementById('mi-model-picker');
  if (!wrap) return;
  wrap.innerHTML = '';
  let activeKey = 'stacked';
  for (const k of MODEL_KEYS) {
    const meta = MODEL_META[k];
    const btn = document.createElement('button');
    btn.className = `model-btn ${meta.cssClass} ${k === activeKey ? 'active' : ''}`;
    btn.dataset.modelKey = k;
    btn.innerHTML = `<span class="model-dot" style="background:${meta.color};"></span><span>${meta.label}</span>`;
    btn.addEventListener('click', () => {
      activeKey = k;
      wrap.querySelectorAll('.model-btn').forEach(b => b.classList.toggle('active', b.dataset.modelKey === k));
      renderImportanceForModel(k);
    });
    wrap.appendChild(btn);
  }
  renderImportanceForModel(activeKey);
}

export function renderModelInsights() {
  if (inited) return;
  renderPerformanceMatrix();
  renderPerformanceChart();
  attachInsightHandlers();
  inited = true;
}

export function initModelInsightsTab() {
  document.addEventListener('tab:activated', e => {
    if (e.detail?.tabKey === 'insights') renderModelInsights();
  });
}
