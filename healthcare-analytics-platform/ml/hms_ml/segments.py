"""Patient visit-pattern segments (k-means on behaviour only: visits, gaps, not-completed rate,
departments, recency). Only segment summaries are stored, never which patient is in which segment."""
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

FEATURES = ["visits", "gap_days_median", "not_completed_rate", "departments", "recency_days"]
MIN_PATIENTS = 50
MIN_SEGMENT = 5


def _matrix(df):
    x = df[FEATURES].copy()
    x["gap_days_median"] = x["gap_days_median"].fillna(x["recency_days"])  # one visit: no gap yet
    x["visits"] = np.log1p(x["visits"])
    x["gap_days_median"] = np.log1p(x["gap_days_median"])
    x["recency_days"] = np.log1p(x["recency_days"])
    return StandardScaler().fit_transform(x)


def _label(profile, overall):
    parts = []
    parts.append("frequent" if profile["visits_median"] > overall["visits_median"] * 1.5
                 else "occasional" if profile["visits_median"] < overall["visits_median"] * 0.67 else "regular")
    parts.append("recent" if profile["recency_days_median"] <= overall["recency_days_median"] else "lapsed")
    label = f"{parts[0].capitalize()}, {parts[1]} visitors"
    if profile["not_completed_rate_mean"] > max(0.2, overall["not_completed_rate_mean"] * 1.5):
        label += ", often not completed"
    if profile["departments_mean"] > overall["departments_mean"] * 1.3:
        label += ", several departments"
    return label


def _profile(g):
    return {"visits_median": float(g.visits.median()), "gap_days_median": float(g.gap_days_median.median()) if g.gap_days_median.notna().any() else None,
            "not_completed_rate_mean": float(g.not_completed_rate.mean()), "departments_mean": float(g.departments.mean()),
            "recency_days_median": float(g.recency_days.median())}


def train(df, k_range=range(2, 7), seed=7):
    if len(df) < MIN_PATIENTS:
        return {"status": "insufficient_data", "notes": f"Needs at least {MIN_PATIENTS} patients with visits; found {len(df)}."}
    x = _matrix(df)
    sample = np.random.default_rng(seed).choice(len(x), size=min(len(x), 5000), replace=False)
    scores = {}
    for k in k_range:
        labels = KMeans(n_clusters=k, n_init=10, random_state=seed).fit_predict(x)
        if np.min(np.bincount(labels)) < MIN_SEGMENT:
            continue
        scores[k] = float(silhouette_score(x[sample], labels[sample]))
    if not scores:
        return {"status": "insufficient_data", "notes": "Every segmentation tried produced a segment smaller than 5 patients."}
    k = max(scores, key=scores.get)
    model = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(x)
    data = df.assign(segment=model.labels_)
    overall = _profile(data)
    segments = []
    for seg, g in data.groupby("segment"):
        p = _profile(g)
        segments.append({"segment": int(seg), "label": _label(p, overall), "patients": int(len(g)), "profile": p})
    segments.sort(key=lambda s: -s["patients"])
    for i, s in enumerate(segments):
        s["segment"] = i
    return {
        "status": "trained",
        "model": model,
        "train_rows": int(len(df)),
        "test_rows": None,
        "params": {"k": k, "features": FEATURES, "scaling": "log1p on counts and days, then standardised"},
        "metrics": {"silhouette": scores[k], "k": k},
        "baseline_metrics": {"silhouette_by_k": {str(kk): v for kk, v in scores.items()}},
        "explanation": {"overall": overall},
        "segments": segments,
        "notes": f"{k} segments chosen by the best silhouette score ({scores[k]:.2f}; 1 is perfectly separated, 0 is overlapping).",
    }
