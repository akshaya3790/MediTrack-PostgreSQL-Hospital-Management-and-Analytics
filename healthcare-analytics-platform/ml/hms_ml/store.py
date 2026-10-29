"""Saves versioned artifacts to ml/artifacts and results to the analytics_ml tables."""
import json
from datetime import datetime, timezone

import joblib
from psycopg.types.json import Jsonb

from .config import ARTIFACT_DIR


def _clean(obj):
    return json.loads(json.dumps(obj, default=str))


def save_artifact(model_name, result, dataset, version):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder = ARTIFACT_DIR / model_name / f"{stamp}_{(version or 'none')[:12]}"
    folder.mkdir(parents=True, exist_ok=True)
    if result.get("model") is not None:
        joblib.dump(result["model"], folder / "model.joblib")
    card = {
        "model_name": model_name, "status": result["status"], "trained_at": stamp,
        "dataset": dataset, "dataset_version": version,
        "train_rows": result.get("train_rows"), "test_rows": result.get("test_rows"),
        "params": result.get("params", {}), "metrics": result.get("metrics", {}),
        "baseline_metrics": result.get("baseline_metrics", {}), "notes": result.get("notes"),
        "intended_use": "Operational planning only (reminders, staffing). Not for clinical decisions or to refuse care.",
    }
    (folder / "model_card.json").write_text(json.dumps(_clean(card), indent=2), encoding="utf-8")
    return folder


def write_results(conn, model_name, result, dataset, version, artifact_path):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO analytics_ml.model_runs
                 (model_name, status, is_synthetic, dataset_label, dataset_version, train_rows, test_rows,
                  params, metrics, baseline_metrics, explanation, artifact_path, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING model_run_id""",
            (model_name, result["status"], dataset["is_synthetic"], dataset["label"], version,
             result.get("train_rows"), result.get("test_rows"),
             Jsonb(_clean(result.get("params", {}))), Jsonb(_clean(result.get("metrics", {}))),
             Jsonb(_clean(result.get("baseline_metrics", {}))), Jsonb(_clean(result.get("explanation", {}))),
             str(artifact_path) if artifact_path else None, result.get("notes")))
        run_id = cur.fetchone()[0]
        if result["status"] == "trained" and "forecast" in result:
            cur.executemany(
                """INSERT INTO analytics_ml.demand_forecast (model_run_id, department_name, week_start, forecast, lower_80, upper_80)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                [(run_id, r.department_name, r.week_start, r.forecast, r.lower_80, r.upper_80)
                 for r in result["forecast"].itertuples()])
        if result["status"] == "trained" and "segments" in result:
            cur.executemany(
                "INSERT INTO analytics_ml.segment_profiles (model_run_id, segment, label, patients, profile) VALUES (%s, %s, %s, %s, %s)",
                [(run_id, s["segment"], s["label"], s["patients"], Jsonb(_clean(s["profile"]))) for s in result["segments"]])
    return run_id
