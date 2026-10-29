"""Database settings, read from healthcare-analytics-platform/.env (same file as the Node services)."""
import os
from pathlib import Path

PLATFORM_DIR = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = PLATFORM_DIR / "ml" / "artifacts"


def _read_env_file(path):
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def db_settings():
    env = {**_read_env_file(PLATFORM_DIR / ".env"), **os.environ}
    return {
        "host": env.get("ANALYTICS_DB_HOST", "localhost"),
        "port": int(env.get("ANALYTICS_DB_PORT", "5432")),
        "dbname": env.get("ANALYTICS_DB_NAME", "hms"),
        "user": env.get("ANALYTICS_DB_USER", "hms_analytics"),
        "password": env.get("ANALYTICS_DB_PASSWORD") or None,
    }
