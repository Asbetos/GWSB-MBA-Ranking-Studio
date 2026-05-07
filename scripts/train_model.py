"""
GWU Ranking Predictor v3 — Multi-Model Training Pipeline
=========================================================
Trains FIVE scoring engines on the stacked 2024+2025 panel and exports each as
compact JSON for client-side inference. All five share the same feature
engineering (corrected GMAT/GRE blend, Salary-by-Profession indicator).

Models:
  1. ElasticNet (linear baseline)
  2. RandomForestRegressor (bagged trees)
  3. GradientBoostingRegressor (sequential boosted trees)
  4. MLPRegressor (multi-layer perceptron — "deep learning" branch)
  5. Stacking ensemble (Ridge meta-learner over the 4 base models)

For each model we export:
  - performance metrics (5-fold CV: MAE, RMSE, R², Spearman) on the published score
  - parameters in a compact form the browser can run forward passes on
  - feature importances or coefficients as available
"""

import os
import re
import json
import numpy as np
import pandas as pd

from sklearn.base import BaseEstimator, TransformerMixin, clone
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import KNNImputer
from sklearn.linear_model import ElasticNetCV, Ridge
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from scipy.stats import spearmanr, rankdata

# ============================================================
# CONFIGURATION
# ============================================================
SCRIPT_DIR = os.path.dirname(__file__)
DATA_PATHS = {
    2024: os.path.join(SCRIPT_DIR, '..', '..', 'all_schools_flat_2024.csv'),
    2025: os.path.join(SCRIPT_DIR, '..', '..', 'all_schools_flat_2025.csv'),
}
OUTPUT_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'model_artifacts')
INFERENCE_CURVE_YEAR = 2025
RANDOM_STATE = 42

ALL_FEATURES = [
    'EmployedAtGrad', 'Employed3Mo', 'AvgSalaryBonus', 'SalaryByProfession',
    'MedianGPA', 'AcceptanceRate', 'PeerScore', 'RecruiterScore',
    'GMAT_Combined',
]
TARGET = 'OverallScore'
EXCLUDED_OCCUPATIONS = {'Other'}
MIN_OCCUPATION_REPORTERS = 3

GMAT_INPUT_CONFIG = {
    'gmat_scale_default': 'old',
    'gmat_old_range': {'min': 200, 'max': 800, 'step': 5},
    'gmat_new_range': {'min': 205, 'max': 805, 'step': 5},
    'gre_q_range':    {'min': 130, 'max': 170, 'step': 1},
    'gre_v_range':    {'min': 130, 'max': 170, 'step': 1},
    'gre_aw_range':   {'min': 0.0, 'max': 6.0, 'step': 0.5},
    'gre_default_enabled': False,
}

SBP_OCCUPATIONS = [
    'Consulting', 'Finance / Accounting', 'General Management',
    'Marketing / Sales', 'Operations / Production',
    'Management Information Systems (MIS)', 'Human Resources',
]
SBP_SLIDER = {'min': 60000, 'max': 260000, 'step': 1000, 'format': 'dollar'}

SLIDER_RANGES = {
    'EmployedAtGrad':      {'min': 0.20, 'max': 1.00, 'step': 0.01, 'label': 'Employed at Graduation', 'format': 'percent'},
    'Employed3Mo':         {'min': 0.20, 'max': 1.00, 'step': 0.01, 'label': 'Employed 3 Months After', 'format': 'percent'},
    'AvgSalaryBonus':      {'min': 80000, 'max': 220000, 'step': 1000, 'label': 'Avg Salary + Bonus ($)', 'format': 'dollar'},
    'SalaryByProfession':  {'min': 0.6, 'max': 1.4, 'step': 0.01, 'label': 'Salary by Profession', 'format': 'number'},
    'MedianGPA':           {'min': 3.0, 'max': 4.0, 'step': 0.01, 'label': 'Median GPA', 'format': 'number'},
    'AcceptanceRate':      {'min': 0.05, 'max': 1.00, 'step': 0.01, 'label': 'Acceptance Rate', 'format': 'percent'},
    'PeerScore':           {'min': 1.0, 'max': 5.0, 'step': 0.1,  'label': 'Peer Assessment Score', 'format': 'number'},
    'RecruiterScore':      {'min': 1.0, 'max': 5.0, 'step': 0.1,  'label': 'Recruiter Assessment Score', 'format': 'number'},
    'GMAT_Combined':       {'min': 0,   'max': 100, 'step': 1,    'label': 'GMAT/GRE Blended Percentile', 'format': 'number'},
}

COLUMN_RENAME_MAP = {
    'school_info.school_name': 'School',
    'school_info.us_news_rank': 'Rank',
    'school_info.us_news_overall_score': 'OverallScore',
    'ranking_scores_two_year_averages.fulltime_employed_at_graduation_two_yr_avg': 'EmployedAtGrad',
    'ranking_scores_two_year_averages.fulltime_employed_3_months_after_two_yr_avg': 'Employed3Mo',
    'ranking_scores_two_year_averages.avg_starting_salary_and_bonus_two_yr_avg': 'AvgSalaryBonus',
    'ranking_scores_two_year_averages.median_undergraduate_gpa': 'MedianGPA',
    'ranking_scores_two_year_averages.acceptance_rate': 'AcceptanceRate',
    'ranking_scores_two_year_averages.peer_assessment_score_out_of_5': 'PeerScore',
    'ranking_scores_two_year_averages.recruiter_assessment_score_out_of_5': 'RecruiterScore',
    'ranking_scores_two_year_averages.median_gmat_score_fulltime_old': 'GMAT_Old',
    'ranking_scores_two_year_averages.median_gmat_score_fulltime_new': 'GMAT_New',
    'gmat_data.percent_new_entrants_providing_gmat_old': 'Pct_GMAT_Old',
    'gmat_data.percent_new_entrants_providing_gmat_new': 'Pct_GMAT_New',
    'gre_data.percent_new_entrants_providing_gre': 'Pct_GRE',
    'gre_data.gre_score_range_10th_90th': 'GRE_Range_Str',
}


# ============================================================
# PREPROCESSING (same as v2)
# ============================================================

def parse_gre_components(s):
    if not isinstance(s, str) or not s.strip():
        return (None, None, None)
    text = s.lower()
    out = {'verbal': None, 'quant': None, 'writing': None}
    for m in re.finditer(r'(\d{1,3}(?:\.\d+)?)\s*[-–]\s*(\d{1,3}(?:\.\d+)?)\s*([a-z]+)?', text):
        try:
            lo, hi = float(m.group(1)), float(m.group(2))
        except ValueError:
            continue
        lbl = (m.group(3) or '').lower()
        mid = (lo + hi) / 2.0
        if 'verbal' in lbl: out['verbal'] = mid
        elif 'quant' in lbl: out['quant'] = mid
        elif 'writ' in lbl: out['writing'] = mid
    return (out['verbal'], out['quant'], out['writing'])


def _percentile_rank(values):
    out = np.full(len(values), np.nan)
    mask = ~np.isnan(values)
    if mask.sum() == 0: return out
    ranks = rankdata(values[mask], method='average') / float(mask.sum())
    out[mask] = ranks
    return out


def compute_gmat_gre_blend(df, year_col='Year'):
    df = df.copy()
    if 'GRE_Range_Str' in df.columns:
        comps = df['GRE_Range_Str'].apply(parse_gre_components)
        df['GRE_V'] = comps.apply(lambda t: t[0])
        df['GRE_Q'] = comps.apply(lambda t: t[1])
        df['GRE_AW'] = comps.apply(lambda t: t[2])
    else:
        df['GRE_V'] = np.nan; df['GRE_Q'] = np.nan; df['GRE_AW'] = np.nan

    for col in ('Pct_GMAT_Old', 'Pct_GMAT_New', 'Pct_GRE'):
        if col not in df.columns: df[col] = 0.0
        m = df[col].dropna().max() if df[col].notna().any() else 0
        if m is not None and m > 1.5: df[col] = df[col] / 100.0
        df[col] = df[col].fillna(0.0).clip(0.0, 1.0)

    score_to_rank = [
        ('GMAT_Old', 'rank_gmat_old'), ('GMAT_New', 'rank_gmat_new'),
        ('GRE_Q', 'rank_gre_q'), ('GRE_V', 'rank_gre_v'), ('GRE_AW', 'rank_gre_aw'),
    ]
    for _, rc in score_to_rank: df[rc] = np.nan

    for year, sub in df.groupby(year_col):
        for sc, rc in score_to_rank:
            if sc in df.columns:
                df.loc[sub.index, rc] = _percentile_rank(sub[sc].astype(float).values)

    gre_pct = 0.4 * df['rank_gre_q'] + 0.4 * df['rank_gre_v'] + 0.2 * df['rank_gre_aw']
    fallback = 0.5 * df['rank_gre_q'].fillna(np.nan) + 0.5 * df['rank_gre_v'].fillna(np.nan)
    df['rank_gre'] = gre_pct.where(gre_pct.notna(), fallback)

    p_old = df['Pct_GMAT_Old'].values
    p_new = df['Pct_GMAT_New'].values
    p_gre = df['Pct_GRE'].values
    r_old = df['rank_gmat_old'].values
    r_new = df['rank_gmat_new'].values
    r_gre = df['rank_gre'].values

    p_old_eff = np.where(np.isnan(r_old), 0.0, p_old)
    p_new_eff = np.where(np.isnan(r_new), 0.0, p_new)
    p_gre_eff = np.where(np.isnan(r_gre), 0.0, p_gre)
    r_old_eff = np.where(np.isnan(r_old), 0.0, r_old)
    r_new_eff = np.where(np.isnan(r_new), 0.0, r_new)
    r_gre_eff = np.where(np.isnan(r_gre), 0.0, r_gre)

    total = p_old_eff + p_new_eff + p_gre_eff
    weighted = p_old_eff * r_old_eff + p_new_eff * r_new_eff + p_gre_eff * r_gre_eff
    with np.errstate(divide='ignore', invalid='ignore'):
        blended = np.where(total > 0, weighted / total, np.nan)
    df['GMAT_Combined'] = blended * 100.0
    return df


def compute_salary_by_profession(df, year_col='Year'):
    occ_idx = list(range(8))
    sba = pd.Series(np.nan, index=df.index, dtype=float)
    for year, sub in df.groupby(year_col):
        per_occ = {}
        for i in occ_idx:
            occ_col = f'base_salary_by_occupation[{i}].occupation'
            sal_col = f'base_salary_by_occupation[{i}].average_salary'
            n_col   = f'base_salary_by_occupation[{i}].number_reporting_jobs'
            if occ_col not in sub.columns or sal_col not in sub.columns or n_col not in sub.columns:
                continue
            for idx, row in sub.iterrows():
                occ = row[occ_col]; sal = row[sal_col]; n = row[n_col]
                if not isinstance(occ, str) or pd.isna(sal) or pd.isna(n): continue
                if occ.strip() in EXCLUDED_OCCUPATIONS: continue
                if n < MIN_OCCUPATION_REPORTERS: continue
                per_occ.setdefault(occ.strip(), []).append((idx, float(sal), float(n)))
        cohort_means = {}
        for k, rows in per_occ.items():
            ntot = sum(r[2] for r in rows)
            if ntot > 0: cohort_means[k] = sum(r[1] * r[2] for r in rows) / ntot

        for idx, row in sub.iterrows():
            ratio_sum, n_sum = 0.0, 0.0
            for i in occ_idx:
                occ_col = f'base_salary_by_occupation[{i}].occupation'
                sal_col = f'base_salary_by_occupation[{i}].average_salary'
                n_col   = f'base_salary_by_occupation[{i}].number_reporting_jobs'
                if occ_col not in sub.columns: continue
                occ = row[occ_col]; sal = row[sal_col]; n = row[n_col]
                if not isinstance(occ, str) or pd.isna(sal) or pd.isna(n): continue
                k = occ.strip()
                if k in EXCLUDED_OCCUPATIONS or n < MIN_OCCUPATION_REPORTERS: continue
                if k not in cohort_means or cohort_means[k] <= 0: continue
                ratio = float(sal) / cohort_means[k]
                ratio_sum += ratio * float(n); n_sum += float(n)
            if n_sum > 0: sba.loc[idx] = ratio_sum / n_sum
    return sba


def preprocess(data_paths):
    print(f"\n{'='*60}\nPREPROCESSING\n{'='*60}")
    frames = []
    for year, p in data_paths.items():
        d = pd.read_csv(p, low_memory=False)
        d = d.rename(columns=COLUMN_RENAME_MAP)
        d['Year'] = year
        frames.append(d)
    df = pd.concat(frames, ignore_index=True, sort=False)
    print(f"  Stacked shape: {df.shape}")

    df['SalaryByProfession'] = compute_salary_by_profession(df, year_col='Year')
    print(f"  Salary-by-Profession computed for {df['SalaryByProfession'].notna().sum()} / {len(df)} rows")

    df = compute_gmat_gre_blend(df, year_col='Year')
    print(f"  GMAT_Combined computed for {df['GMAT_Combined'].notna().sum()} / {len(df)} rows")

    impute_cols = [f for f in ALL_FEATURES + [TARGET] if f in df.columns]
    parts = []
    for year, sub in df.groupby('Year'):
        sub = sub.copy()
        cols = [c for c in impute_cols if c in sub.columns]
        if sub[cols].isnull().sum().sum() > 0:
            imp = KNNImputer(n_neighbors=5, weights='distance')
            sub[cols] = imp.fit_transform(sub[cols])
        parts.append(sub)
    df = pd.concat(parts, ignore_index=True, sort=False)

    for year, sub in df.groupby('Year'):
        floor = sub.loc[sub['GMAT_Combined'].notna(), 'GMAT_Combined'].min()
        if pd.isna(floor): floor = 0.0
        idx = sub.index[sub['GMAT_Combined'].isna()]
        df.loc[idx, 'GMAT_Combined'] = floor
        floor2 = sub.loc[sub['SalaryByProfession'].notna(), 'SalaryByProfession'].min()
        if pd.isna(floor2): floor2 = 1.0
        idx2 = sub.index[sub['SalaryByProfession'].isna()]
        df.loc[idx2, 'SalaryByProfession'] = floor2

    miss = df[ALL_FEATURES + [TARGET]].isnull().sum().sum()
    assert miss == 0, f"{miss} missing values remain"
    print(f"  Final shape: {df.shape}")
    return df


# ============================================================
# 5-MODEL TRAINING
# ============================================================

def train_all_models(X, y):
    """Train each model on the full data; return dict of fitted models."""
    print(f"\n{'='*60}\nTRAINING 5 MODELS\n{'='*60}")
    # Use a shared StandardScaler; the linear/MLP need it; tree models don't but consistency simplifies inference
    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)

    models = {}

    # 1. ElasticNet
    print("  [1/5] Training ElasticNetCV...")
    en = ElasticNetCV(l1_ratio=[.1, .5, .7, .9, .95, .99, 1], cv=5, max_iter=10000, n_jobs=-1, random_state=RANDOM_STATE)
    en.fit(Xs, y)
    models['elasticnet'] = en

    # 2. Random Forest
    print("  [2/5] Training RandomForest...")
    rf = RandomForestRegressor(n_estimators=300, max_depth=8, min_samples_leaf=3, n_jobs=-1, random_state=RANDOM_STATE)
    rf.fit(Xs, y)
    models['randomforest'] = rf

    # 3. Gradient Boosting
    print("  [3/5] Training GradientBoosting...")
    gb = GradientBoostingRegressor(n_estimators=400, learning_rate=0.05, max_depth=4,
                                    min_samples_leaf=3, subsample=0.85, random_state=RANDOM_STATE)
    gb.fit(Xs, y)
    models['gradientboost'] = gb

    # 4. MLP (deep learning)
    print("  [4/5] Training MLP...")
    mlp = MLPRegressor(hidden_layer_sizes=(64, 32, 16), activation='relu',
                       solver='adam', alpha=1e-3, max_iter=3000, learning_rate='adaptive',
                       random_state=RANDOM_STATE, early_stopping=False)
    mlp.fit(Xs, y)
    models['mlp'] = mlp

    # 5. Stacking: out-of-fold predictions from 4 base models -> Ridge meta-learner
    print("  [5/5] Building Stacking ensemble (Ridge meta-learner over base models)...")
    base_estimators = [
        ('elasticnet', clone(en)),
        ('randomforest', clone(rf)),
        ('gradientboost', clone(gb)),
        ('mlp', clone(mlp)),
    ]
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    oof_preds = np.zeros((len(y), len(base_estimators)))
    for j, (name, est) in enumerate(base_estimators):
        oof_preds[:, j] = cross_val_predict(est, Xs, y, cv=kf, n_jobs=-1)
    meta = Ridge(alpha=1.0, random_state=RANDOM_STATE)
    meta.fit(oof_preds, y)
    # Refit base estimators on full data for production inference
    for name, est in base_estimators:
        est.fit(Xs, y)
    models['stacked'] = {
        'base_models': dict(base_estimators),
        'meta_learner': meta,
        'base_order': [n for n, _ in base_estimators],
    }

    return models, scaler


def evaluate_all(models, X, y, scaler):
    """5-fold CV performance for each model on the published score."""
    print(f"\n{'='*60}\nCROSS-VALIDATED PERFORMANCE\n{'='*60}")
    Xs = scaler.transform(X)
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    perf = {}

    base_specs = {
        'elasticnet':    lambda: ElasticNetCV(l1_ratio=[.1,.5,.7,.9,.95,.99,1], cv=5, max_iter=10000, n_jobs=-1, random_state=RANDOM_STATE),
        'randomforest':  lambda: RandomForestRegressor(n_estimators=300, max_depth=8, min_samples_leaf=3, n_jobs=-1, random_state=RANDOM_STATE),
        'gradientboost': lambda: GradientBoostingRegressor(n_estimators=400, learning_rate=0.05, max_depth=4,
                                                            min_samples_leaf=3, subsample=0.85, random_state=RANDOM_STATE),
        'mlp':           lambda: MLPRegressor(hidden_layer_sizes=(64, 32, 16), activation='relu',
                                                solver='adam', alpha=1e-3, max_iter=3000, learning_rate='adaptive',
                                                random_state=RANDOM_STATE),
    }
    base_oof = {}
    for name, factory in base_specs.items():
        preds = cross_val_predict(factory(), Xs, y, cv=kf, n_jobs=-1)
        base_oof[name] = preds
        perf[name] = _metrics(y, preds)
        print(f"  {name:14s}  MAE={perf[name]['mae']:.3f}  RMSE={perf[name]['rmse']:.3f}  R^2={perf[name]['r2']:.4f}  rho={perf[name]['spearman']:.4f}")

    # Stacking CV: meta-learner trained on OOF base preds, evaluated also via OOF
    base_matrix = np.column_stack([base_oof[n] for n in ['elasticnet', 'randomforest', 'gradientboost', 'mlp']])
    stack_meta_factory = lambda: Ridge(alpha=1.0, random_state=RANDOM_STATE)
    stack_oof = cross_val_predict(stack_meta_factory(), base_matrix, y, cv=kf, n_jobs=-1)
    perf['stacked'] = _metrics(y, stack_oof)
    print(f"  {'stacked':14s}  MAE={perf['stacked']['mae']:.3f}  RMSE={perf['stacked']['rmse']:.3f}  R^2={perf['stacked']['r2']:.4f}  rho={perf['stacked']['spearman']:.4f}")

    return perf


def _metrics(y_true, y_pred):
    return {
        'mae': float(mean_absolute_error(y_true, y_pred)),
        'rmse': float(np.sqrt(mean_squared_error(y_true, y_pred))),
        'r2': float(r2_score(y_true, y_pred)),
        'spearman': float(spearmanr(y_true, y_pred)[0]),
    }


# ============================================================
# CALIBRATION (top school = 100)
# ============================================================

def calibrate_intercept(predict_fn, X_top):
    """For each model, shift predictions so the rank-1 school = 100."""
    raw = predict_fn(X_top)
    return float(100.0 - raw[0])


# ============================================================
# JSON EXPORT (per-model serialization)
# ============================================================

def serialize_tree(tree):
    """Serialize a sklearn DecisionTree to compact JSON arrays."""
    t = tree.tree_
    return {
        'feature': t.feature.astype(int).tolist(),         # -2 = leaf
        'threshold': t.threshold.tolist(),
        'children_left': t.children_left.astype(int).tolist(),
        'children_right': t.children_right.astype(int).tolist(),
        'value': [float(v[0][0]) for v in t.value],         # regression: mean per leaf
    }


def serialize_random_forest(rf):
    return {
        'n_estimators': rf.n_estimators,
        'trees': [serialize_tree(est) for est in rf.estimators_],
    }


def serialize_gradient_boost(gb):
    return {
        'n_estimators': gb.n_estimators_,
        'learning_rate': float(gb.learning_rate),
        'init_value': float(gb.init_.constant_[0, 0]),
        'trees': [serialize_tree(est[0]) for est in gb.estimators_],   # GBM stores list of [DecisionTree]
    }


def serialize_mlp(mlp):
    return {
        'layer_sizes': [int(x) for x in [mlp.coefs_[0].shape[0]] + [c.shape[1] for c in mlp.coefs_]],
        'weights': [c.tolist() for c in mlp.coefs_],         # list of (in_dim, out_dim) matrices
        'biases':  [b.tolist() for b in mlp.intercepts_],   # list of (out_dim,) vectors
        'activation': 'relu',
        'output_activation': 'identity',
    }


def serialize_elasticnet(en):
    return {
        'coef': en.coef_.tolist(),
        'intercept': float(en.intercept_),
        'l1_ratio': float(en.l1_ratio_) if hasattr(en, 'l1_ratio_') else None,
        'alpha': float(en.alpha_) if hasattr(en, 'alpha_') else None,
    }


def serialize_stacked(stacked):
    return {
        'base_order': stacked['base_order'],
        'meta_coef': stacked['meta_learner'].coef_.tolist(),
        'meta_intercept': float(stacked['meta_learner'].intercept_),
    }


# ============================================================
# EXPORT ARTIFACTS
# ============================================================

def export_artifacts(df, models, scaler, perf, output_dir):
    print(f"\n{'='*60}\nEXPORTING ARTIFACTS\n{'='*60}")
    os.makedirs(output_dir, exist_ok=True)

    snap_year = INFERENCE_CURVE_YEAR
    snap_df = df[df['Year'] == snap_year].copy().reset_index(drop=True)

    # Scaler params
    _w({'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist(), 'feature_names': ALL_FEATURES},
       output_dir, 'scaler_params.json')

    # Model config (shared)
    _w({
        'features': ALL_FEATURES,
        'target': TARGET,
        'snapshot_year': int(snap_year),
        'models': ['elasticnet', 'randomforest', 'gradientboost', 'mlp', 'stacked'],
    }, output_dir, 'model_config.json')

    # Calibration: each model predicts the rank-1 school's score; intercept shift -> exactly 100
    Xs_full = scaler.transform(df[ALL_FEATURES].values)
    top_idx = df[(df['Year'] == snap_year) & (df['Rank'] == 1)].index[0]
    Xs_top = Xs_full[df.index.get_loc(top_idx):df.index.get_loc(top_idx)+1]

    intercepts = {}
    intercepts['elasticnet'] = calibrate_intercept(lambda x: models['elasticnet'].predict(x), Xs_top)
    intercepts['randomforest'] = calibrate_intercept(lambda x: models['randomforest'].predict(x), Xs_top)
    intercepts['gradientboost'] = calibrate_intercept(lambda x: models['gradientboost'].predict(x), Xs_top)
    intercepts['mlp'] = calibrate_intercept(lambda x: models['mlp'].predict(x), Xs_top)
    # Stacking: predict each base model on top, run through meta
    base_top = np.array([
        models['stacked']['base_models'][n].predict(Xs_top)[0]
        for n in models['stacked']['base_order']
    ]).reshape(1, -1)
    intercepts['stacked'] = float(100.0 - models['stacked']['meta_learner'].predict(base_top)[0])

    # Per-model artifacts (params + calibration intercept + perf + feature importance)
    elasticnet_payload = serialize_elasticnet(models['elasticnet'])
    elasticnet_payload['calibration_intercept'] = intercepts['elasticnet']
    elasticnet_payload['performance_cv'] = perf['elasticnet']
    elasticnet_payload['feature_names'] = ALL_FEATURES
    _w(elasticnet_payload, output_dir, 'model_elasticnet.json')

    rf_payload = serialize_random_forest(models['randomforest'])
    rf_payload['calibration_intercept'] = intercepts['randomforest']
    rf_payload['performance_cv'] = perf['randomforest']
    rf_payload['feature_names'] = ALL_FEATURES
    rf_payload['feature_importances'] = models['randomforest'].feature_importances_.tolist()
    _w(rf_payload, output_dir, 'model_randomforest.json')

    gb_payload = serialize_gradient_boost(models['gradientboost'])
    gb_payload['calibration_intercept'] = intercepts['gradientboost']
    gb_payload['performance_cv'] = perf['gradientboost']
    gb_payload['feature_names'] = ALL_FEATURES
    gb_payload['feature_importances'] = models['gradientboost'].feature_importances_.tolist()
    _w(gb_payload, output_dir, 'model_gradientboost.json')

    mlp_payload = serialize_mlp(models['mlp'])
    mlp_payload['calibration_intercept'] = intercepts['mlp']
    mlp_payload['performance_cv'] = perf['mlp']
    mlp_payload['feature_names'] = ALL_FEATURES
    _w(mlp_payload, output_dir, 'model_mlp.json')

    stacked_payload = serialize_stacked(models['stacked'])
    stacked_payload['calibration_intercept'] = intercepts['stacked']
    stacked_payload['performance_cv'] = perf['stacked']
    stacked_payload['feature_names'] = ALL_FEATURES
    _w(stacked_payload, output_dir, 'model_stacked.json')

    # Data snapshot for Monte Carlo (most recent year)
    snapshot_cols = ['School', 'Rank', TARGET] + ALL_FEATURES
    _w(snap_df[snapshot_cols].to_dict(orient='records'), output_dir, 'data_snapshot.json')

    # GMAT inference curves (per-exam sorted scores from snapshot year)
    def _sorted(col):
        if col not in snap_df.columns: return []
        return sorted(float(x) for x in snap_df[col].dropna().values)
    # The snap_df doesn't carry raw GMAT_Old/New/GRE_Q/V/AW; pull from the full df for snap year.
    src = df[df['Year'] == snap_year]
    curves = {
        'year': int(snap_year),
        'gmat_old': sorted(float(x) for x in src['GMAT_Old'].dropna().values) if 'GMAT_Old' in src.columns else [],
        'gmat_new': sorted(float(x) for x in src['GMAT_New'].dropna().values) if 'GMAT_New' in src.columns else [],
        'gre_q':    sorted(float(x) for x in src['GRE_Q'].dropna().values) if 'GRE_Q' in src.columns else [],
        'gre_v':    sorted(float(x) for x in src['GRE_V'].dropna().values) if 'GRE_V' in src.columns else [],
        'gre_aw':   sorted(float(x) for x in src['GRE_AW'].dropna().values) if 'GRE_AW' in src.columns else [],
    }
    _w(curves, output_dir, 'gmat_inference_curves.json')

    # Feature ranges + GWU current
    feature_ranges = {}
    for f in ALL_FEATURES:
        v = snap_df[f]
        feature_ranges[f] = {
            'data_min': float(v.min()), 'data_max': float(v.max()),
            'data_mean': float(v.mean()), 'data_median': float(v.median()),
            **SLIDER_RANGES.get(f, {}),
        }
    feature_ranges['_gmat_input_config'] = GMAT_INPUT_CONFIG

    sbp_cohort = {}
    for occ in SBP_OCCUPATIONS:
        rows = []
        for i in range(8):
            occ_col = f'base_salary_by_occupation[{i}].occupation'
            sal_col = f'base_salary_by_occupation[{i}].average_salary'
            n_col   = f'base_salary_by_occupation[{i}].number_reporting_jobs'
            if occ_col not in df.columns: continue
            sub = df[(df['Year'] == snap_year) & (df[occ_col] == occ)]
            for _, r in sub.iterrows():
                sal = r.get(sal_col); n = r.get(n_col)
                if pd.isna(sal) or pd.isna(n) or n < MIN_OCCUPATION_REPORTERS: continue
                rows.append((float(sal), float(n)))
        if rows:
            ntot = sum(r[1] for r in rows)
            sbp_cohort[occ] = {
                'cohort_mean': float(sum(r[0]*r[1] for r in rows) / ntot),
                'cohort_n_total': int(ntot),
            }
    feature_ranges['_sbp_cohort'] = sbp_cohort
    feature_ranges['_sbp_occupations'] = SBP_OCCUPATIONS
    feature_ranges['_sbp_slider'] = SBP_SLIDER

    gwu_match = snap_df[snap_df['School'].str.contains('George Washington', case=False, na=False)]
    if not gwu_match.empty:
        gwu_full = df[(df['School'].str.contains('George Washington', case=False, na=False)) & (df['Year'] == snap_year)].iloc[0]
        gwu_vals = {f: float(gwu_match.iloc[0][f]) for f in ALL_FEATURES}
        for raw_col, key in (('GMAT_Old', 'gmat_old'), ('GMAT_New', 'gmat_new'),
                             ('GRE_Q', 'gre_q'), ('GRE_V', 'gre_v'), ('GRE_AW', 'gre_aw'),
                             ('Pct_GMAT_Old', 'pct_gmat_old'), ('Pct_GMAT_New', 'pct_gmat_new'), ('Pct_GRE', 'pct_gre'),
                             ('student_body_fulltime_mba.enrollment', 'fulltime_enrollment')):
            v = gwu_full.get(raw_col, np.nan)
            gwu_vals[key] = None if pd.isna(v) else float(v)
        gwu_sbp = {}
        for i in range(8):
            occ_col = f'base_salary_by_occupation[{i}].occupation'
            sal_col = f'base_salary_by_occupation[{i}].average_salary'
            n_col   = f'base_salary_by_occupation[{i}].number_reporting_jobs'
            occ = gwu_full.get(occ_col)
            if not isinstance(occ, str) or occ.strip() not in SBP_OCCUPATIONS: continue
            sal = gwu_full.get(sal_col); n = gwu_full.get(n_col)
            gwu_sbp[occ.strip()] = {
                'salary': None if pd.isna(sal) else float(sal),
                'n_reporting': None if pd.isna(n) else float(n),
            }
        gwu_vals['sbp_per_occupation'] = gwu_sbp
        feature_ranges['_gwu_current'] = gwu_vals
        feature_ranges['_gwu_school_name'] = str(gwu_match.iloc[0]['School'])
        feature_ranges['_gwu_current_rank'] = int(gwu_match.iloc[0]['Rank'])
        feature_ranges['_gwu_current_score'] = float(gwu_match.iloc[0][TARGET])
    _w(feature_ranges, output_dir, 'feature_ranges.json')

    # Per-school comparison: published vs. each model (snapshot year)
    cmp_rows = []
    Xs_snap = scaler.transform(snap_df[ALL_FEATURES].values)
    preds_per_model = {
        'elasticnet':    models['elasticnet'].predict(Xs_snap) + intercepts['elasticnet'],
        'randomforest':  models['randomforest'].predict(Xs_snap) + intercepts['randomforest'],
        'gradientboost': models['gradientboost'].predict(Xs_snap) + intercepts['gradientboost'],
        'mlp':           models['mlp'].predict(Xs_snap) + intercepts['mlp'],
    }
    base_snap = np.column_stack([
        models['stacked']['base_models'][n].predict(Xs_snap)
        for n in models['stacked']['base_order']
    ])
    preds_per_model['stacked'] = models['stacked']['meta_learner'].predict(base_snap) + intercepts['stacked']

    for i, row in snap_df.iterrows():
        rec = {
            'school': str(row['School']),
            'published_rank': int(row['Rank']),
            'published_score': float(row[TARGET]),
        }
        for m, preds in preds_per_model.items():
            rec[f'{m}_score'] = float(preds[i])
        cmp_rows.append(rec)

    # Add ranks per model
    for m in preds_per_model:
        order = sorted(range(len(cmp_rows)), key=lambda j: -cmp_rows[j][f'{m}_score'])
        ranks = [0] * len(cmp_rows)
        for r, j in enumerate(order, 1):
            ranks[j] = r
        for j, row in enumerate(cmp_rows):
            row[f'{m}_rank'] = ranks[j]

    _w({'snapshot_year': int(snap_year), 'rows': cmp_rows, 'performance': perf},
       output_dir, 'methodology_comparison.json')

    print(f"\n  All artifacts exported to: {output_dir}")


def _w(data, output_dir, filename):
    path = os.path.join(output_dir, filename)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    sz = os.path.getsize(path)
    print(f"  [OK] {filename}  ({sz/1024:.1f} KB)")


# ============================================================
# MAIN
# ============================================================

def main():
    print("=" * 60)
    print("GWU RANKING PREDICTOR v3 - 5-MODEL TRAINING PIPELINE")
    print("=" * 60)

    df = preprocess(DATA_PATHS)
    X = df[ALL_FEATURES].values
    y = df[TARGET].values

    perf = evaluate_all({}, X, y, StandardScaler().fit(X))
    models, scaler = train_all_models(X, y)
    export_artifacts(df, models, scaler, perf, OUTPUT_DIR)

    print(f"\n{'='*60}\nTRAINING COMPLETE\n{'='*60}")


if __name__ == '__main__':
    main()
