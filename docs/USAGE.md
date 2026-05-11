# GWSB Ranking Analytics Studio — Usage Guide

> Companion to the GWSB Ranking Predictor (v2). Use v3 when you need cross-engine sensitivity, rank-uncertainty intervals, or to triangulate v2's linear recommendation against four non-linear alternatives.

---

## What this is, and how it relates to v2

The **GWSB Ranking Analytics Studio** (webapp-v3) is a sensitivity-and-robustness workbench layered on top of the same nine US News methodology indicators that power **v2 (GWSB Ranking Predictor)**. Where v2 produces a single best-estimate rank under one regression engine plus an exact reproduction of the published US News z-score formula, v3 fits five engines to the same stacked 2024 + 2025 panel and lets you switch among them on identical lever settings to read off cross-model agreement. Every prediction is wrapped in a 10,000-draw Monte Carlo that propagates rank-tier-calibrated Gaussian noise on competitor scores, so the rank you see is reported as a median with a 90% interval rather than a point estimate.

| Question | Use v2 | Use v3 |
| --- | --- | --- |
| "What rank does my proposed lever change predict?" | yes — fast single-engine answer | for robustness check after v2 |
| "Is my proposed change methodology-robust or engine-dependent?" | no | yes (toggle 5 engines) |
| "What is the rank uncertainty interval?" | partial (one engine) | yes (90% CI under any engine) |
| "Does the official US News z-score reproduction agree with the regression?" | yes — that is v2's core tab | no — v3 does not host the official calculator |
| "Which CFM features should I trust most when proposing an indirect lever?" | partial (CFM cards) | yes (top-8 popover + confidence badge) |
| "Where do specific peer schools systematically differ from US News?" | partial | yes (Per-School Comparison tab) |
| "Live what-if for a stakeholder meeting" | yes — simpler UI | v3 if the audience wants cross-model context |

v3 inherits v2's nine indicators, the same corrected 5-distribution GMAT/GRE blender, and the same Salary-by-Profession composite with the n ≥ 3 reporter gate. The CFM artifacts are the same `RidgeCV`/`ElasticNetCV` pipelines as v2's Indirect Levers tab. What is new in v3 is the five-engine scoring layer, the dual-panel direct/indirect workspace with a mode toggle, and the per-school reconciliation matrix across all five engines.

---

## Quickstart

### Launching

**Local development**

```bash
cd webapp-v3
npm install            # one-time
npm run dev            # → http://localhost:3200/
```

**Production deploy**

Push to the `main` branch of the linked GitHub repo; Vercel auto-builds via `vite build` and serves `dist/`. Build and output paths are pinned in `vercel.json`. The deployed URL is the project's primary Vercel domain.

### 90-second tour

1. **Read the predicted rank** in the centre-left of Tab 1. The big gradient numeral is the median across 10,000 Monte Carlo draws under the currently-active engine. The cyan pill below it names that engine ("Stacked" by default).
2. **Switch engines** via the strip at the very top of Tab 1. Clicking ElasticNet, Random Forest, Gradient Boosting, Neural Network, or Stacked re-runs the simulation in place — the lever values do not change, only the scoring function does. If the median rank moves substantially between engines, your scenario is engine-sensitive.
3. **Pick a lever mode** via the Direct/Indirect toggle below the result panels. Direct mode lets you edit the nine US News indicator sliders straight. Indirect mode dims the direct sliders and lets you move the 23 operational levers (tuition, applicant demographics, etc.) — the CFMs translate those into predicted indicators, which then feed the same Monte Carlo. Only one mode is interactive at a time so the two lever pathways never overwrite each other.

That is the studio. Everything else — Model Insights (Tab 2) and Per-School Comparison (Tab 3) — is diagnostics for that workspace.

---

## The three tabs at a glance

| # | Tab | When to open it |
| --- | --- | --- |
| 1 | [What-If Studio](#tab-1--what-if-studio) | Primary workspace. Run scenarios, switch engines, read rank distributions. |
| 2 | [Model Insights](#tab-2--model-insights) | Validate that the engine you used for a recommendation has a defensible fit; read coefficients/importances. |
| 3 | [Per-School Comparison](#tab-3--per-school-comparison) | Find peer schools where the engines disagree with US News; build rebuttal data; identify systematic biases. |

> Anchor convention: GitHub renders the em-dash in section headings by emitting a double-hyphen in the slug — the links above use `tab-1--what-if-studio` (etc.) to match. If you fork this doc to a renderer with a different slugger, regenerate the TOC anchors against your renderer's output.

---

## Tab 1 — What-If Studio

### The result panels

The top of Tab 1 is a five-card readout that updates on every lever change (debounced ~250 ms).

#### Current standing card

**What to do with it:** anchor every scenario reading against this. The current standing is GWU's last published US News rank and Overall Score for the snapshot year (2025: rank 69, score 51.0). When you compare to the predicted rank, the delta below is the Monte Carlo's verdict on your scenario.

#### Predicted rank (median + active engine badge)

**What to do with it:** read this as the central tendency of your scenario, not a point estimate. The numeric value is the median of 10,000 simulated rank outcomes under the active engine. The coloured pill underneath names the engine — ElasticNet (violet), Random Forest (emerald), Gradient Boosting (amber), Neural Network (rose), or Stacked Ensemble (cyan). The rank-display gradient also incorporates the engine colour, so a quick visual scan tells you which engine produced what you are looking at.

#### Scenario score (residual-anchored prediction)

**What to do with it:** read this when you need to communicate scale ("we moved from a 51 to a 58") rather than rank. The score is the engine's predicted Overall Score for GWU under the current lever settings, **after residual anchoring** — i.e. the engine's published-year prediction error for every school is added back to its scenario prediction, so the cohort lives on the same scale as the published score and the simulator is not betrayed by systematic engine bias. Without residual anchoring, an engine with even a ~3-point MAE would shift the absolute scale of the cohort and create false rank movement.

#### Rank 90% CI (p5–p95 across 10k draws)

**What to do with it:** treat this as the rank uncertainty under the engine's noise model. The two numbers are the 5th and 95th percentiles of the 10,000-draw rank distribution. Read the width as a sensitivity indicator: a CI of `64–74` is tight and the engine is confident in the placement; a CI of `52–78` means competitor noise could plausibly knock GWU to either side of where the median lands.

Two facts to keep in mind when reading the CI:

- **It does not include lever uncertainty.** The noise model only perturbs competitor scores; GWU's own scenario score is held fixed at its scenario value. If you want sensitivity to your own lever settings, you have to move the levers and re-read.
- **The competitor noise is tier-calibrated.** Top-20 schools get ~0.8 score points of Gaussian noise per draw, rank 21–50 get ~1.5, rank > 50 get ~2.5. Schools near GWU's rank are typically in the rank > 50 tier, so the CI widens fastest when GWU sits in the middle of the cohort.

#### Rank distribution chart

**What to do with it:** look at the shape, not just the median. The histogram shows the probability (in %) of GWU landing at each integer rank across the 10,000 draws. The dark indigo bar is the median; the cyan-shaded bars are the 5–95 CI; pale-grey bars are tail draws outside the CI. A clean unimodal distribution suggests the engine has placed GWU decisively; a bimodal or long-tailed distribution suggests there is a competitor cluster a noise-perturbation away that GWU could easily swap with.

### The scoring engine selector

The strip immediately under the header offers five engines. All five are trained on the same stacked 2024 + 2025 panel (n ≈ 243 school-years × 9 indicators), with 5-fold cross-validation against the published US News Overall Score.

| Engine | What it is | Use it when |
| --- | --- | --- |
| **ElasticNet** | L1+L2-penalised linear regression. Signed coefficients. Same engine as v2's Direct Score Model. | You want interpretability — to read off "a one-σ change in PeerScore moves predicted score by X points". |
| **Random Forest** | 300-tree bagged ensemble, depth 8. Unsigned importances. | You suspect threshold effects (e.g. acceptance rate matters more below 25% than above). Robust to outliers. |
| **Gradient Boosting** | 400 sequentially boosted trees, learning rate 0.05. Unsigned gain-based importances. | Best single non-linear baseline for this panel — comparable MAE to ElasticNet. Use as a tree-engine sanity check. |
| **Neural Network (MLP)** | 64 → 32 → 16 ReLU MLP. Importances approximated by L1 norm of input weights. | You want a smooth non-linear function approximator. Treat MLP results as the "high-flexibility but small-sample-risk" branch. |
| **Stacked Ensemble** *(default)* | Ridge meta-learner over the four base predictions. Meta-coefficients: ElasticNet ≈ 0.54, RF ≈ −0.20, GBM ≈ 0.71, MLP ≈ −0.03. | The default. Lowest cross-validated MAE on this panel. The meta-learner leans on GBM and ElasticNet; the negative RF/MLP weights act as variance-reduction corrections, not endorsements of those engines as standalones. |

#### Why the default is Stacked

The Stacked engine wins every fit statistic on this panel (MAE 2.96, RMSE 3.83, R² 0.967, Spearman ρ 0.978). Because the meta-learner is regularised (Ridge), it cannot over-weight a single noisy base prediction, and the negative weights on RF and MLP mean the ensemble is implicitly subtracting their over-confident tails from the GBM+ElasticNet combination. For routine scenarios, the Stacked engine is the safest default. Switch to a single engine when you need a specific interpretation (signed coefficients → ElasticNet; threshold sensitivity → tree engines).

#### The cross-engine robustness workflow

The whole point of the engine selector is to read the **same lever setting** under five different scoring functions. The workflow:

1. Configure your scenario in Direct or Indirect mode.
2. Note the median rank and 90% CI under the default Stacked engine.
3. Click ElasticNet. The lever values do not change; only the engine does. Note the median rank.
4. Cycle through Random Forest, Gradient Boosting, and Neural Network in turn.
5. If the four non-default engines land within a few rank positions of each other and of Stacked, the scenario is engine-robust — your recommendation does not depend on a single fit. If one engine produces a wildly different rank (more than ~10 positions off the others), open Tab 2 and check that engine's fit statistics and feature signal to understand why.

### The lever-mode toggle (Direct vs Indirect)

Below the result panels is a two-button toggle: **Direct · 9 indicators** and **Indirect · CFM-routed**. Only one is active at a time. The inactive panel is dimmed and non-interactive.

#### Mechanically

| Mode | Source of truth | What feeds the simulation |
| --- | --- | --- |
| **Direct** | Your edits to the 9 indicator sliders | The slider values are fed straight into the engine's scoring function. |
| **Indirect** | Your edits to the 23 operational lever sliders | Each lever feeds the 8 CFMs (one per indicator, minus Salary by Profession). The CFM predictions populate the direct sliders **read-only**, and those CFM-predicted indicator values then feed the same scoring engine. |

Salary by Profession is the one indicator with no CFM, so in Indirect mode it falls back to GWU's last-known SBP composite.

#### Why the modes are mutually exclusive

If you could move a direct slider and an indirect lever at the same time, the direct slider would silently override the CFM prediction on that indicator and you would have a scenario whose provenance you cannot reconstruct — was the change driven by the operational lever or by your direct hand? The toggle enforces a clean experimental design: edit one pathway, observe its full effect on the rank, then switch to the other.

#### When to use each

- **Direct mode** when you are negotiating a specific indicator. You know GWU's PeerScore will move from 3.2 to 3.3 because of a peer-perception campaign; you want to see what the rank does.
- **Indirect mode** when the proposed action is operational, not methodological. You are evaluating a tuition increase, a demographic-targeting shift, or a change to applicant pool size. The CFMs translate that operational input into predicted indicator movement, which then feeds the rank.

### Direct sliders (9 indicators)

The direct panel exposes the nine US News methodology indicators. Each slider's range is calibrated to the observed cohort distribution (rounded out to a defensible interval), and the label shows the indicator's US News weight in the published methodology.

| Indicator | Format | Slider range | US News weight |
| --- | --- | --- | ---: |
| Employed at Graduation | percent | 20%–100% | 7% |
| Employed 3 Months After | percent | 20%–100% | 13% |
| Avg Salary + Bonus | dollar | $80k–$220k | 20% |
| Salary by Profession | ratio (composite) | 0.6–1.4 | 10% |
| Median GPA | number | 3.0–4.0 | 10% |
| Acceptance Rate | percent | 5%–100% | 2% (negated) |
| Peer Assessment Score | number | 1.0–5.0 | 12.5% |
| Recruiter Assessment Score | number | 1.0–5.0 | 12.5% |
| GMAT/GRE Blended Percentile | composite | 0–100 | 13% |

Direct sliders accept either a drag or a click-to-edit on the value chip (which exposes a number input). All values are debounced ~250 ms before re-running the simulation, so dragging quickly does not block the UI.

#### Special composite: GMAT/GRE blender

The GMAT slider is a composite control, not a single number, because US News blends across up to five test distributions (old GMAT, new GMAT, GRE Quantitative, GRE Verbal, GRE Analytical Writing). The control exposes:

- A scale toggle (**Old GMAT** 200–800 / **New GMAT** 205–805) — most schools still report old-scale; new-scale was introduced for tests after 2023.
- An optional **GRE block** (Q, V, AW) gated by a checkbox. Enabled, the GRE sub-score uses the canonical 40/40/20 internal blend (40% Q + 40% V + 20% AW) on per-year cohort percentile ranks.
- The blended chip shows the final 0–100 percentile after cross-exam submission-proportion weighting (driven internally by GWU's `pct_gmat_old`, `pct_gmat_new`, `pct_gre`).

If the GRE block is disabled, the blended score is just the percentile of the active GMAT scale. The blender does **not** apply v1's spurious "<25% submission penalty" — that was a v1-only bug, corrected in v2 and inherited correctly into v3.

#### Special composite: Salary by Profession

The SBP slider exposes a 2×N grid of `(median salary, n reporters)` pairs across seven professions:

1. Consulting
2. Finance / Accounting
3. General Management
4. Marketing / Sales
5. Operations / Production
6. Management Information Systems (MIS)
7. Human Resources

For each profession, the composite computes `school_salary / cohort_mean_salary`. Professions with fewer than 3 reporters (`n < 3`) are dropped from the average, mirroring the US News methodology. The displayed chip value is the **n-weighted mean** of the surviving ratios. The cohort mean for each profession is computed across the entire 2024 + 2025 panel; the studio shows it as small grey text next to each profession row so you can sanity-check whether GWU's per-profession salary is above or below cohort.

### Indirect levers

The indirect panel exposes 23 operational levers. They are grouped by the primary CFM target each one most influences (i.e. the CFM where that lever has the largest `|coefficient|`), and each group is colour-coded to match the affected indicator.

| Group (primary affected indicator) | Lever count | Examples |
| --- | --- | --- |
| Avg Salary + Bonus | varies | Most economic-signal levers route here because salary is the highest-confidence CFM |
| Peer Assessment | varies | Reputational and demographic levers |
| Recruiter Assessment | varies | Recruiter-pool proxies |
| Median GPA | varies | GPA submission %, undergrad-major mix |
| GMAT/GRE | varies | GMAT/GRE submission counts, test-optional flag |
| Acceptance Rate | varies | Applicant pool size, application fee |
| Employed 3 Mo / Employed at Grad | varies | Outcome-correlated demographics |
| Other (unranked) | varies | Levers with very small coefficients in all CFMs |

Submission-percentage levers (`% submitting old GMAT`, `% submitting new GMAT`, `% submitting GRE`, `% submitting GPA`) are rendered as **absolute counts** (e.g. "12 of 73") rather than fractions, because operational planners think in students, not percentages. The JS silently divides by GWU's full-time enrollment (73 in 2025) before sending the lever to the CFM.

#### Hover popover semantics (top-8 CFM features + confidence badge)

Hovering (or focusing) the header pill of any indirect-lever group opens a popover with two things:

1. **The CFM's top-8 features ranked by `|coefficient|` share.** The horizontal bar shows each feature's percentage contribution to the prediction; a `+` (emerald) or `−` (rose) symbol tells you the direction. Read this as "if I move this lever up, the CFM-predicted indicator moves up/down by roughly this share".
2. **A confidence badge** in the upper right. High/Medium/Low reflects the CFM's out-of-sample fit on the held-out year, with the following thresholds:

| Indicator (CFM target) | Confidence | Weight | Grouped-CV R² | Temporal-holdout R² |
| --- | --- | ---: | ---: | ---: |
| Avg Salary + Bonus | **High** | 1.00 | 0.802 | 0.801 |
| Peer Assessment | **High** | 1.00 | 0.762 | 0.833 |
| GMAT (Combined) | **High** | 1.00 | 0.650 | 0.606 |
| Median GPA | Medium | 0.60 | 0.294 | 0.272 |
| Acceptance Rate | Medium | 0.60 | 0.233 | 0.341 |
| Recruiter Assessment | Medium | 0.60 | 0.387 | 0.370 |
| Employed at Graduation | Low | 0.25 | 0.065 | 0.004 |
| Employed 3 Months After | Low | 0.25 | 0.080 | −0.034 |

A Low-confidence CFM is not useless — its predictions still propagate through the simulator — but the lever pathway is noisy enough that you should not rest a strategic recommendation on it alone. For employment-outcome CFMs in particular, treat the indirect lever pathway as exploratory and validate by editing the direct indicator slider as well.

### Reset behavior

The **Reset all levers to GWU's 2025 values** button at the bottom of the workspace resets:

- Every direct slider to GWU's published 2025 value for that indicator.
- Every indirect lever to GWU's published 2025 value for that input.
- The GMAT scale toggle to its dataset-derived default (old-scale, GRE off).
- The SBP composite to GWU's per-profession salaries and reporter counts.

It does **not** change the active engine or the lever mode. The simulation re-runs once after reset.

---

## Tab 2 — Model Insights

Tab 2 is read-only diagnostics. Use it to validate that the engine you used for a Tab 1 recommendation has defensible fit, and to read the engine's per-indicator signal (coefficients for linear engines, importances for tree engines, weight magnitudes for the MLP).

### Engine diagnostics matrix

The cross-validated fit matrix sits at the top-left. The five rows are the five engines; the four numeric columns are MAE, RMSE, R², and Spearman ρ.

| Engine | MAE ↓ | RMSE ↓ | R² ↑ | Spearman ρ ↑ |
| --- | ---: | ---: | ---: | ---: |
| ElasticNet | 3.11 | 4.01 | 0.964 | 0.978 |
| Random Forest | 3.59 | 4.78 | 0.949 | 0.965 |
| Gradient Boosting | 3.08 | 4.01 | 0.964 | 0.974 |
| Neural Network (MLP) | 3.71 | 5.51 | 0.932 | 0.955 |
| **Stacked Ensemble** | **2.96** | **3.83** | **0.967** | **0.978** |

#### How to read each metric

- **MAE** is the average absolute miss in published-score points. Lower is better. Use this as your "typical error" — a Stacked MAE of ~3 points means that on average the engine's predicted Overall Score is within 3 points of the published score.
- **RMSE** penalises large misses more than MAE. Compare MAE and RMSE on the same row — a large RMSE-MAE gap means the engine has a few very bad predictions. The gap is largest for MLP (5.51 vs 3.71), telling you that the neural network has a thicker error tail.
- **R²** is the share of cohort score variance the engine explains. All five engines exceed 0.93, which is high; differences of 0.01–0.03 are still meaningful given the small panel.
- **Spearman ρ** is rank-order correlation against US News' published ranking. This is the metric to prioritise when your downstream use is a rank prediction, not a score prediction. An engine can have a higher R² but lower Spearman if it gets the scale right but mis-orders adjacent schools, and vice versa.

#### Which to prioritise for what question

- "Will my recommendation move our rank by ≥3 positions?" → prioritise **Spearman ρ** (rank-order). The Stacked and ElasticNet engines tie at 0.978.
- "Will my score-on-the-published-scale exceed a threshold?" → prioritise **MAE**. The Stacked engine wins.
- "Could there be an outlier prediction at a peer school that throws off comparison?" → look at **RMSE − MAE** gap. The smallest is ElasticNet (4.01 − 3.11 = 0.90).
- "Across-the-board fit" → **R²**. Stacked wins, then ElasticNet and Gradient Boosting tied at 0.964.

### R² vs MAE scatter

The chart to the right of the matrix plots R² (left axis) and MAE (right axis) for the five engines. The visual goal is **top-right with low MAE** — high explained variance and low error. The Stacked engine occupies that quadrant.

### Per-indicator signal

The bottom panel is a horizontal bar chart of feature signal, with a model picker at the right. Click any engine to swap the chart.

#### How to switch engines via the picker

The picker mirrors the Tab 1 engine selector but is local to this panel — switching it does not change the Tab 1 active engine. Each click re-renders the bar chart with the picked engine's feature signal.

#### Signed vs unsigned interpretation per engine type

- **ElasticNet** — Bars are **signed coefficients on standardised features**. A +6.4 on `PeerScore` means a 1-σ change in standardised PeerScore moves predicted score by 6.4 points. These are directly interpretable and are the same coefficients as v2's Direct Score Model.
- **Random Forest** — Bars are **mean impurity-decrease importances**. Unsigned. They tell you which features the trees split on most often; direction must be inferred from partial dependence plots (not currently in v3).
- **Gradient Boosting** — Bars are **cumulative gain across boosting rounds**. Unsigned. Large bars flag features the boosting sequence relies on heavily — typically these include both signal and a small amount of redundancy with other features.
- **Neural Network (MLP)** — Bars are the **L1 norm of input-to-first-hidden-layer weights**. Unsigned. This is a leverage proxy in the absence of a closed-form importance for deep nets.
- **Stacked Ensemble** — Bars are the **Ridge meta-coefficients over the four base predictions** (not over the indicators). A positive meta-coefficient means the ensemble adds that base engine's prediction to the final score; a negative meta-coefficient is a variance-reduction subtraction, not a vote against that engine.

A useful diagnostic: compare ElasticNet's signed coefficients to the unsigned importances from RF and GBM on the same indicator. If all three engines flag the same indicator as high-magnitude **and** ElasticNet's sign is intuitive, the indicator's effect is method-robust. If RF and GBM disagree on magnitude or if ElasticNet flips sign vs the tree engines' partial dependence (typical pattern: weak indicator with collinear features), the indicator's effect is method-dependent and your recommendation on that indicator alone is fragile.

---

## Tab 3 — Per-School Comparison

Tab 3 reconciles every school in the published 2025 cohort against all five engines. Use it to find the schools where the engines systematically agree or disagree with US News, which is the raw material for: validating Tab 1 recommendations against peer schools, sourcing rebuttal data for indicator submissions, and identifying CFM-refinement opportunities.

### Summary cards

The top row of Tab 3 shows one card per engine, with three numbers:

- **Pearson ρ** of engine ranks against published ranks across the full cohort.
- **Mean |Δrank|** — average absolute disagreement in rank positions per school.
- **Mean |Δscore|** — average absolute disagreement in score points per school.

Read these as cohort-wide summaries. A Pearson ρ ≥ 0.98 with a Mean |Δrank| ≤ 1.5 means the engine essentially reproduces the published ranking on average; a Pearson ρ near 0.95 with a Mean |Δrank| of 3+ means the engine is systematically reorganising a few clusters of schools.

### Reconciliation table

Below the cards is a per-school table. Columns:

- **School** — name.
- **Pub Rk / Pub Sc** — published US News rank and Overall Score for the snapshot year (2025).
- For each engine, a pair of columns: **Rank** (the engine's predicted rank for that school) and **Δ** (the signed delta against the published rank). The Δ is colour-coded: emerald for positive (engine placed school worse than US News, i.e. higher rank number), rose for negative (engine placed school better).

#### Search + sort

- The **search box** (top-right) filters by school name (case-insensitive substring match). Useful for narrowing to a peer set (e.g. "Tepper", "Owen", "Smith").
- The **sort buttons** below the search let you sort by **Published rank** (default ascending) or by `|Δ|` for any single engine. Sorting by an engine's `|Δ|` surfaces that engine's worst disagreements — i.e. the schools where the engine and US News most disagree, regardless of direction.

#### Δrank semantics

`Δrank = (engine rank) − (published rank)`. The sign convention:

- **Δrank > 0 (emerald)** — the engine places the school **worse** than US News did. Example: a school US News ranks #20 that the engine predicts at #28 has Δrank = +8.
- **Δrank < 0 (rose)** — the engine places the school **better** than US News did.

The emerald-for-positive convention is intentional: emerald is the "engine sees worse performance than published" signal, which is the rhetorical direction for **rebutting** a published ranking. Schools with consistent positive Δrank across multiple engines are candidates for the rebuttal-data workflow described below.

---

## Common analytical workflows

The next eight subsections are concrete worked examples. Each is a sequence of clicks you can follow without further help.

### 1. Sanity-check a v2 GMAT-lever recommendation against v3

You have a v2 ElasticNet-based recommendation saying that moving GWU's GMAT blended percentile from 29.8 to 35.0 will improve predicted rank by ~3 positions. Validate that this holds up under the four non-linear engines.

1. Open Tab 1 (What-If Studio). Confirm the **Direct** lever mode is active and Stacked is the engine.
2. Note the baseline median rank and 90% CI under Stacked (this is the "no-change" reference). Then click the GMAT slider's chip and type `35.0`. Note the new median rank and CI.
3. Switch the engine to **ElasticNet** — this is v2's engine. Confirm the rank delta matches v2's recommendation.
4. Cycle through **Random Forest**, **Gradient Boosting**, and **Neural Network**, noting the median rank under each.
5. If all five engines move the rank in the same direction and the spread of rank deltas across engines is within ~2 positions, the recommendation is engine-robust. If GBM or MLP shows a much larger or smaller effect than ElasticNet, open Tab 2 and inspect the GMAT signal under each engine to understand why — typically the tree engines find a non-linear effect (e.g. the gain stalls below the 30th percentile) that ElasticNet cannot represent.

### 2. Identify schools we systematically beat (or lose to) across engines

Find the peer schools where every engine ranks GWU above (or below) the published ranking.

1. Open Tab 3 (Per-School Comparison).
2. Use the search box to type a peer name (e.g. "Tepper"). Read the row across — note GWU's row separately by typing "George Washington".
3. To find systematic patterns instead of one-school spot checks, clear the search and sort by `|Δ Stacked|`. Read the top 10 rows: these are schools where the best engine most disagrees with US News.
4. Cross-check by sorting by `|Δ ElasticNet|`. Schools appearing in both top-10 lists are systematic disagreements, not engine-specific quirks.
5. For each persistent disagreement, scroll the row horizontally to check whether all five Δ columns share a sign. Five-engine agreement on the direction of the disagreement is the signal you want for either a rebuttal (consistently positive Δ → engines say the school deserves better) or a competitive read (consistently negative Δ → engines say the school is overranked vs its inputs).

### 3. Stress-test GWU's rank under worst-case competitor noise

The 90% CI in Tab 1 already shows you the bulk of the rank distribution. The question this workflow answers: how far into the tail of the distribution can GWU plausibly land?

1. Open Tab 1. Configure your scenario in Direct or Indirect mode.
2. Note the median rank and the 90% CI. The 90% CI captures p5–p95; the remaining 10% of the distribution is split between worse-than-p95 and better-than-p5 outcomes.
3. Look at the distribution chart's pale-grey bars (outside the CI). The right tail represents the worst-case competitor-noise draws. If that right tail extends more than 8–10 positions past the median, GWU's placement is noise-sensitive even given the lever setting.
4. Compare the worst-case spread across engines by cycling the engine selector. If the right-tail extent under Random Forest or Gradient Boosting is meaningfully larger than under ElasticNet or Stacked, the tree engines' non-linearities are amplifying competitor noise — a real signal that the rank could shift more than the linear engine implies.
5. Note that the noise model itself is tier-calibrated and held constant across engines — what differs is how the engine's score function translates a given competitor-score perturbation into a rank swap. So tail differences across engines are an engine-specific risk, not a noise-model risk.

### 4. Compare a tuition-driven scenario vs an academic-prep-driven scenario on the same predicted rank

Two strategic levers (a tuition reduction and an applicant-pool quality lift) might both target the same +5 rank improvement. Which is the methodologically safer recommendation?

1. Open Tab 1, switch to **Indirect** mode.
2. Configure scenario A: move `FT tuition (out of state)` down by your proposed amount; reset other levers. Note the median rank, the 90% CI, and the indicator group whose CFM most drove the change (read the popovers).
3. Click **Reset all levers to GWU's 2025 values**.
4. Configure scenario B: move `% submitting GPA`, `% submitting new GMAT`, and the average GMAT levers up. Note the same three readings.
5. Compare the two scenarios on three axes: (a) which produces the better median rank, (b) which has the tighter 90% CI, (c) which one's primary CFMs are higher-confidence. Scenario B's primary CFM is GMAT (High confidence, R² 0.65). Scenario A's primary CFM is whichever AvgSalaryBonus-affected lever's coefficient is largest — also High confidence on AvgSalaryBonus (R² 0.80). Equal-confidence scenarios with similar rank deltas: prefer the one with the tighter CI.

### 5. Find indicators where the linear engine disagrees with the tree engines

Useful when you suspect an indicator has a non-linear effect that ElasticNet under-represents.

1. Open Tab 2 (Model Insights).
2. In the per-indicator signal panel, switch the model picker to **ElasticNet**. Note the top 3 signed coefficients by magnitude — these are the indicators ElasticNet relies on most.
3. Switch the picker to **Gradient Boosting**. Note the top 3 importances by magnitude.
4. Indicators that appear in ElasticNet's top 3 but **not** in GBM's top 3 (or vice versa) are method-dependent. Common pattern: AcceptanceRate is small for ElasticNet (linear, 2% US News weight) but can be middling for GBM (threshold effect at low acceptance rates).
5. To diagnose direction-disagreement, drop back to Tab 1, switch to Direct mode, and move the suspect indicator across its range with ElasticNet active. Note the rank trajectory. Switch to Gradient Boosting and repeat. If the rank trajectories disagree in **direction** (e.g. one engine improves rank with higher acceptance rate, the other improves with lower), the indicator's effect is genuinely method-dependent; report the disagreement as a finding rather than picking a side.

### 6. Validate a CFM by checking which of its features the ensemble actually depends on

Before submitting an indirect-lever-based recommendation, verify that the levers driving the CFM's prediction are levers GWU can actually influence.

1. Open Tab 1, switch to **Indirect** mode.
2. Locate the lever group whose primary indicator your recommendation targets (e.g. **Avg Salary + Bonus** for an industry-targeting recommendation).
3. Hover the group's header pill. The popover lists the top-8 features the AvgSalaryBonus CFM depends on, ranked by `|coefficient|` share, with direction (+/−) and confidence badge.
4. Cross-check: are GWU's controllable levers among the top 8? If the CFM is dominated by demographic features (age, prior work experience, undergraduate-major mix) that GWSB cannot move on a 1–2 year horizon, your recommendation is mechanically valid but practically unactionable. Re-frame as a long-horizon target or escalate to admissions-strategy partners.
5. If a lever you proposed is in the top 8 with the **opposite** sign of what you assumed, the CFM is telling you the operational direction is reversed. Investigate before committing to the recommendation.

### 7. Identify peer schools for indicator-submission rebuttals

US News occasionally reviews indicator-level data submissions. When preparing a rebuttal, you want to find peer schools whose indicator submissions look anomalous relative to multi-engine predictions.

1. Open Tab 3.
2. Sort by `|Δ Stacked|`. Read the top 20 rows.
3. For each row, look across all five engine Δ columns. A school where four or five engines all say the published rank is too low (negative Δ) is a candidate for a "this school's published indicators look inflated" comparison. A school where four or five engines say the published rank is too high (positive Δ) is a candidate for an "even our most conservative engine predicts this school should be ranked lower" comparison.
4. Filter to a peer set (e.g. type "Maryland", "American", "Tepper" sequentially and note rows) to find peer-bench rebuttal examples in your competitive set.
5. The methodology comparison file underlying this tab is per-school, so once you have a shortlist you can read the indicator-level data from Tab 1's Direct mode by typing each school's name (note: Tab 1 currently only edits GWU; cross-school direct read requires opening the underlying JSON snapshot in `public/model_artifacts/data_snapshot.json`).

### 8. Diagnose why two engines give very different ranks on the same lever setting

Two engines (say ElasticNet and Gradient Boosting) produce predicted ranks that differ by more than 10 positions on identical Tab 1 settings.

1. Open Tab 2. Note the cross-validated MAE for both engines. Even an MAE gap of ~1 point can produce a several-position rank swing on a tight panel.
2. Look at the per-indicator signal panel. Switch between the two engines and identify the indicators where the magnitudes diverge most.
3. Return to Tab 1. Reset to GWU baseline. Move the divergent indicators one at a time and watch the rank under each engine. The indicator whose movement drives the rank divergence is the source of the disagreement.
4. Decide: if the divergent indicator has a known non-linear effect (e.g. low-acceptance-rate threshold), trust the tree engine. If the divergent indicator is approximately linear in the dataset, trust ElasticNet. If you cannot decide, report the disagreement and use the Stacked engine as the default — the Stacked meta-learner has already integrated both base predictions with cross-validated weights.

---

## Reading the Monte Carlo distribution

### What a 10,000-draw simulation actually means

For every scenario, the simulator does the following 10,000 times:

1. Compute the engine-predicted score for every school in the cohort under the current scenario indicators.
2. Add the school's published-vs-predicted residual back to its scenario prediction (the **residual anchoring** step), so the cohort lives on the published score scale.
3. For each competitor school (i.e. every school except GWU), draw a Gaussian random perturbation with a rank-tier-calibrated standard deviation (0.8 / 1.5 / 2.5 score points for top-20, 21–50, > 50). For GWU, the perturbation is zero — the scenario score is held fixed.
4. Rank all schools by perturbed score, descending. Record GWU's rank.

After all 10,000 draws, the simulator sorts the rank sequence and reads three summaries:

- **Median rank** — the 50th percentile.
- **90% CI** — the 5th and 95th percentiles.
- **Full distribution** — the empirical histogram, plotted on the chart.

The simulation is engine-agnostic in structure: the same Monte Carlo loop runs regardless of which engine is selected. What changes is the score function in steps 1 and 2.

### How the 90% CI is constructed

The CI is read directly off the empirical rank distribution: `p5 = ranks[500]`, `p95 = ranks[9500]` after sorting. There is no parametric assumption; the CI reflects whatever shape the rank distribution actually takes under the noise model. This means a wide CI is honest about uncertainty and a narrow CI honestly reflects decisive placement under the tier-calibrated noise.

### Why tier-calibrated competitor noise matters

A flat noise model (e.g. 1.5 score points of noise for every competitor regardless of rank) would over-estimate uncertainty for top-20 schools, whose scores are tightly packed and well-measured, and under-estimate uncertainty for the long tail, where score reporting is sparser and more volatile. The tier-calibrated model encodes the observed score-clustering by tier:

| Rank tier | Noise σ (score points) |
| ---: | ---: |
| Top 20 | 0.8 |
| 21–50 | 1.5 |
| > 50 | 2.5 |

GWU at rank 69 has many neighbours in the > 50 tier, so the competitor noise is highest in the region where GWU is most exposed to rank swaps. This is by design — under-stating noise there would understate the practical rank uncertainty most relevant to GWSB.

### What you cannot conclude from a single run

The simulator uses `Math.random()` for the Gaussian draws (Box–Muller from two uniforms), without a fixed seed. Two consecutive runs of the same scenario will produce **slightly** different histograms — typically within 1 rank position on the median and within 1–2 positions on the CI endpoints. For decisions that hinge on rank movement of less than ~2 positions:

- Re-run the simulation by nudging a slider and nudging it back. Read the median again. Repeat 3–4 times to get a sense of run-to-run variance.
- For publication-grade scenarios, consider exporting the rank distribution and running the simulator yourself with a fixed seed (this requires patching `gaussianRandom()` in `src/model.js` to use a seeded RNG; the present default is unseeded for live-feel responsiveness).

A 1-rank median difference between two scenarios is below the noise floor of a single run and should not be reported as a meaningful effect. A 3+ rank median difference is robust to re-runs.

---

## Caveats and known limitations

> **Small training panel.** The five engines and the eight CFMs are all trained on n ≈ 243 school-years × 9 indicators (and n ≈ 117 for the GMAT CFM, which has more missingness). A non-linear engine like the MLP has substantially more parameters than this dataset can saturate, and its CV performance reflects that — MAE 3.71 vs Stacked's 2.96. Treat the MLP as the "high-flexibility but small-sample-risk" branch of the ensemble; do not give it dispositive weight on a recommendation.

> **CFM confidence varies by indicator.** Three of the eight CFMs are High confidence (AvgSalaryBonus, PeerScore, GMAT_Combined). Three are Medium (MedianGPA, AcceptanceRate, RecruiterScore). Two are Low (EmployedAtGrad, Employed3Mo). For the Low-confidence pair the temporal-holdout R² is near zero — the CFM is essentially predicting the cohort mean. Indirect-mode recommendations that route through an employment-outcome CFM should be cross-checked by moving the equivalent direct slider; if the rank changes substantially in Direct mode but barely moves in Indirect mode, the CFM is absorbing the operational signal in a way the simulator cannot reverse.

> **Simulation assumes US News methodology weights are stable year-over-year.** All five engines are fit on the 2024 + 2025 panel under the current US News methodology (the 2023 methodology refresh that added Salary by Profession and corrected the GMAT/GRE blend). If US News changes weights or adds/removes indicators in a future year, the engines will need to be re-trained. The studio does not auto-detect methodology drift.

> **Engines disagree on direction in some indicators.** The unsigned importances from tree engines and the L1-norm leverage from the MLP cannot tell you direction. Where ElasticNet's signed coefficient is small, the tree engines may be picking up an indicator's interaction or threshold effect with the opposite sign in different regions of the input space. Do not assume that "this indicator is important to ElasticNet" generalises to "this indicator has the same sign of effect in the tree engines" without inspecting Tab 1 rank trajectories.

> **v3 is a planning tool, not a guarantee.** The MAE of even the best engine is ~3 points on the 0–100 published score scale, and the rank median has 1–2 positions of run-to-run noise. The studio is built to surface scenarios for stakeholder discussion and to triangulate v2's single-engine recommendation against a multi-engine reading. It does not predict the literal next-year published rank — it predicts the rank that would obtain if the scenario indicators were the published indicators under the same methodology and the same approximate competitor field.

---

## Glossary

| Term | Definition |
| --- | --- |
| **Direct slider** | One of the nine US News methodology indicator sliders in Tab 1's Direct mode. Edits feed the scoring engine directly. |
| **Indirect lever** | One of the 23 operational lever sliders in Tab 1's Indirect mode. Edits feed the CFMs, whose predictions feed the direct sliders read-only, which then feed the scoring engine. |
| **CFM (Core Feature Model)** | One of the eight `RidgeCV`/`ElasticNetCV` regression pipelines that map indirect levers to a predicted indicator value. One CFM per indicator (excluding Salary by Profession). |
| **Engine** | One of the five scoring functions: ElasticNet, Random Forest, Gradient Boosting, Neural Network (MLP), or Stacked Ensemble. Each engine maps the nine indicator values to a predicted Overall Score. |
| **Stacked Ensemble** | The default engine. A Ridge meta-learner over the four base-engine predictions. Meta-coefficients on the current panel: ElasticNet ≈ 0.54, RF ≈ −0.20, GBM ≈ 0.71, MLP ≈ −0.03. |
| **MAE** | Mean Absolute Error — average absolute miss in published-score points; lower is better. |
| **RMSE** | Root Mean Squared Error — penalises large misses more than MAE; lower is better. |
| **R²** | Coefficient of determination — share of cohort score variance explained by the engine; higher is better, 1.00 is perfect. |
| **Spearman ρ** | Rank-order correlation between engine ranks and US News published ranks across the cohort; higher is better, 1.00 is identical ordering. |
| **Δrank** | `(engine rank) − (published rank)` for a single school. Positive (emerald) = engine placed the school worse than US News; negative (rose) = engine placed it better. |
| **Residual anchoring** | The simulation step that adds each school's published-vs-engine residual back to its scenario prediction, so cohort scores live on the published scale and the simulator is not betrayed by engine bias. |
| **Tier-calibrated noise** | The Monte Carlo's per-competitor Gaussian noise σ. 0.8 for top-20, 1.5 for ranks 21–50, 2.5 for ranks > 50. GWU's own scenario score is held fixed (σ = 0). |
| **p5–p95** | The 5th and 95th percentile of the empirical rank distribution across the 10,000 Monte Carlo draws. The width is the 90% confidence interval on the predicted rank. |

---

## Architectural diagram

The indirect-lever pathway is mechanically:

```
[Indirect lever sliders]
        │
        ▼
[8 CFMs: RidgeCV / ElasticNetCV per indicator]
        │
        ▼
[Direct sliders, populated read-only with CFM predictions]
        │
        ▼
[Active scoring engine: EN | RF | GBM | MLP | Stacked]
        │
        ▼
[10,000-draw Monte Carlo with tier-calibrated competitor noise]
        │
        ▼
[Median rank + 90% CI + scenario score + distribution histogram]
```

In Direct mode, the lever-slider → CFM stage is bypassed entirely; user edits hit the direct sliders, which feed the engine directly. In Indirect mode, the direct sliders are dimmed and serve only as a display surface for the CFM predictions before they enter the engine.

---

## Troubleshooting

### "Predictions look wrong"

A predicted rank that seems incompatible with the inputs typically has one of three causes.

1. **The active engine is not what you think it is.** Look at the cyan/coloured pill under the rank-display gradient. The pill name and the rank-display colour both indicate the active engine. Cycle through the engine selector and see if the rank converges with what you expect under one of them.
2. **The active lever mode is not what you think it is.** Look at the mode-toggle copy above the lever workspace. If it says "Indirect — operational levers route through the Core Feature Models", your direct-slider edits are inactive. Switch to Direct mode.
3. **A direct slider hit its slider-range clamp.** The slider min/max are calibrated to the cohort, not to your scenario. If you intended to set a value outside the slider range, you cannot — the value is clamped to the nearest endpoint. Check the value chip against your target.

If none of those apply, the engine genuinely is producing the prediction you see, and the next step is Tab 2: read the engine's signed coefficients (ElasticNet) or unsigned importances (tree/MLP) to understand why this scenario produces this rank under this engine.

### "Sliders don't move"

The most common cause: you are looking at the inactive lever panel. The inactive panel is dimmed and non-interactive by design — only the lever mode currently selected via the mode toggle accepts input. If you want to edit the dimmed panel's sliders, click the other mode-toggle button first.

If the active panel's sliders also don't respond, hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) to bypass the Vite HMR cache.

### "Two engines give very different ranks"

Workflow 8 above covers this in detail. The short answer: the engines have genuinely different score functions, and a substantial rank gap on the same lever setting means the scenario has hit a region of the indicator space where one engine sees a non-linear effect (or interaction) that another engine cannot represent.

Decision rule:

- If you can name the non-linearity (e.g. a known acceptance-rate threshold), trust the tree engines.
- If the indicator is approximately linear in the panel, trust ElasticNet.
- If you cannot decide, trust the Stacked engine. The Stacked meta-learner has cross-validated weights over all four base engines; on this panel the meta-coefficients are 0.54 EN, −0.20 RF, 0.71 GBM, −0.03 MLP, which means the Stacked rank is mostly a weighted average of GBM and ElasticNet with RF and MLP acting as variance-reduction corrections.

### "Indirect levers don't update the rank"

Three checks:

1. **Confirm Indirect mode is active.** The mode-toggle copy should read "Indirect — operational levers route through the Core Feature Models". If it reads "Direct", switch.
2. **Confirm the lever is in the CFM's feature columns.** Every lever in the panel is by construction in at least one CFM. If you move a lever and the direct-slider chips do not update, the lever's coefficients across all eight CFMs are very small — typically the case for the levers grouped under "Other (unranked)".
3. **Confirm the CFM is High or Medium confidence.** A Low-confidence CFM (EmployedAtGrad, Employed3Mo) will produce nearly the same prediction regardless of lever movement, because the model is essentially predicting the cohort mean. The lever still moves; its effect is just below the simulator's noise floor.

If the indirect-lever movement should affect a High-confidence CFM (AvgSalaryBonus, PeerScore, GMAT_Combined) and the direct-slider chip does not update at all, the issue is likely a stale cache — hard-refresh.
