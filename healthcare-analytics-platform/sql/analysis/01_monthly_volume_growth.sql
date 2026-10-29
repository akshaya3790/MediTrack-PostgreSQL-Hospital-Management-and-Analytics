-- Business question: How is appointment volume changing month on month and year on year?
-- Definition: appointments = rows in analytics_marts.appointments that were not removed, grouped by
--   the month of the appointment date. MoM and YoY growth = (this month - comparison month) / comparison month.
-- Interpretation: steady positive YoY growth means rising demand; a single-month jump is often one-off.
--   The current and last months are partial, so read their growth with care.
-- Limitations: counts bookings for a date, not when they were made (the hospital tables do not record
--   booking time). Cancellations delete rows in the hospital app, so only removals seen by the pipeline show.
-- Validation: SUM(appointments) over all months equals SELECT COUNT(*) FROM analytics_marts.appointments
--   WHERE NOT is_removed.
WITH monthly AS (
  SELECT month_start,
         COUNT(*) FILTER (WHERE NOT is_removed) AS appointments,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed
  FROM analytics_marts.appointments
  GROUP BY month_start
)
SELECT month_start,
       appointments,
       completed,
       LAG(appointments) OVER (ORDER BY month_start) AS previous_month,
       ROUND(100.0 * (appointments - LAG(appointments) OVER (ORDER BY month_start))
             / NULLIF(LAG(appointments) OVER (ORDER BY month_start), 0), 1) AS mom_growth_pct,
       LAG(appointments, 12) OVER (ORDER BY month_start) AS same_month_last_year,
       ROUND(100.0 * (appointments - LAG(appointments, 12) OVER (ORDER BY month_start))
             / NULLIF(LAG(appointments, 12) OVER (ORDER BY month_start), 0), 1) AS yoy_growth_pct
FROM monthly
ORDER BY month_start;
