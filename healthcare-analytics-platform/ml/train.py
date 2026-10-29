"""Trains the models and stores their results. Run after the pipeline:
    python ml/train.py                 # all three models
    python ml/train.py --model forecast
Reads analytics_marts, writes analytics_ml and ml/artifacts. Never touches hospital tables."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402

from hms_ml import classifier, data, forecast, segments, store  # noqa: E402
from hms_ml.config import db_settings  # noqa: E402

MODELS = {
    "classifier": ("not_completed_classifier", data.appointment_features, classifier.train),
    "forecast": ("demand_forecast", data.weekly_demand, forecast.train),
    "segments": ("patient_segments", data.patient_behaviour, segments.train),
}


def run(which):
    summary = {}
    with data.connect() as read_conn:
        dataset = data.dataset_info(read_conn)
        inputs = {key: loader(read_conn) for key, (_, loader, _) in MODELS.items() if key in which}
    for key in which:
        name, _, trainer = MODELS[key]
        frame = inputs[key]
        version = data.dataset_version(frame)
        try:
            result = trainer(frame)
        except Exception as err:  # recorded, so a failed run is visible on the dashboard
            result = {"status": "failed", "notes": f"Training failed: {err}"}
        folder = store.save_artifact(name, result, dataset, version)
        with psycopg.connect(**db_settings()) as write_conn:
            run_id = store.write_results(write_conn, name, result, dataset, version, folder.relative_to(folder.parents[2]))
        summary[name] = {"status": result["status"], "model_run_id": run_id,
                         "metrics": result.get("metrics"), "baseline": result.get("baseline_metrics"), "notes": result.get("notes")}
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["all", *MODELS], default="all")
    args = parser.parse_args()
    out = run(list(MODELS) if args.model == "all" else [args.model])
    print(json.dumps(out, indent=2, default=str))
