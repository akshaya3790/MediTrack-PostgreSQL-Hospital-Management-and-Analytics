# 06_return_interval_by_department.sql

Rows returned: 10. Columns: department_name, gaps, median_gap_days, p90_gap_days, mean_gap_days, pct_within_30_days.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=7530.40..7530.57 rows=67 width=168) (actual time=47.281..47.297 rows=10 loops=1)
  Sort Key: (round((percentile_cont('0.5'::double precision) WITHIN GROUP (ORDER BY ((ordered.gap_days)::double precision)))::numeric, 1)), ordered.department_name
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1530
  ->  GroupAggregate  (cost=6998.62..7528.37 rows=67 width=168) (actual time=42.502..47.269 rows=10 loops=1)
        Group Key: ordered.department_name
        Filter: (count(ordered.gap_days) >= 5)
        Buffers: shared hit=1530
        ->  Sort  (cost=6998.62..7064.11 rows=26195 width=36) (actual time=41.944..43.229 rows=24317 loops=1)
              Sort Key: ordered.department_name
              Sort Method: quicksort  Memory: 1759kB
              Buffers: shared hit=1530
              ->  Subquery Scan on ordered  (cost=4089.04..5076.30 rows=26195 width=36) (actual time=24.872..37.240 rows=24317 loops=1)
                    Filter: (ordered.gap_days IS NOT NULL)
                    Rows Removed by Filter: 2010
                    Buffers: shared hit=1530
                    ->  WindowAgg  (cost=4089.04..4813.03 rows=26327 width=50) (actual time=24.868..35.028 rows=26327 loops=1)
                          Buffers: shared hit=1530
                          ->  Sort  (cost=4089.04..4154.86 rows=26327 width=46) (actual time=24.852..27.091 rows=26327 loops=1)
                                Sort Key: f.patient_sk, d.full_date, f.start_hour, f.appointment_id
                                Sort Method: quicksort  Memory: 2238kB
                                Buffers: shared hit=1530
                                ->  Hash Join  (cost=95.35..2156.08 rows=26327 width=46) (actual time=0.527..16.810 rows=26327 loops=1)
                                      Hash Cond: (f.status_key = s.status_key)
                                      Buffers: shared hit=1530
                                      ->  Hash Join  (cost=70.95..2062.11 rows=26327 width=48) (actual time=0.487..13.699 rows=26327 loops=1)
                                            Hash Cond: (f.doctor_sk = doc.doctor_sk)
                                            Buffers: shared hit=1529
                                            ->  Hash Join  (cost=50.60..1972.02 rows=26327 width=52) (actual time=0.474..10.445 rows=26327 loops=1)
                                                  Hash Cond: (f.department_sk = dep.department_sk)
                                                  Buffers: shared hit=1528
                                                  ->  Hash Join  (cost=25.08..1876.97 rows=26327 width=24) (actual time=0.465..7.169 rows=26327 loops=1)
                                                        Hash Cond: (f.date_key = d.date_key)
                                                        Buffers: shared hit=1527
                                                        ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=24) (actual time=0.330..3.483 rows=26327 loops=1)
                                                              Filter: ((NOT is_removed) AND (patient_sk IS NOT NULL))
                                                              Rows Removed by Filter: 12
                                                              Buffers: shared hit=1519
                                                        ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.130..0.131 rows=759 loops=1)
                                                              Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                                              Buffers: shared hit=8
                                                              ->  Seq Scan on dim_date d  (cost=0.00..15.59 rows=759 width=8) (actual time=0.004..0.064 rows=759 loops=1)
                                                                    Buffers: shared hit=8
                                                  ->  Hash  (cost=16.90..16.90 rows=690 width=36) (actual time=0.007..0.008 rows=10 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                        Buffers: shared hit=1
                                                        ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.003..0.004 rows=10 loops=1)
                                                              Buffers: shared hit=1
                                            ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.009..0.010 rows=22 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                  Buffers: shared hit=1
                                                  ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.004..0.007 rows=22 loops=1)
                                                        Buffers: shared hit=1
                                      ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.035..0.036 rows=4 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                            Buffers: shared hit=1
                                            ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.028..0.029 rows=4 loops=1)
                                                  Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.827 ms
Execution Time: 47.562 ms
```
