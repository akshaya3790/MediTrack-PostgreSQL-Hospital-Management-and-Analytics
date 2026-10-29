-- Reporting views for the dashboard, the SQL analyses and the ML module.
-- Views (not copies), so they always agree with the warehouse.

CREATE SCHEMA IF NOT EXISTS analytics_marts;

-- One row per appointment with its date, doctor, department and status labels.
-- The patient appears only as a surrogate number for distinct counts; the API never returns it.
CREATE OR REPLACE VIEW analytics_marts.appointments AS
SELECT f.appointment_id,
       d.full_date        AS appt_date,
       d.week_start,
       d.month_start,
       d.iso_dow,
       d.day_name,
       f.start_hour,
       f.duration_minutes,
       f.department_sk,
       dep.department_name,
       f.doctor_sk,
       doc.doctor_key,
       doc.doctor_name,
       doc.is_demo        AS doctor_is_demo,
       f.patient_sk,
       s.status_code      AS status,
       s.label            AS status_label,
       f.is_removed,
       f.has_diagnosis,
       f.first_seen_at,
       f.observed_lead_days
FROM analytics_warehouse.fact_appointment f
JOIN analytics_warehouse.dim_date d ON d.date_key = f.date_key
JOIN analytics_warehouse.dim_department dep ON dep.department_sk = f.department_sk
JOIN analytics_warehouse.dim_doctor doc ON doc.doctor_sk = f.doctor_sk
JOIN analytics_warehouse.dim_appointment_status s ON s.status_key = f.status_key;

-- Daily operations per department: bookings, outcomes and slot capacity on one grain
CREATE OR REPLACE VIEW analytics_marts.daily_department_operations AS
WITH appts AS (
  SELECT f.date_key, f.department_sk,
         COUNT(*) FILTER (WHERE NOT f.is_removed)                 AS appointments,
         COUNT(*) FILTER (WHERE f.status_key = 2)                 AS completed,
         COUNT(*) FILTER (WHERE f.status_key = 3)                 AS unresolved,
         COUNT(*) FILTER (WHERE f.status_key = 1)                 AS scheduled,
         COUNT(*) FILTER (WHERE f.is_removed)                     AS removed
  FROM analytics_warehouse.fact_appointment f
  GROUP BY f.date_key, f.department_sk
), capacity AS (
  SELECT c.date_key, c.department_sk, SUM(c.scheduled_slots)::INT AS scheduled_slots
  FROM analytics_warehouse.fact_doctor_daily_capacity c
  GROUP BY c.date_key, c.department_sk
)
SELECT d.full_date AS ops_date, d.week_start, d.month_start, d.iso_dow,
       dep.department_sk, dep.department_name,
       COALESCE(a.appointments, 0) AS appointments,
       COALESCE(a.completed, 0)    AS completed,
       COALESCE(a.unresolved, 0)   AS unresolved,
       COALESCE(a.scheduled, 0)    AS scheduled,
       COALESCE(a.removed, 0)      AS removed,
       c.scheduled_slots
FROM appts a
FULL JOIN capacity c ON c.date_key = a.date_key AND c.department_sk = a.department_sk
JOIN analytics_warehouse.dim_date d ON d.date_key = COALESCE(a.date_key, c.date_key)
JOIN analytics_warehouse.dim_department dep ON dep.department_sk = COALESCE(a.department_sk, c.department_sk);

-- Weekly demand per department, the input to demand forecasting.
-- Weeks with no appointments are included as zeros so the series has no gaps.
CREATE OR REPLACE VIEW analytics_marts.weekly_department_demand AS
WITH bounds AS (
  SELECT MIN(d.week_start) AS first_week, MAX(d.week_start) AS last_week
  FROM analytics_warehouse.fact_appointment f
  JOIN analytics_warehouse.dim_date d ON d.date_key = f.date_key
), weeks AS (
  SELECT generate_series(first_week, last_week, INTERVAL '7 days')::DATE AS week_start FROM bounds
), counts AS (
  SELECT d.week_start, f.department_sk, COUNT(*) AS appointments
  FROM analytics_warehouse.fact_appointment f
  JOIN analytics_warehouse.dim_date d ON d.date_key = f.date_key
  WHERE NOT f.is_removed
  GROUP BY d.week_start, f.department_sk
)
SELECT w.week_start, dep.department_sk, dep.department_name,
       COALESCE(c.appointments, 0)::INT AS appointments
FROM weeks w
CROSS JOIN analytics_warehouse.dim_department dep
LEFT JOIN counts c ON c.week_start = w.week_start AND c.department_sk = dep.department_sk;

-- Features for the "not completed" (possible no-show) model. Every feature uses only
-- appointments that happened strictly before this one, so nothing from the future leaks in.
-- Only past, non-removed appointments with a known patient are labelled.
CREATE OR REPLACE VIEW analytics_marts.ml_appointment_features AS
WITH base AS (
  SELECT f.appointment_id, f.patient_sk, d.full_date AS appt_date, f.start_hour,
         d.iso_dow, d.month_num, dep.department_name,
         (f.status_key = 3) AS label_not_completed,
         (f.status_key IN (2, 3)) AS is_past
  FROM analytics_warehouse.fact_appointment f
  JOIN analytics_warehouse.dim_date d ON d.date_key = f.date_key
  JOIN analytics_warehouse.dim_department dep ON dep.department_sk = f.department_sk
  WHERE NOT f.is_removed AND f.patient_sk IS NOT NULL
), history AS (
  SELECT b.*,
         COUNT(*) OVER w                                                  AS prior_appointments,
         COALESCE(SUM(CASE WHEN b.label_not_completed THEN 1 ELSE 0 END) OVER w, 0) AS prior_not_completed,
         LAG(b.appt_date) OVER (PARTITION BY b.patient_sk ORDER BY b.appt_date, b.start_hour, b.appointment_id) AS previous_date
  FROM base b
  WINDOW w AS (PARTITION BY b.patient_sk ORDER BY b.appt_date, b.start_hour, b.appointment_id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
)
SELECT appointment_id, appt_date, start_hour, iso_dow, month_num, department_name,
       prior_appointments,
       prior_not_completed,
       CASE WHEN prior_appointments > 0 THEN prior_not_completed::NUMERIC / prior_appointments END AS prior_not_completed_rate,
       (appt_date - previous_date) AS days_since_previous,
       label_not_completed
FROM history
WHERE is_past;

-- Latest pipeline run and how old the data is
CREATE OR REPLACE VIEW analytics_marts.data_freshness AS
SELECT r.run_id, r.mode, r.status, r.started_at, r.finished_at,
       EXTRACT(EPOCH FROM (NOW() - r.finished_at)) / 3600.0 AS hours_since_refresh
FROM analytics_meta.pipeline_runs r
WHERE r.status IN ('succeeded', 'succeeded_with_warnings') AND r.mode IN ('full', 'incremental')
ORDER BY r.finished_at DESC
LIMIT 1;
