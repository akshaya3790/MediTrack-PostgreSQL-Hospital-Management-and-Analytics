"""Loads model inputs from the analytics marts. Patient identity never leaves the database except
as the warehouse surrogate number, which is used only to group visits and is never stored."""
import hashlib

import pandas as pd
import psycopg

from .config import db_settings


def connect():
    conn = psycopg.connect(**db_settings(), options="-c default_transaction_read_only=on")
    return conn


def _frame(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [c.name for c in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def dataset_info(conn):
    df = _frame(conn, "SELECT is_synthetic, label FROM analytics_meta.dataset_info LIMIT 1")
    if df.empty:
        return {"is_synthetic": False, "label": "Hospital data"}
    return {"is_synthetic": bool(df.is_synthetic[0]), "label": str(df.label[0])}


def appointment_features(conn):
    df = _frame(conn, """
        SELECT appointment_id, appt_date, start_hour, iso_dow, month_num, department_name,
               prior_appointments, prior_not_completed, prior_not_completed_rate, days_since_previous,
               label_not_completed
        FROM analytics_marts.ml_appointment_features
        WHERE appt_date < CURRENT_DATE
        ORDER BY appt_date, start_hour, appointment_id""")
    if not df.empty:
        df["appt_date"] = pd.to_datetime(df["appt_date"])
        for col in ["prior_not_completed_rate", "days_since_previous"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
        df["label_not_completed"] = df["label_not_completed"].astype(int)
    return df


def weekly_demand(conn):
    df = _frame(conn, """
        SELECT week_start, department_name, appointments
        FROM analytics_marts.weekly_department_demand
        ORDER BY department_name, week_start""")
    if not df.empty:
        df["week_start"] = pd.to_datetime(df["week_start"])
        df["appointments"] = df["appointments"].astype(float)
    return df


def patient_behaviour(conn, days=730):
    """One row per patient (surrogate number only), visit behaviour over the last `days` days."""
    df = _frame(conn, """
        WITH v AS (
          SELECT patient_sk, appt_date, department_name, status,
                 appt_date - LAG(appt_date) OVER (PARTITION BY patient_sk ORDER BY appt_date, start_hour, appointment_id) AS gap
          FROM analytics_marts.appointments
          WHERE NOT is_removed AND patient_sk IS NOT NULL
            AND appt_date < CURRENT_DATE AND appt_date >= CURRENT_DATE - %s::int
        )
        SELECT patient_sk,
               COUNT(*) AS visits,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap) AS gap_days_median,
               AVG((status = 'unresolved')::int) AS not_completed_rate,
               COUNT(DISTINCT department_name) AS departments,
               CURRENT_DATE - MAX(appt_date) AS recency_days
        FROM v GROUP BY patient_sk""", (days,))
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
    return df


def dataset_version(df):
    """SHA-256 of the exact rows used for training, so a result can be tied to its data."""
    if df.empty:
        return None
    hashed = pd.util.hash_pandas_object(df.reset_index(drop=True), index=False).values.tobytes()
    return hashlib.sha256(hashed).hexdigest()
