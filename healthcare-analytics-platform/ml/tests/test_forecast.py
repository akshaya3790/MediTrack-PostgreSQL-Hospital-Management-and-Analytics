import numpy as np
import pandas as pd

from hms_ml import forecast


def weekly(weeks=104, seed=3):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2024-01-01")  # a Monday
    rows = []
    for dep, level in [("A", 30), ("B", 12)]:
        for i in range(weeks):
            season = 1 + 0.2 * np.sin(2 * np.pi * i / 52)
            rows.append({"week_start": start + pd.Timedelta(weeks=i), "department_name": dep,
                         "appointments": float(rng.poisson(level * season))})
    return pd.DataFrame(rows)


def test_smape_and_errors():
    assert forecast.smape([0, 0], [0, 0]) == 0
    assert round(forecast.smape([100], [50]), 2) == 66.67
    e = forecast.error_metrics([1, 2, 3], [1, 2, 5])
    assert e["mae"] == 2 / 3 and round(e["rmse"], 4) == round(np.sqrt(4 / 3), 4)


def test_only_complete_weeks_are_used():
    df = weekly()
    today = df.week_start.max() + pd.Timedelta(days=2)  # midway through the last week
    assert forecast.complete_weeks(df, today).week_start.max() < df.week_start.max()


def test_short_history_is_insufficient():
    df = weekly(weeks=20)
    result = forecast.train(df, today=df.week_start.max() + pd.Timedelta(days=7))
    assert result["status"] == "insufficient_data"


def test_backtest_forecasts_only_from_the_past_and_outputs_intervals():
    df = weekly()
    result = forecast.train(df, today=df.week_start.max() + pd.Timedelta(days=7))
    assert result["status"] == "trained"
    fc = result["forecast"]
    assert len(fc) == 2 * forecast.HORIZON
    assert (fc.lower_80 <= fc.forecast).all() and (fc.forecast <= fc.upper_80).all() and (fc.lower_80 >= 0).all()
    assert pd.to_datetime(fc.week_start).min() > df.week_start.max()
    assert set(result["baseline_metrics"]["all"]) == {"seasonal_naive", "moving_average_8w", "ridge_lags"}
    assert 0 <= result["metrics"]["interval_coverage_backtest"] <= 1


def test_ridge_recursion_does_not_see_future_actuals():
    df = weekly()
    series = {d: (list(g.week_start), g.appointments.to_numpy(float)) for d, g in df.groupby("department_name")}
    cut = {d: (w[:60], v[:60]) for d, (w, v) in series.items()}
    model = forecast.RidgeLags().fit(cut)
    w, v = series["A"]
    changed_future = v.copy()
    changed_future[60:] = 9999
    assert np.allclose(model.predict(v[:60], w[:60]), model.predict(changed_future[:60], w[:60]))
