-- Business question: Which departments carry the most demand each quarter, and is their share moving?
-- Definition: share = department appointments / all appointments in the quarter (not removed).
--   Rank uses DENSE_RANK so ties share a rank. share_change_pts compares with the previous quarter.
-- Interpretation: a department climbing in rank or share needs capacity planning attention.
-- Limitations: departments come from the doctor's department at the time the appointment was first loaded.
--   Share says nothing about clinical complexity or value.
-- Validation: shares within each quarter add up to 100 (allowing for rounding).
WITH q AS (
  SELECT DATE_TRUNC('quarter', appt_date)::DATE AS quarter_start, department_name,
         COUNT(*) AS appointments
  FROM analytics_marts.appointments
  WHERE NOT is_removed
  GROUP BY 1, 2
), shares AS (
  SELECT quarter_start, department_name, appointments,
         ROUND(100.0 * appointments / SUM(appointments) OVER (PARTITION BY quarter_start), 2) AS share_pct,
         DENSE_RANK() OVER (PARTITION BY quarter_start ORDER BY appointments DESC) AS demand_rank
  FROM q
)
SELECT quarter_start, department_name, appointments, share_pct, demand_rank,
       share_pct - LAG(share_pct) OVER (PARTITION BY department_name ORDER BY quarter_start) AS share_change_pts,
       LAG(demand_rank) OVER (PARTITION BY department_name ORDER BY quarter_start) - demand_rank AS rank_gain
FROM shares
ORDER BY quarter_start, demand_rank, department_name;
