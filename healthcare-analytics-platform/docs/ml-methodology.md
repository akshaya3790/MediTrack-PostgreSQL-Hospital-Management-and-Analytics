# Machine learning: methods and results

There are three models in `ml/`. They read only `analytics_marts` and write only to `analytics_ml` and `ml/artifacts/`.

> **Intended use.** These models support operational planning only: sending reminders, staffing and spotting capacity pressure. They must never be used for clinical decisions, or to refuse, delay or deprioritise anyone's care.

```bash
pip install -r ml/requirements.txt
python ml/train.py                    # all three
python ml/train.py --model forecast   # or classifier / segments
python -m pytest -q ml/tests          # 12 tests, no database needed
```

Every training run records the following, in `analytics_ml.model_runs` and in a versioned folder `ml/artifacts/<model>/<UTC time>_<dataset hash>/` (`model.joblib` plus `model_card.json`):

* its status
* whether the data was synthetic
* a SHA-256 of the exact training rows (`dataset_version`)
* row counts, parameters, metrics and baseline metrics
* explanations and notes

If there is not enough data for an honest test, the run is recorded as `insufficient_data`, with the reason, and no model is produced.

## Results on the real sample database

The hospital database in this project holds 3 sample appointments, so all three models correctly refused to train:

| Model | Status | Reason recorded |
|---|---|---|
| Not-completed classifier | insufficient_data | Needs at least 500 past appointments with a patient and 30 not completed; found 3 and 0. |
| Demand forecast | insufficient_data | Needs at least 30 complete weeks of history; found 1. |
| Patient segments | insufficient_data | Needs at least 50 patients with visits; found 0. |

## Results on the synthetic demo database

> These numbers come from **fictional data** (seed 42, 26,306 appointments generated over two years, trained on 29 October 2026). They show that the pipeline, validation and comparison with baselines work end to end. They say nothing about real patients. The generator decides who "misses" an appointment with a documented rule, `notCompletedProbability()` in `src/tools/synthetic.js`. That rule mainly uses the patient's earlier misses, Mondays and Saturdays, afternoons, winter months and department. A model that finds these patterns is rediscovering the generator, not learning about people.

### 1. Not-completed (no-show proxy) classifier

**Label.** A past appointment still marked `NotDone`. The hospital app has no explicit no-show or cancelled status, so this proxy also counts visits that happened but were never marked done.

**Features.** All are known before the appointment, and the patient-history features use only earlier appointments:

* start hour, weekday, month and department
* the number of earlier appointments and earlier misses, and the earlier miss rate
* days since the previous visit

**Validation.** Strictly by time:

| Period | Dates | Used for |
|---|---|---|
| Training | before 9 Jan 2026 (oldest 60%) | Fitting the candidate models |
| Validation | 9 Jan to 4 Jun 2026 | Choosing the model and the alert threshold |
| Test | 4 Jun to 28 Oct 2026 (newest 20%, 5,016 appointments) | Reported metrics, never seen before |

The chosen model is then refitted on training plus validation.

**Candidates.**

* Logistic regression, with scaled numeric features and one-hot categories.
* Gradient boosting (scikit-learn HistGradientBoosting).

Gradient boosting won on validation PR-AUC (0.213 against 0.194). Classes are not re-weighted, so the scores stay usable as probabilities.

**Baseline.** The patient's own earlier miss rate, or the overall rate for a first visit. This is the rule a receptionist could apply by hand.

| Metric (test period) | Model | Baseline (own past rate) |
|---|---:|---:|
| ROC-AUC | 0.641 | 0.624 |
| PR-AUC | 0.194 | 0.180 |
| Brier score (lower is better) | 0.113 | 0.120 |
| Brier score of always predicting the base rate | 0.116 | |
| Alert threshold (chosen on validation) | 0.132 | |
| Precision at threshold | 0.185 | 0.179 |
| Recall at threshold | 0.689 | 0.528 |
| F1 | 0.292 | 0.267 |
| Share of appointments flagged | 49.7% | 39.4% |
| Actual not-completed rate | 13.3% | 13.3% |

**Calibration.** In ten equal-size bins of the test period, the predicted probability tracks the observed rate. For example, the lowest bin predicted 5.8% against 3.0% observed, and the highest predicted 24.0% against 22.3%. The full table is in `model_runs.explanation.calibration`.

**What the model relies on.** Permutation importance, measured as the drop in test ROC-AUC when a feature is shuffled:

* prior misses: 0.074
* prior miss rate: 0.032
* prior appointments: 0.012
* every other feature: 0.004 or less

**Honest reading.** The model is only a little better than the simple baseline, and both are weak (ROC-AUC near 0.64). The generator is noisy by design: a single appointment's outcome is mostly chance. Flagging half of all appointments to catch 69% of misses could suit a cheap SMS reminder, but not anything costly. On real data, expect different numbers, and retrain before trusting any of them.

### 2. Weekly demand forecast

**Target.** Non-removed appointments per department per ISO week, 4 weeks ahead. Only complete weeks are used for training and scoring, because the current and future weeks hold bookings made so far.

**Candidates.**

* Seasonal naive: the same week last year.
* 8-week moving average.
* A ridge regression across all departments on department-scaled demand. Its inputs are lags 1–4 and 52, an 8-week mean and week-of-year sine and cosine terms. It forecasts recursively: later weeks use earlier predictions, never actuals.

**Validation.** A rolling-origin backtest over the last 12 weekly origins. At each origin, every model is refitted on earlier weeks only and forecasts the next 4 weeks for all 10 departments, giving 480 forecasts per model. The model with the lowest MAE is chosen.

| Model | MAE (appointments/week) | RMSE | sMAPE |
|---|---:|---:|---:|
| **Ridge on lags (chosen)** | **3.51** | **4.47** | **15.9%** |
| 8-week moving average (best baseline) | 4.14 | 5.44 | 18.1% |
| Seasonal naive | 4.57 | 5.86 | 20.7% |

MAE by horizon for the chosen model was 3.44, 3.48, 3.60 and 3.51 for weeks 1 to 4.

**Intervals.** The 80% interval comes from the 10th and 90th percentiles of the model's relative backtest errors at each horizon. To check it fairly, intervals built from the older half of the origins were tested on the newer half. They covered **77%** of actual weeks, a little under the 80% target. The dashboard shows the interval as a shaded band.

### 3. Patient visit-pattern segments

**Features.** Behaviour only, per patient over the last two years:

* number of visits
* median days between visits
* not-completed rate
* number of departments
* days since the last visit

Counts and days are log-transformed, then all features are standardised. No medical or personal attributes are used.

**Method.** k-means for k = 2 to 6. The k with the best silhouette score is kept, provided every segment has at least 5 patients.

| k | 2 | **3** | 4 | 5 | 6 |
|---|---:|---:|---:|---:|---:|
| Silhouette | 0.406 | **0.415** | 0.358 | 0.290 | 0.306 |

The labels are generated from each segment's profile compared with the overall median:

| Segment | Patients | Visits (median) | Days between visits (median) | Not-completed rate (mean) | Departments (mean) |
|---|---:|---:|---:|---:|---:|
| Frequent, recent visitors, several departments | 903 | 18 | 26 | 11% | 7.8 |
| Occasional, lapsed visitors | 899 | 3 | 114.5 | 2% | 2.6 |
| Occasional, lapsed visitors, often not completed | 196 | 3 | 119 | 58% | 2.5 |

**Honest reading.** A silhouette of 0.41 means the segments are reasonably but not cleanly separated. Segments describe how people use the hospital, not who they are. Only these summaries are stored.

## Guarding against leakage and overclaiming

| Risk | Guard | Test |
|---|---|---|
| Future data in features | Patient-history features use frames ending at `1 PRECEDING`. Forecasts are recursive. | `test_ridge_recursion_does_not_see_future_actuals` |
| Random splits on time data | All splits are by date, and the backtest is rolling-origin | `test_time_split_never_trains_on_later_dates`, `test_backtest_forecasts_only_from_the_past_and_outputs_intervals` |
| Partial weeks scored as actuals | Only complete weeks are used | `test_only_complete_weeks_are_used` |
| Training on too little data | Minimum sizes, otherwise `insufficient_data` | `test_small_data_is_reported_not_forced`, `test_short_history_is_insufficient`, `test_too_few_patients` |
| Results that cannot be traced to data | SHA-256 dataset version on every run and artifact | `test_dataset_version_is_deterministic_and_sensitive` |
| Storing individual segment membership | Only summaries are written | `test_segments_store_only_summaries` |
| Synthetic results mistaken for real | `is_synthetic` on every run, a banner on the dashboard, and labels in these docs | |
