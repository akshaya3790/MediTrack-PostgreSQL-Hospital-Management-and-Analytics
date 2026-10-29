import numpy as np
import pandas as pd

from hms_ml import classifier


def make_features(n=3000, seed=1):
    rng = np.random.default_rng(seed)
    dates = pd.to_datetime("2025-01-01") + pd.to_timedelta(np.sort(rng.integers(0, 365, n)), unit="D")
    prior = rng.integers(0, 10, n)
    prior_nc = np.minimum(prior, rng.binomial(prior, 0.2))
    logit = -2.2 + 0.5 * prior_nc
    y = rng.random(n) < 1 / (1 + np.exp(-logit))
    return pd.DataFrame({
        "appointment_id": np.arange(n), "appt_date": dates, "start_hour": rng.integers(8, 17, n),
        "iso_dow": rng.integers(1, 7, n), "month_num": dates.month, "department_name": rng.choice(["A", "B", "C"], n),
        "prior_appointments": prior, "prior_not_completed": prior_nc,
        "prior_not_completed_rate": np.where(prior > 0, prior_nc / np.maximum(prior, 1), np.nan),
        "days_since_previous": np.where(prior > 0, rng.integers(1, 200, n), np.nan).astype(float),
        "label_not_completed": y.astype(int),
    })


def test_time_split_never_trains_on_later_dates():
    df = make_features()
    train, valid, test = classifier.time_split(df)
    assert train.appt_date.max() < valid.appt_date.min()
    assert valid.appt_date.max() < test.appt_date.min()
    assert len(train) + len(valid) + len(test) == len(df)


def test_small_data_is_reported_not_forced():
    result = classifier.train(make_features(n=200))
    assert result["status"] == "insufficient_data"
    assert "500" in result["notes"]


def test_trains_and_beats_constant_brier_on_learnable_signal():
    result = classifier.train(make_features())
    assert result["status"] == "trained"
    m, b = result["metrics"], result["baseline_metrics"]
    assert 0.5 < m["roc_auc"] <= 1
    assert m["brier"] < b["brier_constant_base_rate"]
    cm = m["confusion_matrix"]
    assert sum(cm.values()) == result["test_rows"]
    assert result["explanation"]["permutation_importance"][0]["feature"].startswith("prior_not_completed")


def test_metrics_handle_single_class():
    m = classifier.score_metrics(np.zeros(10), np.linspace(0, 1, 10), 0.5)
    assert m["roc_auc"] is None and m["recall"] == 0
