-- Business question: Within each department, is the workload spread evenly across doctors or concentrated?
-- Definition: Gini coefficient of appointments per doctor over the last 365 days (0 = perfectly even,
--   1 = one doctor does everything), computed as sum((2i - n - 1) * x_i) / (n * sum(x)) with x sorted
--   ascending. top_doctor_share = busiest doctor's appointments / department total.
-- Interpretation: a high Gini with high utilisation for the busiest doctor suggests rebalancing referrals.
-- Limitations: doctors may legitimately specialise in heavier or lighter case types; departments with one
--   doctor have Gini 0 by definition. Part-time schedules are not adjusted for.
-- Validation: SUM(appointments) per department equals the department total for the same window.
WITH per_doctor AS (
  SELECT department_name, doctor_key, COUNT(*) AS appointments
  FROM analytics_marts.appointments
  WHERE NOT is_removed AND appt_date BETWEEN CURRENT_DATE - 365 AND CURRENT_DATE
  GROUP BY department_name, doctor_key
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY department_name ORDER BY appointments) AS i,
         COUNT(*) OVER (PARTITION BY department_name) AS n,
         SUM(appointments) OVER (PARTITION BY department_name) AS total
  FROM per_doctor
)
SELECT department_name,
       MAX(n) AS doctors,
       MAX(total) AS appointments,
       ROUND(SUM((2 * i - n - 1) * appointments)::NUMERIC / NULLIF(MAX(n) * MAX(total), 0), 3) AS gini,
       ROUND(MAX(appointments)::NUMERIC / MAX(total), 3) AS top_doctor_share
FROM ranked
GROUP BY department_name
ORDER BY gini DESC, department_name;
