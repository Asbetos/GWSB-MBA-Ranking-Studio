# GWU MBA Ranking Predictor v3 — Multi-Model What-If Studio

> **What's new:** five scoring engines, a unified workspace combining direct methodological inputs and indirect non-method levers, and an aurora visual theme. Switch between models live and see the rank distribution update from 10,000 Monte Carlo simulations.

---

## Quick start

```bash
cd webapp-v3
npm install
npm run dev
# → http://localhost:3200/
```

The 5 models are pre-trained; artifacts live in `public/model_artifacts/`. Re-train with `python scripts/train_model.py` after dropping new CSVs into `notebooks/`.

---

## The 5 models

All trained on the **stacked 2024 + 2025 panel** (~243 observations × 9 indicators, including the corrected GMAT/GRE blend and Salary by Profession).

| Model | Type | Strengths | Color |
|---|---|---|---|
| **ElasticNet** | Penalised linear regression | Interpretable signed coefficients; fast to train | Violet |
| **Random Forest** | Bagged decision trees (300 trees, max_depth 8) | Robust to outliers; captures non-linear interactions | Emerald |
| **Gradient Boosting** | Sequentially boosted trees (400 estimators, lr 0.05) | Often the best single non-linear baseline | Amber |
| **Neural Network (MLP)** | 3 hidden layers (64 → 32 → 16, ReLU) | Models smooth non-linearities; "deep" branch | Rose |
| **Stacked Ensemble** | Ridge meta-learner over the 4 base models | Best out-of-sample fit by combining strengths | Cyan |

### 5-fold cross-validated performance (vs. published US News Overall Score)

| Model | MAE ↓ | RMSE ↓ | R² ↑ | Spearman ρ ↑ |
|---|---:|---:|---:|---:|
| ElasticNet | 3.11 | 4.01 | 0.964 | 0.978 |
| Random Forest | 3.59 | 4.78 | 0.949 | 0.965 |
| Gradient Boosting | 3.08 | 4.01 | 0.964 | 0.974 |
| Neural Network (MLP) | 3.71 | 5.51 | 0.932 | 0.955 |
| **Stacked Ensemble** | **2.96** | **3.83** | **0.967** | **0.978** |

The Stacked ensemble wins on every metric. Rank-order correlation with the published ranking is ~0.98 — i.e. the simulator places schools within ~1.5 rank-positions of US News on average.

---

## The What-If Studio (Tab 1)

A single workspace with **everything you can vary** for GWU's predicted rank:

- **Direct sliders (9):** the methodological indicators US News uses — Employed @ Grad, Employed @ 3mo, Avg Salary + Bonus, Salary by Profession, Median GPA, Acceptance Rate, Peer & Recruiter assessments, GMAT/GRE Blended Percentile.
- **Indirect levers (~23):** non-methodological inputs that propagate through the Core Feature Models — average age of entrants, work experience, demographics, tuition, debt levels, etc.
- **Model selector:** switch among the 5 engines without changing the inputs. Each engine produces its own predicted rank distribution.

How the two sides interact:

1. Move an indirect lever → CFMs predict the 9 core features → the direct sliders animate to the new predictions.
2. Then override any direct slider — your value wins from that point on.
3. Each change runs 10,000 Monte Carlo simulations (tiered Gaussian noise on competitor scores) and updates the rank, scenario score, 90% confidence interval, and the histogram.

Reset returns everything to GWU's published 2025 values.

---

## The model architecture, in one diagram

```
┌─────────────── PYTHON: train_model.py ────────────────┐
│                                                       │
│   2024.csv ──┐                                        │
│              ├──► preprocess + GMAT/GRE blend +       │
│   2025.csv ──┘    Salary-by-Profession ── 9 features  │
│                              │                        │
│                              ▼                        │
│   ┌──── ElasticNetCV ───┐                             │
│   ├──── RandomForest ──┤                              │
│   ├──── GradientBoost ─┼─── 5-fold CV  ──── perf JSON │
│   ├──── MLPRegressor ──┤                              │
│   └──── Stacking ───────┘                             │
│                              │                        │
│                              ▼                        │
│            JSON artifacts in public/model_artifacts/  │
└─────────────────────────────┬─────────────────────────┘
                              │
                              ▼
┌─────────────── BROWSER: pure JS inference ────────────┐
│                                                       │
│  Direct sliders ──┐                                   │
│                    │                                  │
│  Indirect levers ─►│ ── CFM predicts 9 core features  │
│                    │                                  │
│                    ▼                                  │
│  ┌─ Linear (dot product) ─┐                           │
│  ├─ Tree traversal (RF) ──┤                           │
│  ├─ Tree traversal (GBM) ─┤                           │
│  ├─ MLP forward pass ─────┤── selected by user        │
│  └─ Stacked (meta + base)─┘                           │
│                    │                                  │
│                    ▼                                  │
│  Monte Carlo (10k sims, tiered noise) → median rank,  │
│  90% CI, score, full distribution chart               │
└───────────────────────────────────────────────────────┘
```

Each tree-based model exports as compact arrays (`feature`, `threshold`, `children_left`, `children_right`, `value`) — the JS traverses them iteratively. The MLP exports weight matrices + bias vectors and the JS runs a dense forward pass with ReLU activations on hidden layers. Stacking combines the four base predictions through a Ridge meta-learner. **Python and JS predictions agree to 1e-4** (verified for Stanford and GWU).

---

## Tabs

| # | Tab | Purpose |
|---|---|---|
| 1 | **What-If Studio** | Direct + indirect levers + model selector + Monte Carlo. Primary workspace. |
| 2 | **Model Insights** | Side-by-side performance matrix for all 5 models, R² vs. MAE chart, per-model feature importance / coefficients selectable via the model picker. |
| 3 | **Per-School Comparison** | Every snapshot-year school × every model: published vs. predicted rank/score, sortable by absolute disagreement. |

---

## Visual theme

Aurora — deep midnight purple background with animated magenta/violet/cyan/emerald gradient blobs. Each model owns a signature color:

- ElasticNet — violet `#a78bfa`
- Random Forest — emerald `#34d399`
- Gradient Boosting — amber `#fbbf24`
- Neural Network — rose `#fb7185`
- Stacked Ensemble — cyan `#22d3ee`

When you switch engines, the rank display gradient shifts to incorporate that engine's color, the engine badge re-tints, and active controls glow.

---

## Re-training

```bash
cd webapp-v3/scripts
pip install -r requirements.txt    # one-time
python train_model.py
# → 11 JSON artifacts written to public/model_artifacts/
```

The script:

1. Stacks both years.
2. Computes Salary-by-Profession (per-year cohort means) and the 5-distribution GMAT/GRE blend (40/40/20 GRE-internal, submission-weighted across exams).
3. Per-year KNN imputation.
4. Trains 5 models, each with 5-fold cross-validated performance.
5. Exports each model as compact JSON (forests can be ~2 MB; everything else <100 KB).

Approximate runtime: ~3 minutes on 4 cores.

---

## Deploying to its own GitHub repo + Vercel

```bash
cd "webapp-v3"
git init -b main
git add .
git commit -m "Initial commit: GWU MBA Ranking Predictor v3 (multi-model what-if studio)"

# Option A — gh CLI
gh repo create GWU-MBA-Ranking-Predictor-v3 --public --source=. --remote=origin --push

# Option B — manual
git remote add origin git@github.com:<your-user>/GWU-MBA-Ranking-Predictor-v3.git
git push -u origin main
```

Then on vercel.com → Add New Project → import the repo. Vercel auto-detects Vite (`vercel.json` already pins build/output). Subsequent pushes to `main` auto-deploy. v3 lives at its own Vercel project, independent of v1 and v2.

---

## File structure

```
webapp-v3/
├── index.html                    # 3-tab layout, aurora background
├── package.json                  # vite dev on port 3200
├── vite.config.js
├── tailwind.config.js            # aurora palette
├── postcss.config.js
├── vercel.json
├── README.md                     # this file
│
├── styles/
│   └── index.css                 # aurora theme + animations
│
├── src/
│   ├── main.js                   # bootstrap
│   ├── model.js                  # 5-model JS inference engine + Monte Carlo
│   ├── studio.js                 # What-If Studio orchestration
│   ├── sliders.js                # direct sliders (9 indicators + GMAT composite)
│   ├── lever-sliders.js          # indirect levers (CFM-driven)
│   ├── cfm-models.js             # CFM artifacts loader (carry-over)
│   ├── results.js                # rank display + Chart.js histogram (carry-over)
│   ├── tabs.js                   # tab navigation (carry-over)
│   ├── model-insights.js         # Tab 2
│   └── methodology-comparison.js # Tab 3
│
├── public/
│   ├── model_artifacts/          # exported model parameters (~3.1 MB total)
│   │   ├── model_config.json
│   │   ├── scaler_params.json
│   │   ├── model_elasticnet.json
│   │   ├── model_randomforest.json     (~2 MB)
│   │   ├── model_gradientboost.json    (~830 KB)
│   │   ├── model_mlp.json              (~100 KB)
│   │   ├── model_stacked.json
│   │   ├── data_snapshot.json
│   │   ├── feature_ranges.json
│   │   ├── gmat_inference_curves.json
│   │   └── methodology_comparison.json
│   └── cfm_artifacts/            # CFM models (carry-over from v1)
│
└── scripts/
    ├── train_model.py            # 5-model training pipeline
    ├── requirements.txt
    └── training_run.log
```
