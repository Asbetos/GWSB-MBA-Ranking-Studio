/**
 * v3 Multi-Model Inference Engine.
 *
 * Loads 5 model artifacts and provides a unified `predictScore(features)` that
 * dispatches based on the currently-selected engine. Tree-based models
 * (RandomForest, GradientBoost) traverse exported tree arrays. The MLP runs a
 * dense forward pass with ReLU activations. The Stacked ensemble combines the
 * 4 base models via a Ridge meta-learner.
 *
 * The Monte Carlo simulator and the GMAT/GRE blender are model-agnostic.
 */

// ---------- Loaded artifacts ----------
let modelConfig = null;
let scalerParams = null;
let dataSnapshot = null;
let featureRanges = null;
let gmatCurves = null;
let methodologyComparison = null;

const models = {
  elasticnet: null,
  randomforest: null,
  gradientboost: null,
  mlp: null,
  stacked: null,
};

let currentEngine = 'stacked';   // sane default — best out-of-sample fit

const ARTIFACTS_BASE = '/model_artifacts';

export const MODEL_KEYS = ['elasticnet', 'randomforest', 'gradientboost', 'mlp', 'stacked'];

export const MODEL_META = {
  elasticnet: {
    label: 'ElasticNet',
    short: 'Linear',
    description: 'L1+L2 penalized linear regression — the same engine as v2\'s Direct Score Model. Signed, interpretable coefficients; best when indicator effects are roughly additive.',
    cssClass: 'model-elasticnet',
    color: '#a78bfa',
  },
  randomforest: {
    label: 'Random Forest',
    short: 'RF',
    description: 'Bagged regression trees with feature subsampling. Captures non-linear thresholds and pairwise interactions; importances are unsigned (variance-reduction).',
    cssClass: 'model-randomforest',
    color: '#34d399',
  },
  gradientboost: {
    label: 'Gradient Boosting',
    short: 'GBM',
    description: 'Sequentially-boosted shallow trees. Strongest single-model in-sample fit; regularized via tree depth and learning rate to control overfitting on the small panel.',
    cssClass: 'model-gradientboost',
    color: '#fbbf24',
  },
  mlp: {
    label: 'Neural Network',
    short: 'MLP',
    description: 'Three-hidden-layer MLP (64→32→16, ReLU). Universal function approximator on this sample; importance is approximated via L1 magnitude of input-layer weights.',
    cssClass: 'model-mlp',
    color: '#fb7185',
  },
  stacked: {
    label: 'Stacked Ensemble',
    short: 'Ensemble',
    description: 'Ridge meta-learner over the four base predictions. Lowest out-of-sample error on this panel; default engine for the workbench.',
    cssClass: 'model-stacked',
    color: '#22d3ee',
  },
};

export async function loadModel() {
  const [config, scaler, snapshot, ranges, curves, en, rf, gb, mlp, stk, cmp] = await Promise.all([
    fetch(`${ARTIFACTS_BASE}/model_config.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/scaler_params.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/data_snapshot.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/feature_ranges.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/gmat_inference_curves.json`).then(r => r.json()).catch(() => null),
    fetch(`${ARTIFACTS_BASE}/model_elasticnet.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/model_randomforest.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/model_gradientboost.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/model_mlp.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/model_stacked.json`).then(r => r.json()),
    fetch(`${ARTIFACTS_BASE}/methodology_comparison.json`).then(r => r.json()).catch(() => null),
  ]);
  modelConfig = config;
  scalerParams = scaler;
  dataSnapshot = snapshot;
  featureRanges = ranges;
  gmatCurves = curves;
  models.elasticnet = en;
  models.randomforest = rf;
  models.gradientboost = gb;
  models.mlp = mlp;
  models.stacked = stk;
  methodologyComparison = cmp;
  return { modelConfig, featureRanges, dataSnapshot };
}

// ---------- accessors ----------
export const getModelConfig = () => modelConfig;
export const getFeatureRanges = () => featureRanges;
export const getGWUValues = () => featureRanges?._gwu_current || {};
export const getGWUSchoolName = () => featureRanges?._gwu_school_name || 'George Washington University';
export const getGWUCurrentRank = () => featureRanges?._gwu_current_rank || null;
export const getGWUCurrentScore = () => featureRanges?._gwu_current_score || null;
export const getGmatInputConfig = () => featureRanges?._gmat_input_config || {};

export function getSbpConfig() {
  return {
    cohort:      featureRanges?._sbp_cohort      || {},
    occupations: featureRanges?._sbp_occupations || [],
    slider:      featureRanges?._sbp_slider      || { min: 60000, max: 260000, step: 1000, format: 'dollar' },
  };
}

export function computeSBPRatio(perOccupation) {
  const cohort = featureRanges?._sbp_cohort || {};
  const MIN_N = 3;
  let ratio_sum = 0, n_sum = 0;
  for (const [occ, info] of Object.entries(perOccupation || {})) {
    const cm = cohort[occ]?.cohort_mean;
    if (!cm || cm <= 0) continue;
    const sal = Number(info?.salary);
    const n = Number(info?.n);
    if (!isFinite(sal) || sal <= 0 || !isFinite(n) || n < MIN_N) continue;
    ratio_sum += (sal / cm) * n;
    n_sum += n;
  }
  return n_sum > 0 ? ratio_sum / n_sum : null;
}
export const getDataSnapshot = () => dataSnapshot;
export const getMethodologyComparison = () => methodologyComparison;
export const getCurrentEngine = () => currentEngine;
export const setCurrentEngine = (e) => { if (MODEL_KEYS.includes(e)) currentEngine = e; };
export const getModelArtifact = (key) => models[key];
export const getAllModels = () => ({ ...models });

// ============================================================
// GMAT/GRE blender (5-distribution, 40/40/20 GRE internal)
// ============================================================

function percentileRank(score, sortedArr) {
  if (!sortedArr || sortedArr.length === 0 || score == null || Number.isNaN(score)) return null;
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedArr[mid] < score) lo = mid + 1; else hi = mid;
  }
  let upper = lo;
  while (upper < sortedArr.length && sortedArr[upper] === score) upper++;
  return (lo + upper + 1) / 2 / sortedArr.length;
}

export function computeBlendedGMAT({ scale, gmat_score, gre_q, gre_v, gre_aw, gre_enabled }) {
  if (!gmatCurves) return gmat_score ?? 0;
  let p_old = 0, p_new = 0, p_gre = 0;
  let r_old = null, r_new = null, r_gre = null;

  if (scale === 'old' && gmat_score != null) {
    r_old = percentileRank(gmat_score, gmatCurves.gmat_old);
    if (r_old !== null) p_old = 1;
  } else if (scale === 'new' && gmat_score != null) {
    r_new = percentileRank(gmat_score, gmatCurves.gmat_new);
    if (r_new !== null) p_new = 1;
  }
  if (gre_enabled) {
    const rq = gre_q != null ? percentileRank(gre_q, gmatCurves.gre_q) : null;
    const rv = gre_v != null ? percentileRank(gre_v, gmatCurves.gre_v) : null;
    const ra = gre_aw != null ? percentileRank(gre_aw, gmatCurves.gre_aw) : null;
    if (rq !== null && rv !== null && ra !== null) r_gre = 0.4 * rq + 0.4 * rv + 0.2 * ra;
    else if (rq !== null && rv !== null) r_gre = 0.5 * rq + 0.5 * rv;
    else if (rq !== null) r_gre = rq;
    else if (rv !== null) r_gre = rv;
    if (r_gre !== null) p_gre = 1;
  }

  const total = p_old + p_new + p_gre;
  if (total <= 0) return 0;
  const blended = (p_old * (r_old || 0) + p_new * (r_new || 0) + p_gre * (r_gre || 0)) / total;
  return Math.max(0, Math.min(100, blended * 100));
}

// ============================================================
// Per-model inference primitives
// ============================================================

function applyScaler(featureVec) {
  return featureVec.map((x, i) => (x - scalerParams.mean[i]) / scalerParams.scale[i]);
}

// --- ElasticNet: dot product
function predictLinear(scaled, art) {
  let s = art.intercept;
  for (let i = 0; i < scaled.length; i++) s += scaled[i] * art.coef[i];
  return s + (art.calibration_intercept || 0);
}

// --- Decision tree traversal: returns scalar leaf value
function traverseTree(tree, scaled) {
  let node = 0;
  while (tree.feature[node] !== -2) {       // -2 = TREE_UNDEFINED == leaf
    const f = tree.feature[node];
    if (scaled[f] <= tree.threshold[node]) node = tree.children_left[node];
    else node = tree.children_right[node];
  }
  return tree.value[node];
}

// --- Random Forest: mean over trees
function predictRandomForest(scaled, art) {
  let sum = 0;
  for (const t of art.trees) sum += traverseTree(t, scaled);
  return (sum / art.trees.length) + (art.calibration_intercept || 0);
}

// --- Gradient Boosting: init + sum of (lr × tree_pred)
function predictGradientBoost(scaled, art) {
  let s = art.init_value;
  for (const t of art.trees) s += art.learning_rate * traverseTree(t, scaled);
  return s + (art.calibration_intercept || 0);
}

// --- MLP forward pass (input -> hidden ReLU layers -> linear output)
function predictMLP(scaled, art) {
  let activations = scaled.slice();
  const numLayers = art.weights.length;
  for (let L = 0; L < numLayers; L++) {
    const W = art.weights[L];
    const b = art.biases[L];
    const inDim = W.length;
    const outDim = b.length;
    const next = new Array(outDim);
    for (let j = 0; j < outDim; j++) {
      let z = b[j];
      for (let i = 0; i < inDim; i++) z += activations[i] * W[i][j];
      // ReLU on hidden layers; identity on output
      if (L < numLayers - 1) z = Math.max(0, z);
      next[j] = z;
    }
    activations = next;
  }
  return activations[0] + (art.calibration_intercept || 0);
}

// --- Stacked ensemble: meta-learner over base predictions
function predictStacked(scaled, art) {
  const baseOrder = art.base_order;
  const basePreds = baseOrder.map(name => {
    if (name === 'elasticnet')    return predictLinear(scaled, models.elasticnet) - (models.elasticnet.calibration_intercept || 0);
    if (name === 'randomforest')  return predictRandomForest(scaled, models.randomforest) - (models.randomforest.calibration_intercept || 0);
    if (name === 'gradientboost') return predictGradientBoost(scaled, models.gradientboost) - (models.gradientboost.calibration_intercept || 0);
    if (name === 'mlp')           return predictMLP(scaled, models.mlp) - (models.mlp.calibration_intercept || 0);
    return 0;
  });
  let s = art.meta_intercept;
  for (let i = 0; i < basePreds.length; i++) s += basePreds[i] * art.meta_coef[i];
  return s + (art.calibration_intercept || 0);
}

// ============================================================
// Unified entry point
// ============================================================

function rowToFeatureVec(row) {
  return modelConfig.features.map(f => row[f]);
}

export function predictScoreWith(engine, row) {
  const scaled = applyScaler(rowToFeatureVec(row));
  switch (engine) {
    case 'elasticnet':    return predictLinear(scaled, models.elasticnet);
    case 'randomforest':  return predictRandomForest(scaled, models.randomforest);
    case 'gradientboost': return predictGradientBoost(scaled, models.gradientboost);
    case 'mlp':           return predictMLP(scaled, models.mlp);
    case 'stacked':       return predictStacked(scaled, models.stacked);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}

export function predictScore(row) { return predictScoreWith(currentEngine, row); }

// ============================================================
// Monte Carlo rank simulation (engine-agnostic)
// ============================================================

export function simulateRank(customMetrics, targetSchool = null, nSimulations = 10000) {
  if (!dataSnapshot) throw new Error('Model not loaded.');
  targetSchool = targetSchool || getGWUSchoolName();
  const targetIdx = dataSnapshot.findIndex(s => s.School === targetSchool);
  if (targetIdx === -1) throw new Error(`School "${targetSchool}" not found.`);

  const simData = dataSnapshot.map((school, i) => {
    if (i === targetIdx) {
      const m = { ...school };
      for (const [k, v] of Object.entries(customMetrics)) {
        if (k === 'GMAT_Combined' && v !== null && typeof v === 'object') {
          m[k] = computeBlendedGMAT(v);
        } else if (k === 'SalaryByProfession' && v !== null && typeof v === 'object') {
          const ratio = computeSBPRatio(v);
          if (ratio !== null) m[k] = ratio;
        } else {
          m[k] = v;
        }
      }
      return m;
    }
    return { ...school };
  });

  // Residual-anchored scoring per the chosen engine.
  const baseScores = simData.map((school, i) => {
    const trueScore = dataSnapshot[i].OverallScore;
    const baselineRow = {};
    for (const f of modelConfig.features) baselineRow[f] = dataSnapshot[i][f];
    const baselinePred = predictScore(baselineRow);
    const residual = (trueScore != null && !Number.isNaN(trueScore)) ? (trueScore - baselinePred) : 0;
    const simRow = {};
    for (const f of modelConfig.features) simRow[f] = school[f];
    return predictScore(simRow) + residual;
  });

  const noiseScale = simData.map((s, i) => {
    if (i === targetIdx) return 0;
    const r = s.Rank;
    if (r <= 20) return 0.8;
    if (r <= 50) return 1.5;
    return 2.5;
  });

  const predictedRanks = [];
  const n = baseScores.length;
  for (let sim = 0; sim < nSimulations; sim++) {
    const scenario = baseScores.map((s, i) => s + gaussianRandom() * noiseScale[i]);
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => scenario[b] - scenario[a]);
    predictedRanks.push(idx.indexOf(targetIdx) + 1);
  }
  predictedRanks.sort((a, b) => a - b);
  const median = predictedRanks[Math.floor(predictedRanks.length / 2)];
  const p5 = predictedRanks[Math.floor(predictedRanks.length * 0.05)];
  const p95 = predictedRanks[Math.floor(predictedRanks.length * 0.95)];

  const counts = {};
  for (const r of predictedRanks) counts[r] = (counts[r] || 0) + 1;
  const distribution = {};
  for (const [r, c] of Object.entries(counts)) distribution[r] = c / nSimulations;

  return {
    medianRank: median,
    range90: [p5, p95],
    scenarioScore: Math.round(baseScores[targetIdx] * 100) / 100,
    rankDistribution: distribution,
    rawRanks: predictedRanks,
    engine: currentEngine,
  };
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
