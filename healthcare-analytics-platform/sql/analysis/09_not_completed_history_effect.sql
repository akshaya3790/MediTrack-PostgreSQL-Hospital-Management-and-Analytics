-- Business question: Are patients who missed (did not complete) earlier appointments more likely to miss again?
-- Definition: uses analytics_marts.ml_appointment_features, where prior counts use only appointments
--   strictly before the current one (no look-ahead). Groups: first visit, no prior misses, 1 prior miss,
--   2+ prior misses. Rate = share of appointments in the group not completed. Lift = group rate / overall rate.
-- Interpretation: a lift well above 1 for patients with prior misses supports targeted reminders. It must not
--   be used to refuse or deprioritise care.
-- Limitations: association, not cause. "Not completed" is a proxy (see 04). Groups under 5 are hidden.
-- Validation: SUM(appointments) equals COUNT(*) FROM analytics_marts.ml_appointment_features.
WITH grouped AS (
  SELECT CASE
           WHEN prior_appointments = 0 THEN '1. first visit'
           WHEN prior_not_completed = 0 THEN '2. no prior misses'
           WHEN prior_not_completed = 1 THEN '3. one prior miss'
           ELSE '4. two or more prior misses'
         END AS history_group,
         label_not_completed
  FROM analytics_marts.ml_appointment_features
)
SELECT history_group,
       COUNT(*) AS appointments,
       ROUND(AVG(label_not_completed::INT), 4) AS not_completed_rate,
       ROUND(AVG(label_not_completed::INT) / NULLIF(AVG(AVG(label_not_completed::INT)) OVER (), 0), 2) AS lift_vs_group_mean,
       ROUND(AVG(label_not_completed::INT) / NULLIF((SELECT AVG(label_not_completed::INT) FROM grouped), 0), 2) AS lift_vs_overall
FROM grouped
GROUP BY history_group
HAVING COUNT(*) >= 5
ORDER BY history_group;
