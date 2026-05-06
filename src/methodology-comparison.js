/**
 * Tab — Methodology Comparison.
 * Per-school: Published rank/score vs. all 5 models' predicted rank/score.
 * Sortable by absolute disagreement, searchable, with summary correlations.
 */

import { getMethodologyComparison, MODEL_KEYS, MODEL_META } from './model.js';

let cmpData = null;
let sortKey = 'published_rank';
let searchTerm = '';
let inited = false;

function abs(x) { return Math.abs(x); }

function decoratedRows() {
  if (!cmpData) return [];
  return cmpData.rows.map(r => {
    const out = { ...r };
    for (const k of MODEL_KEYS) {
      out[`${k}_score_delta`] = r[`${k}_score`] - r.published_score;
      out[`${k}_rank_delta`] = r[`${k}_rank`] - r.published_rank;
    }
    return out;
  });
}

function pearson(a, b) {
  const n = a.length;
  if (n === 0) return 0;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i]-ma)*(b[i]-mb); va += (a[i]-ma)**2; vb += (b[i]-mb)**2; }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

function renderSummary() {
  const wrap = document.getElementById('cmp-summary-cards');
  if (!wrap) return;
  const rows = decoratedRows();
  const pubR = rows.map(r => r.published_rank);
  wrap.innerHTML = MODEL_KEYS.map(k => {
    const meta = MODEL_META[k];
    const ranks = rows.map(r => r[`${k}_rank`]);
    const meanAbsRank = rows.reduce((s, r) => s + abs(r[`${k}_rank_delta`]), 0) / rows.length;
    const meanAbsScore = rows.reduce((s, r) => s + abs(r[`${k}_score_delta`]), 0) / rows.length;
    const rho = pearson(pubR, ranks);
    return `
      <div class="glass-panel p-4">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="model-dot" style="background:${meta.color}; width:0.6rem; height:0.6rem; border-radius:9999px; box-shadow:0 0 8px ${meta.color}88;"></span>
          <p class="text-[10px] uppercase tracking-widest" style="color:${meta.color}">${meta.label}</p>
        </div>
        <p class="text-2xl font-bold text-white font-mono">ρ = ${rho.toFixed(3)}</p>
        <p class="text-[10px] text-gray-500 mt-1">Mean |Δrank| ${meanAbsRank.toFixed(1)} · Mean |Δscore| ${meanAbsScore.toFixed(1)}</p>
      </div>
    `;
  }).join('');
}

function deltaCell(value, pp = 0) {
  if (value == null || Number.isNaN(value)) return '<span class="text-gray-700">—</span>';
  const cls = value >= 0 ? 'text-emerald-300' : 'text-rose-300';
  const sign = value >= 0 ? '+' : '−';
  return `<span class="${cls} font-mono text-xs">${sign}${abs(value).toFixed(pp)}</span>`;
}

function renderTable() {
  const wrap = document.getElementById('cmp-table-wrap');
  if (!wrap) return;
  let rows = decoratedRows();
  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    rows = rows.filter(r => r.school.toLowerCase().includes(t));
  }
  rows = rows.slice().sort((a, b) => {
    if (sortKey === 'published_rank') return a.published_rank - b.published_rank;
    return abs(b[sortKey]) - abs(a[sortKey]);
  });

  const headerCells = MODEL_KEYS.map(k => {
    const meta = MODEL_META[k];
    return `
      <th class="text-right py-2 px-2 font-medium" style="color:${meta.color}" colspan="2">${meta.short}</th>
    `;
  }).join('');
  const subHeaderCells = MODEL_KEYS.map(() => `<th class="text-right py-1 px-2 text-[9px] font-medium text-gray-500">Rank</th><th class="text-right py-1 px-2 text-[9px] font-medium text-gray-500">Δ</th>`).join('');

  const body = rows.map(r => {
    const cells = MODEL_KEYS.map(k => `
      <td class="py-1.5 px-2 text-right font-mono text-xs" style="color:${MODEL_META[k].color}cc">#${r[`${k}_rank`]}</td>
      <td class="py-1.5 px-2 text-right">${deltaCell(r[`${k}_rank_delta`], 0)}</td>
    `).join('');
    return `
      <tr class="border-b border-white/5 hover:bg-white/[0.02]">
        <td class="py-2 px-2 text-xs text-white truncate" style="max-width: 220px;" title="${r.school}">${r.school}</td>
        <td class="py-2 px-2 text-right font-mono text-xs text-gray-200">#${r.published_rank}</td>
        <td class="py-2 px-2 text-right font-mono text-xs text-gray-300">${r.published_score.toFixed(1)}</td>
        ${cells}
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <table class="w-full text-sm">
      <thead class="sticky top-0 bg-ink-900/95 backdrop-blur-sm z-10">
        <tr class="text-gray-500 text-[10px] uppercase tracking-widest border-b border-white/10">
          <th class="text-left py-2 px-2 font-medium" rowspan="2">School</th>
          <th class="text-right py-2 px-2 font-medium" rowspan="2">Pub Rk</th>
          <th class="text-right py-2 px-2 font-medium" rowspan="2">Pub Sc</th>
          ${headerCells}
        </tr>
        <tr class="border-b border-white/10">${subHeaderCells}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function attachHandlers() {
  const search = document.getElementById('cmp-search');
  if (search) search.addEventListener('input', e => { searchTerm = e.target.value; renderTable(); });

  const sortWrap = document.getElementById('cmp-sort-buttons');
  if (sortWrap) {
    sortWrap.innerHTML = `
      <button data-sort="published_rank" class="cmp-sort-btn active">Published rank</button>
      ${MODEL_KEYS.map(k => `<button data-sort="${k}_rank_delta" class="cmp-sort-btn">|Δ ${MODEL_META[k].short}|</button>`).join('')}
    `;
    sortWrap.querySelectorAll('.cmp-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sortKey = btn.dataset.sort;
        sortWrap.querySelectorAll('.cmp-sort-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderTable();
      });
    });
  }
}

export function renderMethodologyComparison() {
  if (inited) return;
  cmpData = getMethodologyComparison();
  if (!cmpData) return;
  renderSummary();
  attachHandlers();
  renderTable();
  inited = true;
}

export function initMethodologyComparisonTab() {
  document.addEventListener('tab:activated', e => {
    if (e.detail?.tabKey === 'comparison') renderMethodologyComparison();
  });
}
