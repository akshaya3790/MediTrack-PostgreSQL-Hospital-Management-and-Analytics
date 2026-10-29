-- Business question: How full are each doctor's weeks, and how often are they close to fully booked?
-- Definition: weekly utilisation = non-removed appointments / scheduled one-hour slots for that doctor and
--   week (analytics_warehouse.fact_doctor_daily_capacity). "Near full" = utilisation at or above 90%.
-- Interpretation: doctors who are near full in most weeks are a bottleneck; very low utilisation may mean
--   unused clinic time that could be offered elsewhere.
-- Limitations: capacity for days before the pipeline first ran is estimated from the doctor's current
--   working hours (capacity_basis = 'backfilled_from_current_schedule'); share_backfilled shows how much.
--   Leave, holidays and emergency work are not recorded in the hospital system.
-- Validation: SUM(slots) equals SUM(scheduled_slots) in fact_doctor_daily_capacity for the same weeks.
WITH cap AS (
  SELECT c.doctor_key, d.week_start, SUM(c.scheduled_slots) AS slots,
         AVG((c.capacity_basis <> 'observed')::INT) AS share_backfilled
  FROM analytics_warehouse.fact_doctor_daily_capacity c
  JOIN analytics_warehouse.dim_date d ON d.date_key = c.date_key
  WHERE d.full_date <= CURRENT_DATE
  GROUP BY c.doctor_key, d.week_start
), booked AS (
  SELECT doctor_key, week_start, COUNT(*) AS appointments
  FROM analytics_marts.appointments
  WHERE NOT is_removed AND appt_date <= CURRENT_DATE
  GROUP BY doctor_key, week_start
), weekly AS (
  SELECT cap.doctor_key, cap.week_start, cap.slots, cap.share_backfilled,
         COALESCE(b.appointments, 0) AS appointments,
         COALESCE(b.appointments, 0)::NUMERIC / NULLIF(cap.slots, 0) AS utilisation
  FROM cap LEFT JOIN booked b USING (doctor_key, week_start)
  WHERE cap.slots > 0
)
SELECT w.doctor_key, doc.doctor_name,
       COUNT(*) AS weeks,
       SUM(w.slots) AS slots,
       SUM(w.appointments) AS appointments,
       ROUND(SUM(w.appointments)::NUMERIC / SUM(w.slots), 4) AS utilisation,
       ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY w.utilisation)::NUMERIC, 4) AS median_weekly_utilisation,
       ROUND(100.0 * COUNT(*) FILTER (WHERE w.utilisation >= 0.9) / COUNT(*), 1) AS pct_weeks_near_full,
       ROUND(AVG(w.share_backfilled), 3) AS share_backfilled
FROM weekly w
JOIN analytics_warehouse.dim_doctor doc ON doc.doctor_key = w.doctor_key AND doc.is_current
GROUP BY w.doctor_key, doc.doctor_name
ORDER BY doc.doctor_name;
