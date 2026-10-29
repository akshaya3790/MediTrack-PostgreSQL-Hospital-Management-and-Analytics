-- Business question: At which weekday and hour are booked appointments most often not completed?
-- Definition: not-completed rate = past appointments still marked NotDone / all past appointments
--   (status 'unresolved' / ('completed' + 'unresolved')). This is a no-show proxy: the hospital app has no
--   explicit no-show or cancelled status. A 95% Wilson score interval is given so small cells are not over-read.
-- Interpretation: a slot whose lower bound is above the overall rate is reliably worse than average and a
--   candidate for reminders or overbooking review.
-- Limitations: a doctor forgetting to mark a visit Done looks the same as a patient not attending.
--   Patients can hide completed visits from their own history, which removes the link but not the row.
-- Validation: SUM(past) equals COUNT(*) WHERE status IN ('completed','unresolved').
WITH cells AS (
  SELECT iso_dow, day_name, start_hour,
         COUNT(*) AS past,
         COUNT(*) FILTER (WHERE status = 'unresolved') AS not_completed
  FROM analytics_marts.appointments
  WHERE status IN ('completed', 'unresolved')
  GROUP BY iso_dow, day_name, start_hour
), overall AS (
  SELECT SUM(not_completed)::NUMERIC / NULLIF(SUM(past), 0) AS rate FROM cells
)
SELECT c.day_name, c.start_hour, c.past, c.not_completed,
       ROUND(c.not_completed::NUMERIC / c.past, 4) AS rate,
       -- Wilson score interval, z = 1.96
       ROUND(((c.not_completed::NUMERIC / c.past) + 1.9208 / c.past
              - 1.96 * SQRT((c.not_completed::NUMERIC / c.past) * (1 - c.not_completed::NUMERIC / c.past) / c.past + 0.9604 / (c.past::NUMERIC * c.past)))
             / (1 + 3.8416 / c.past), 4) AS rate_low_95,
       ROUND(((c.not_completed::NUMERIC / c.past) + 1.9208 / c.past
              + 1.96 * SQRT((c.not_completed::NUMERIC / c.past) * (1 - c.not_completed::NUMERIC / c.past) / c.past + 0.9604 / (c.past::NUMERIC * c.past)))
             / (1 + 3.8416 / c.past), 4) AS rate_high_95,
       ROUND(o.rate, 4) AS overall_rate
FROM cells c CROSS JOIN overall o
ORDER BY c.iso_dow, c.start_hour;
