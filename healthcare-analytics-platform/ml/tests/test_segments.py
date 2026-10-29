import numpy as np
import pandas as pd

from hms_ml import data, segments


def patients(n=400, seed=5):
    rng = np.random.default_rng(seed)
    frequent = rng.random(n) < 0.4
    return pd.DataFrame({
        "patient_sk": np.arange(n, dtype=float),
        "visits": np.where(frequent, rng.integers(10, 30, n), rng.integers(1, 4, n)).astype(float),
        "gap_days_median": np.where(frequent, rng.integers(10, 30, n), rng.integers(60, 300, n)).astype(float),
        "not_completed_rate": rng.random(n) * 0.3,
        "departments": rng.integers(1, 4, n).astype(float),
        "recency_days": rng.integers(1, 400, n).astype(float),
    })


def test_segments_store_only_summaries():
    result = segments.train(patients())
    assert result["status"] == "trained"
    assert sum(s["patients"] for s in result["segments"]) == 400
    for s in result["segments"]:
        assert set(s) == {"segment", "label", "patients", "profile"}
        assert "patient_sk" not in s["profile"]
        assert s["patients"] >= segments.MIN_SEGMENT


def test_too_few_patients():
    assert segments.train(patients(n=20))["status"] == "insufficient_data"


def test_dataset_version_is_deterministic_and_sensitive():
    df = patients()
    assert data.dataset_version(df) == data.dataset_version(df.copy())
    changed = df.copy()
    changed.loc[0, "visits"] += 1
    assert data.dataset_version(df) != data.dataset_version(changed)
    assert data.dataset_version(df.iloc[0:0]) is None
