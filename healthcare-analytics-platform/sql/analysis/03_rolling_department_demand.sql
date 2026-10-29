-- Business question: What is the underlying weekly demand trend per department, smoothed of noise?
-- Definition: weekly appointments from analytics_marts.weekly_department_demand (weeks with none are 0).
--   rolling_4w = mean of this and the previous 3 weeks; rolling_13w = about one quarter.
--   trend_signal compares the 4-week mean with the 13-week mean.
-- Interpretation: rolling_4w above rolling_13w by more than 10% suggests demand is rising right now.
-- Limitations: the first 12 weeks of each series have an incomplete 13-week window (weeks_in_window shows
--   how many weeks were averaged). Future weeks include only bookings made so far.
-- Validation: for any department, SUM(appointments) equals its total in analytics_marts.appointments
--   (not removed) over the same weeks.
SELECT week_start, department_name, appointments,
       ROUND(AVG(appointments) OVER w4, 1)  AS rolling_4w,
       ROUND(AVG(appointments) OVER w13, 1) AS rolling_13w,
       COUNT(*) OVER w13                    AS weeks_in_window,
       CASE
         WHEN AVG(appointments) OVER w13 = 0 THEN 'no demand'
         WHEN AVG(appointments) OVER w4 > 1.1 * AVG(appointments) OVER w13 THEN 'rising'
         WHEN AVG(appointments) OVER w4 < 0.9 * AVG(appointments) OVER w13 THEN 'falling'
         ELSE 'steady'
       END AS trend_signal
FROM analytics_marts.weekly_department_demand
WHERE week_start <= CURRENT_DATE
WINDOW w4  AS (PARTITION BY department_sk ORDER BY week_start ROWS BETWEEN 3 PRECEDING AND CURRENT ROW),
       w13 AS (PARTITION BY department_sk ORDER BY week_start ROWS BETWEEN 12 PRECEDING AND CURRENT ROW)
ORDER BY department_name, week_start;
