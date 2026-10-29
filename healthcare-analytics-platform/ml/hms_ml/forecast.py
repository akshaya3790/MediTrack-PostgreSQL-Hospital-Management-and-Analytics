"""Weekly appointment demand per department, four weeks ahead.

Candidates: seasonal naive (same week last year), 8-week moving average, and a ridge regression on
lagged demand with week-of-year terms. All are scored on a rolling-origin backtest over the most
recent complete weeks; the winner forecasts the next four weeks. The 80% interval comes from the
10th and 90th percentiles of the winner's relative backtest errors at each horizon. Its coverage is
checked honestly: percentiles from the older half of the backtest origins are tested on the newer half.
"""
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

HORIZON = 4
BACKTEST_ORIGINS = 12
MIN_WEEKS = 30
LAGS = [1, 2, 3, 4, 52]


def smape(actual, forecast):
    a, f = np.asarray(actual, float), np.asarray(forecast, float)
    denom = np.abs(a) + np.abs(f)
    return float(np.mean(np.where(denom == 0, 0.0, 2 * np.abs(a - f) / np.where(denom == 0, 1, denom))) * 100)


def error_metrics(actual, forecast):
    a, f = np.asarray(actual, float), np.asarray(forecast, float)
    return {"mae": float(np.mean(np.abs(a - f))), "rmse": float(np.sqrt(np.mean((a - f) ** 2))), "smape": smape(a, f)}


def complete_weeks(weekly, today):
    """Only weeks that have fully ended; the current and future weeks hold partial bookings."""
    this_week = pd.Timestamp(today) - pd.Timedelta(days=pd.Timestamp(today).weekday())
    return weekly[weekly.week_start < this_week]


# ---------- candidate forecasters: history (1-D array, oldest first) -> next HORIZON values ----------
def seasonal_naive(history, weeks):
    if len(history) >= 52:
        return np.array([history[len(history) - 52 + h] for h in range(HORIZON)], float)
    return np.repeat(history[-1], HORIZON).astype(float)


def moving_average(history, weeks, window=8):
    return np.repeat(np.mean(history[-window:]), HORIZON).astype(float)


def _features(values, week_start):
    woy = week_start.isocalendar().week
    row = {f"lag_{k}": values[-k] if len(values) >= k else np.nan for k in LAGS}
    row["mean_8"] = float(np.mean(values[-8:]))
    row["sin_woy"], row["cos_woy"] = np.sin(2 * np.pi * woy / 52.18), np.cos(2 * np.pi * woy / 52.18)
    return row


class RidgeLags:
    """One ridge regression across departments on lagged, department-scaled demand (fitted per origin)."""
    name = "ridge_lags"

    def fit(self, series_by_dept):
        rows, ys = [], []
        for weeks, values in series_by_dept.values():
            scale = max(np.mean(values), 1.0)
            v = values / scale
            for i in range(8, len(v)):
                rows.append(_features(v[:i], weeks[i]))
                ys.append(v[i])
        x = pd.DataFrame(rows)
        self.fill = x.median()
        self.columns = list(x.columns)
        self.model = Ridge(alpha=1.0).fit(x.fillna(self.fill), ys)
        return self

    def predict(self, history, weeks):
        scale = max(np.mean(history), 1.0)
        v = list(history / scale)
        out = []
        for h in range(HORIZON):
            week = weeks[-1] + pd.Timedelta(weeks=h + 1)
            x = pd.DataFrame([_features(np.array(v), week)])[self.columns].fillna(self.fill)
            pred = max(float(self.model.predict(x)[0]), 0.0)
            out.append(pred * scale)
            v.append(pred)  # recursive: later horizons use earlier predictions, never actuals
        return np.array(out)


def _series(weekly):
    out = {}
    for dep, g in weekly.groupby("department_name"):
        g = g.sort_values("week_start")
        out[dep] = (list(g.week_start), g.appointments.to_numpy(float))
    return out


def backtest(weekly):
    """Rolling origin: at each of the last BACKTEST_ORIGINS origins, fit on data before it, forecast 4 weeks."""
    series = _series(weekly)
    n = min(len(v) for _, v in series.values())
    errors = {"seasonal_naive": [], "moving_average_8w": [], "ridge_lags": []}
    for origin in range(n - BACKTEST_ORIGINS - HORIZON + 1, n - HORIZON + 1):
        cut = {d: (w[:origin], v[:origin]) for d, (w, v) in series.items()}
        ridge = RidgeLags().fit(cut)
        for dep, (weeks, values) in series.items():
            hist, hist_w, actual = values[:origin], weeks[:origin], values[origin:origin + HORIZON]
            for name, pred in [("seasonal_naive", seasonal_naive(hist, hist_w)),
                               ("moving_average_8w", moving_average(hist, hist_w)),
                               ("ridge_lags", ridge.predict(hist, hist_w))]:
                for h in range(HORIZON):
                    errors[name].append({"origin": origin, "department": dep, "horizon": h + 1, "actual": actual[h], "forecast": pred[h]})
    return {k: pd.DataFrame(v) for k, v in errors.items()}


def interval_coverage(e):
    """Share of newer-half backtest actuals inside an interval built only from older-half errors."""
    origins = np.sort(e.origin.unique())
    older, newer = e[e.origin.isin(origins[: len(origins) // 2])], e[e.origin.isin(origins[len(origins) // 2:])]
    q = older.groupby("horizon").ratio_error.quantile([0.1, 0.9]).unstack()
    lo = newer.forecast * (1 + newer.horizon.map(q[0.1]))
    hi = newer.forecast * (1 + newer.horizon.map(q[0.9]))
    return float(((newer.actual >= lo) & (newer.actual <= hi)).mean())


def train(weekly, today=None):
    today = today or pd.Timestamp.today().normalize()
    weekly = complete_weeks(weekly, today)
    if weekly.empty:
        return {"status": "insufficient_data", "notes": "There are no complete weeks of appointments yet."}
    weeks_available = weekly.week_start.nunique()
    if weeks_available < MIN_WEEKS:
        return {"status": "insufficient_data",
                "notes": f"Needs at least {MIN_WEEKS} complete weeks of history; found {weeks_available}."}
    errors = backtest(weekly)
    scores = {name: error_metrics(e.actual, e.forecast) for name, e in errors.items()}
    chosen = min(scores, key=lambda k: scores[k]["mae"])
    baselines = {k: v for k, v in scores.items() if k != "ridge_lags"}
    best_baseline = min(baselines, key=lambda k: baselines[k]["mae"])

    # Interval from backtest residuals of the chosen model, per horizon (scaled to the department's level)
    e = errors[chosen].copy()
    e["ratio_error"] = (e.actual - e.forecast) / np.maximum(e.forecast, 1.0)
    within = interval_coverage(e)
    quant = e.groupby("horizon").ratio_error.quantile([0.1, 0.9]).unstack()

    series = _series(weekly)
    ridge = RidgeLags().fit(series) if chosen == "ridge_lags" else None
    rows = []
    for dep, (weeks, values) in series.items():
        pred = ridge.predict(values, weeks) if ridge else (seasonal_naive if chosen == "seasonal_naive" else moving_average)(values, weeks)
        for h in range(HORIZON):
            f = float(pred[h])
            rows.append({"department_name": dep, "week_start": (weeks[-1] + pd.Timedelta(weeks=h + 1)).date(),
                         "forecast": round(f, 2),
                         "lower_80": round(max(0.0, f * (1 + quant.loc[h + 1, 0.1])), 2),
                         "upper_80": round(max(0.0, f * (1 + quant.loc[h + 1, 0.9])), 2)})
    by_h = errors[chosen].groupby("horizon").apply(lambda g: error_metrics(g.actual, g.forecast)["mae"], include_groups=False)
    return {
        "status": "trained",
        "model": ridge,
        "train_rows": int(len(weekly)),
        "test_rows": int(len(errors[chosen])),
        "params": {"chosen_model": chosen, "horizon_weeks": HORIZON, "backtest_origins": BACKTEST_ORIGINS,
                   "last_complete_week": str(max(weekly.week_start).date()), "lags": LAGS},
        "metrics": {**scores[chosen], "interval_coverage_backtest": float(within), "mae_by_horizon": {int(k): float(v) for k, v in by_h.items()}},
        "baseline_metrics": {**scores[best_baseline], "baseline": best_baseline, "all": scores},
        "explanation": {"all_models": scores},
        "forecast": pd.DataFrame(rows),
        "notes": f"Chosen by lowest backtest MAE: {chosen}. The 80% interval covered {within:.0%} of held-out backtest weeks.",
    }
