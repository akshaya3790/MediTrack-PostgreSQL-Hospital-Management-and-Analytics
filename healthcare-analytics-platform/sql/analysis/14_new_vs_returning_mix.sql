-- Business question: What share of each month's patients are new to the hospital versus returning?
-- Definition: a patient is new in the month of their first non-removed appointment in the data, returning in
--   any later month with an appointment. Counted as distinct pseudonymous patients.
-- Interpretation: a growing new-patient share signals growth in reach; a falling one signals reliance on
--   existing patients.
-- Limitations: in the first months of data almost everyone looks new (left-censoring). Groups under 5 are
--   blanked. Only past appointments are counted.
-- Validation: new_patients summed over all months equals the number of distinct patients with past visits.
WITH visits AS (
  SELECT DISTINCT patient_sk, month_start
  FROM analytics_marts.appointments
  WHERE NOT is_removed AND patient_sk IS NOT NULL AND appt_date <= CURRENT_DATE
), labelled AS (
  SELECT month_start,
         (month_start = MIN(month_start) OVER (PARTITION BY patient_sk)) AS is_new
  FROM visits
), monthly AS (
  SELECT month_start, COUNT(*) FILTER (WHERE is_new) AS new_patients,
         COUNT(*) FILTER (WHERE NOT is_new) AS returning_patients
  FROM labelled GROUP BY month_start
)
SELECT month_start,
       CASE WHEN new_patients >= 5 THEN new_patients END AS new_patients,
       CASE WHEN returning_patients >= 5 THEN returning_patients END AS returning_patients,
       CASE WHEN new_patients >= 5 AND returning_patients >= 5
            THEN ROUND(100.0 * new_patients / (new_patients + returning_patients), 1) END AS new_share_pct
FROM monthly
ORDER BY month_start;
