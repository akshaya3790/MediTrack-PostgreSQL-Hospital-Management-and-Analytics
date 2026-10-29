-- Business question: How long do patients typically wait between visits, by the department of the later visit?
-- Definition: gap = days between a patient's consecutive non-removed appointments (LAG over the patient's
--   visits). Median and 90th percentile use PERCENTILE_CONT. Same-day repeat bookings count as 0 days.
-- Interpretation: a short median gap can mean follow-up-heavy work (for example post-operative checks);
--   a long tail (p90) shows patients who return only occasionally.
-- Limitations: follow-ups and unrelated new problems are indistinguishable. Gaps over 365 days are kept.
--   Departments with fewer than 5 gaps are not shown.
-- Validation: gaps counted equals (non-removed appointments with a patient) - (distinct patients).
WITH ordered AS (
  SELECT patient_sk, department_name, appt_date,
         appt_date - LAG(appt_date) OVER (PARTITION BY patient_sk ORDER BY appt_date, start_hour, appointment_id) AS gap_days
  FROM analytics_marts.appointments
  WHERE NOT is_removed AND patient_sk IS NOT NULL
)
SELECT department_name,
       COUNT(gap_days) AS gaps,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_days)::NUMERIC, 1) AS median_gap_days,
       ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY gap_days)::NUMERIC, 1) AS p90_gap_days,
       ROUND(AVG(gap_days), 1) AS mean_gap_days,
       ROUND(100.0 * COUNT(*) FILTER (WHERE gap_days <= 30) / NULLIF(COUNT(gap_days), 0), 1) AS pct_within_30_days
FROM ordered
WHERE gap_days IS NOT NULL
GROUP BY department_name
HAVING COUNT(gap_days) >= 5
ORDER BY median_gap_days, department_name;
