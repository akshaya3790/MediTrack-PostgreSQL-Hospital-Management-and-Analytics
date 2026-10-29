-- Business question: How full are the next four weeks compared with what was actually delivered in the same
--   weeks a year ago?
-- Definition: booked_ahead = non-removed appointments dated in each of the next 4 ISO weeks, as booked today.
--   last_year = non-removed appointments in the ISO week 52 weeks earlier. fill_vs_last_year = ratio.
-- Interpretation: a ratio well below 1 for next week means spare capacity to promote; well above 1 means
--   pressure. Ratios for weeks further ahead are naturally low because bookings still arrive.
-- Limitations: needs at least one year of history; otherwise last_year is NULL. No booking timestamps exist,
--   so the typical booking curve cannot be modelled from the hospital data alone.
-- Validation: booked_ahead summed over departments equals the count of future non-removed appointments
--   in those weeks.
-- Performance: appointments are counted once per week and department before joining (an earlier
--   version joined raw appointment rows with an IN condition and was about 10 times slower).
WITH weeks AS (
  SELECT generate_series(DATE_TRUNC('week', CURRENT_DATE)::DATE + 7,
                         DATE_TRUNC('week', CURRENT_DATE)::DATE + 28, INTERVAL '7 days')::DATE AS week_start
), weekly AS (
  SELECT week_start, department_sk, COUNT(*) AS appointments
  FROM analytics_marts.appointments
  WHERE NOT is_removed
    AND (week_start BETWEEN DATE_TRUNC('week', CURRENT_DATE)::DATE + 7 AND DATE_TRUNC('week', CURRENT_DATE)::DATE + 28
         OR week_start BETWEEN DATE_TRUNC('week', CURRENT_DATE)::DATE + 7 - 364 AND DATE_TRUNC('week', CURRENT_DATE)::DATE + 28 - 364)
  GROUP BY week_start, department_sk
)
SELECT w.week_start, dep.department_name,
       COALESCE(now_.appointments, 0) AS booked_ahead,
       ly.appointments AS last_year,
       ROUND(COALESCE(now_.appointments, 0)::NUMERIC / NULLIF(ly.appointments, 0), 2) AS fill_vs_last_year
FROM weeks w
CROSS JOIN analytics_warehouse.dim_department dep
LEFT JOIN weekly now_ ON now_.week_start = w.week_start AND now_.department_sk = dep.department_sk
LEFT JOIN weekly ly ON ly.week_start = w.week_start - 364 AND ly.department_sk = dep.department_sk
ORDER BY w.week_start, dep.department_name;
