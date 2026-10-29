# Query plans for the SQL analyses

Produced by `npm run sql:check` (EXPLAIN ANALYZE, read-only).

| Query | Rows | Execution time (ms) |
|---|---:|---:|
| [01_monthly_volume_growth.sql](01_monthly_volume_growth.md) | 26 | 32.273 |
| [02_department_share_rank.sql](02_department_share_rank.md) | 90 | 27.517 |
| [03_rolling_department_demand.sql](03_rolling_department_demand.md) | 1050 | 18.428 |
| [04_not_completed_weekday_hour.sql](04_not_completed_weekday_hour.md) | 55 | 63.565 |
| [05_patient_cohort_retention.sql](05_patient_cohort_retention.md) | 142 | 49.444 |
| [06_return_interval_by_department.sql](06_return_interval_by_department.md) | 10 | 47.562 |
| [07_doctor_weekly_utilisation.sql](07_doctor_weekly_utilisation.md) | 22 | 33.488 |
| [08_workload_concentration.sql](08_workload_concentration.md) | 10 | 14.085 |
| [09_not_completed_history_effect.sql](09_not_completed_history_effect.md) | 4 | 70.541 |
| [10_department_transitions.sql](10_department_transitions.md) | 100 | 39.818 |
| [11_over_capacity_days.sql](11_over_capacity_days.md) | 250 | 22.212 |
| [12_forward_bookings.sql](12_forward_bookings.md) | 40 | 40.356 |
| [13_removal_rate_trend.sql](13_removal_rate_trend.md) | 260 | 24.793 |
| [14_new_vs_returning_mix.sql](14_new_vs_returning_mix.md) | 25 | 46.806 |
