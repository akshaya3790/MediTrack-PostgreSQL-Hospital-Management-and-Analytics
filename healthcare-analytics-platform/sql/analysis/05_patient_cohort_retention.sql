-- Business question: Of patients whose first visit fell in a given month, how many come back in later months?
-- Definition: cohort = month of a patient's first non-removed appointment in the warehouse.
--   retained in month N = patient has at least one non-removed appointment N months after the cohort month.
--   Patients are counted by pseudonymous surrogate key only.
-- Interpretation: falling retention for recent cohorts may mean patients are going elsewhere, or simply that
--   their care finished; it is a prompt to look closer, not a verdict.
-- Limitations: "first visit" means first visit in the data. Patients who existed before the data starts are
--   counted from their first visit inside it. Cells with fewer than 5 patients are blanked for privacy.
-- Validation: month 0 retained equals cohort_size for every cohort.
WITH visits AS (
  SELECT DISTINCT patient_sk, month_start
  FROM analytics_marts.appointments
  WHERE NOT is_removed AND patient_sk IS NOT NULL AND appt_date <= CURRENT_DATE
), firsts AS (
  SELECT patient_sk, MIN(month_start) AS cohort_month FROM visits GROUP BY patient_sk
), activity AS (
  SELECT f.cohort_month,
         (EXTRACT(YEAR FROM AGE(v.month_start, f.cohort_month)) * 12
          + EXTRACT(MONTH FROM AGE(v.month_start, f.cohort_month)))::INT AS months_after,
         COUNT(DISTINCT v.patient_sk) AS patients
  FROM visits v JOIN firsts f USING (patient_sk)
  GROUP BY 1, 2
), sized AS (
  SELECT a.*, MAX(patients) FILTER (WHERE months_after = 0) OVER (PARTITION BY cohort_month) AS cohort_size
  FROM activity a
)
SELECT cohort_month, months_after,
       CASE WHEN cohort_size >= 5 THEN cohort_size END AS cohort_size,
       CASE WHEN patients >= 5 THEN patients END AS retained_patients,
       CASE WHEN patients >= 5 AND cohort_size >= 5 THEN ROUND(100.0 * patients / cohort_size, 1) END AS retention_pct
FROM sized
WHERE months_after BETWEEN 0 AND 6
ORDER BY cohort_month, months_after;
