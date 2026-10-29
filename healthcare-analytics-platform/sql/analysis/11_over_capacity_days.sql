-- Business question: On which days was a department booked beyond its scheduled slots?
-- Definition: from analytics_marts.daily_department_operations, overbooked = appointments > scheduled_slots.
--   Pressure = appointments / scheduled_slots. Summarised per department and month.
-- Interpretation: repeated overbooking in a department means its slots do not match demand.
-- Limitations: a slot is one hour per doctor (as the hospital app books). The app prevents double booking of a
--   doctor's hour, so overbooking usually means capacity was missing or estimated (see 07), which itself is a
--   data question worth checking.
-- Validation: days_with_capacity + days_without_capacity = days with any appointment or capacity.
SELECT department_name, month_start,
       COUNT(*) FILTER (WHERE scheduled_slots > 0) AS days_with_capacity,
       COUNT(*) FILTER (WHERE COALESCE(scheduled_slots, 0) = 0 AND appointments > 0) AS days_without_capacity,
       COUNT(*) FILTER (WHERE scheduled_slots > 0 AND appointments > scheduled_slots) AS overbooked_days,
       ROUND(MAX(appointments::NUMERIC / NULLIF(scheduled_slots, 0)), 3) AS peak_pressure,
       ROUND(AVG(appointments::NUMERIC / NULLIF(scheduled_slots, 0)), 3) AS mean_pressure
FROM analytics_marts.daily_department_operations
WHERE ops_date <= CURRENT_DATE
GROUP BY department_name, month_start
ORDER BY department_name, month_start;
