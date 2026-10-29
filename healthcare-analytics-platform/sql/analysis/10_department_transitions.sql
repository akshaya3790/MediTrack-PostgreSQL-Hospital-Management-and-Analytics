-- Business question: After a visit to one department, which department do patients visit next?
-- Definition: for each patient's consecutive pair of non-removed past appointments (LEAD), count
--   from_department -> to_department. pct_of_from = transitions / all transitions out of from_department.
-- Interpretation: strong flows between different departments (for example General Medicine to Cardiology)
--   show referral paths that may need joint scheduling.
-- Limitations: the hospital app records no referrals, so a later visit is not proof of a referral.
--   Pairs with fewer than 5 transitions are dropped for privacy.
-- Validation: SUM(transitions) before suppression = past appointments with a patient - distinct patients.
WITH seq AS (
  SELECT patient_sk, department_name AS from_department,
         LEAD(department_name) OVER (PARTITION BY patient_sk ORDER BY appt_date, start_hour, appointment_id) AS to_department
  FROM analytics_marts.appointments
  WHERE NOT is_removed AND patient_sk IS NOT NULL AND appt_date <= CURRENT_DATE
), pairs AS (
  SELECT from_department, to_department, COUNT(*) AS transitions
  FROM seq WHERE to_department IS NOT NULL
  GROUP BY 1, 2
)
SELECT from_department, to_department, transitions,
       ROUND(100.0 * transitions / SUM(transitions) OVER (PARTITION BY from_department), 1) AS pct_of_from,
       (from_department = to_department) AS same_department
FROM pairs
WHERE transitions >= 5
ORDER BY from_department, transitions DESC;
