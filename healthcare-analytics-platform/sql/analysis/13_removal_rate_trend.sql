-- Business question: How many bookings disappear (are cancelled or deleted) before they happen, by department?
-- Definition: removed = an appointment the pipeline saw in an earlier run that is no longer in the hospital
--   database (the hospital app deletes cancelled appointments). removal rate = removed / (all seen).
--   Only appointments first seen by an incremental run after the first full load can be observed this way.
-- Interpretation: a rising removal rate may point to scheduling friction or long waits.
-- Limitations: cancellations made before the pipeline first saw a booking are invisible, so this
--   undercounts; until the pipeline has run for a while the numbers will be near zero.
-- Validation: SUM(removed) equals COUNT(*) FROM analytics_warehouse.fact_appointment WHERE is_removed.
SELECT department_name, month_start,
       COUNT(*) AS seen,
       COUNT(*) FILTER (WHERE is_removed) AS removed,
       ROUND(100.0 * COUNT(*) FILTER (WHERE is_removed) / COUNT(*), 2) AS removal_rate_pct
FROM analytics_marts.appointments
GROUP BY department_name, month_start
ORDER BY department_name, month_start;
