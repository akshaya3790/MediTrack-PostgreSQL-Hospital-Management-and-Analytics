"""Not-completed (no-show proxy) classifier.

Label: a past appointment still marked NotDone. The hospital app has no explicit no-show status,
so this proxy also includes visits a doctor forgot to mark Done.
Classes are not re-weighted, so the scores stay usable as probabilities (checked with the Brier score
and a calibration table); the imbalance is handled by choosing the alert threshold instead.
Validation is strictly time based: train on the oldest 60%, choose the model and threshold on the
next 20%, report on the newest 20%. Nothing from a later period is used to fit an earlier one.
"""
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NUMERIC = ["start_hour", "prior_appointments", "prior_not_completed", "prior_not_completed_rate", "days_since_previous"]
CATEGORICAL = ["iso_dow", "month_num", "department_name"]
FEATURES = NUMERIC + CATEGORICAL
MIN_ROWS = 500
MIN_POSITIVES = 30


def time_split(df, train=0.6, valid=0.2):
    """Split by appointment date so every validation and test row is later than every training row."""
    dates = np.sort(df["appt_date"].unique())
    if len(dates) < 3:
        raise ValueError("need at least three distinct dates")
    cut1 = dates[int(len(dates) * train)]
    cut2 = dates[int(len(dates) * (train + valid))]
    return (df[df.appt_date < cut1], df[(df.appt_date >= cut1) & (df.appt_date < cut2)], df[df.appt_date >= cut2])


def _prep(df):
    x = df[FEATURES].copy()
    x["has_history"] = (x["prior_appointments"] > 0).astype(int)
    x["days_since_previous"] = x["days_since_previous"].clip(upper=730)
    for c in CATEGORICAL:
        x[c] = x[c].astype(str)
    return x


def _candidates():
    pre_linear = ColumnTransformer([
        ("num", Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)), ("scale", StandardScaler())]),
         NUMERIC + ["has_history"]),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
    ])
    pre_tree = ColumnTransformer([
        ("num", "passthrough", NUMERIC + ["has_history"]),
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
    ])
    return {
        "logistic_regression": Pipeline([("pre", pre_linear),
                                         ("clf", LogisticRegression(max_iter=2000, C=1.0))]),
        "gradient_boosting": Pipeline([("pre", pre_tree),
                                       ("clf", HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05,
                                                                              max_leaf_nodes=15,
                                                                              random_state=7))]),
    }


def _best_threshold(y, score):
    """Threshold with the best F1 on the validation period (chosen before the test period is seen)."""
    best = (0.5, -1.0)
    for t in np.unique(np.quantile(score, np.linspace(0.5, 0.99, 50))):
        f1 = f1_score(y, score >= t, zero_division=0)
        if f1 > best[1]:
            best = (float(t), f1)
    return best[0]


def score_metrics(y, score, threshold):
    pred = score >= threshold
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    single_class = len(np.unique(y)) < 2
    return {
        "roc_auc": None if single_class else float(roc_auc_score(y, score)),
        "pr_auc": None if single_class else float(average_precision_score(y, score)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "flagged_share": float(pred.mean()),
        "base_rate": float(np.mean(y)),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def calibration_table(y, prob, bins=10):
    """Mean predicted probability against observed rate, in equal-size bins of the test period."""
    df = pd.DataFrame({"y": y, "p": prob})
    df["bin"] = pd.qcut(df["p"].rank(method="first"), q=min(bins, len(df)), labels=False)
    out = df.groupby("bin").agg(predicted=("p", "mean"), observed=("y", "mean"), n=("y", "size")).reset_index(drop=True)
    return [{k: (float(v) if k != "n" else int(v)) for k, v in row.items()} for row in out.to_dict("records")]


def baseline_scores(train, frame):
    """History rule: the patient's own past not-completed rate, or the training base rate when unknown."""
    base = train["label_not_completed"].mean()
    return frame["prior_not_completed_rate"].fillna(base).to_numpy()


def train(df):
    """Returns a result dict; status 'insufficient_data' when the data cannot support an honest test."""
    n_pos = int(df["label_not_completed"].sum()) if len(df) else 0
    if len(df) < MIN_ROWS or n_pos < MIN_POSITIVES:
        return {"status": "insufficient_data",
                "notes": f"Needs at least {MIN_ROWS} past appointments with a patient and {MIN_POSITIVES} not completed; "
                         f"found {len(df)} and {n_pos}."}
    tr, va, te = time_split(df)
    for name, part in [("training", tr), ("validation", va), ("test", te)]:
        if part["label_not_completed"].nunique() < 2:
            return {"status": "insufficient_data", "notes": f"The {name} period has only one outcome, so it cannot be scored."}

    xtr, xva, xte = _prep(tr), _prep(va), _prep(te)
    ytr, yva, yte = tr.label_not_completed.to_numpy(), va.label_not_completed.to_numpy(), te.label_not_completed.to_numpy()

    validation = {}
    fitted = {}
    for name, model in _candidates().items():
        model.fit(xtr, ytr)
        fitted[name] = model
        validation[name] = float(average_precision_score(yva, model.predict_proba(xva)[:, 1]))
    chosen = max(validation, key=validation.get)

    # Refit the chosen model on train + validation; the threshold comes from the validation period
    threshold = _best_threshold(yva, fitted[chosen].predict_proba(xva)[:, 1])
    model = _candidates()[chosen]
    model.fit(pd.concat([xtr, xva]), np.concatenate([ytr, yva]))
    prob = model.predict_proba(xte)[:, 1]
    metrics = score_metrics(yte, prob, threshold)
    metrics["brier"] = float(brier_score_loss(yte, prob))

    trva = pd.concat([tr, va])
    base_val = baseline_scores(tr, va)
    base_threshold = _best_threshold(yva, base_val)
    baseline = score_metrics(yte, baseline_scores(trva, te), base_threshold)
    baseline["brier"] = float(brier_score_loss(yte, np.clip(baseline_scores(trva, te), 0, 1)))
    constant = float(np.mean(np.concatenate([ytr, yva])))
    baseline["brier_constant_base_rate"] = float(brier_score_loss(yte, np.full(len(yte), constant)))

    imp = permutation_importance(model, xte, yte, scoring="roc_auc", n_repeats=5, random_state=7)
    importance = sorted(({"feature": f, "importance": float(m), "std": float(s)}
                         for f, m, s in zip(xte.columns, imp.importances_mean, imp.importances_std)),
                        key=lambda r: -r["importance"])

    return {
        "status": "trained",
        "model": model,
        "train_rows": int(len(trva)),
        "test_rows": int(len(te)),
        "params": {"chosen_model": chosen, "threshold": threshold, "features": list(xte.columns),
                   "split": {"train_until": str(va.appt_date.min().date()), "validation_until": str(te.appt_date.min().date()),
                             "test_until": str(te.appt_date.max().date())},
                   "validation_pr_auc": validation},
        "metrics": metrics,
        "baseline_metrics": baseline,
        "explanation": {"permutation_importance": importance, "calibration": calibration_table(yte, prob)},
        "notes": "Predicts which booked appointments may end not completed (a no-show proxy). For reminders and planning only.",
    }
