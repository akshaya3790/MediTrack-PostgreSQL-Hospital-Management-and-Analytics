# 07_doctor_weekly_utilisation.sql

Rows returned: 22. Columns: doctor_key, doctor_name, weeks, slots, appointments, utilisation, median_weekly_utilisation, pct_weeks_near_full, share_backfilled.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
GroupAggregate  (cost=3658.98..3695.98 rows=400 width=238) (actual time=31.598..33.227 rows=22 loops=1)
  Group Key: doc.doctor_name, cap.doctor_key
  Buffers: shared hit=1727
  ->  Sort  (cost=3658.98..3659.98 rows=400 width=86) (actual time=31.460..31.577 rows=2310 loops=1)
        Sort Key: doc.doctor_name, cap.doctor_key
        Sort Method: quicksort  Memory: 270kB
        Buffers: shared hit=1727
        ->  Hash Join  (cost=3084.23..3641.69 rows=400 width=86) (actual time=29.449..30.767 rows=2310 loops=1)
              Hash Cond: (cap.doctor_key = doc.doctor_key)
              Buffers: shared hit=1727
              ->  Hash Right Join  (cost=3066.76..3617.22 rows=799 width=54) (actual time=29.423..30.375 rows=2310 loops=1)
                    Hash Cond: ((doc_1.doctor_key = cap.doctor_key) AND (d.week_start = cap.week_start))
                    Buffers: shared hit=1726
                    ->  HashAggregate  (cost=2342.00..2560.00 rows=21800 width=44) (actual time=20.858..21.223 rows=2306 loops=1)
                          Group Key: doc_1.doctor_key, d.week_start
                          Batches: 1  Memory Usage: 1041kB
                          Buffers: shared hit=1530
                          ->  Hash Join  (cost=98.80..2151.83 rows=25356 width=36) (actual time=0.791..16.646 rows=25456 loops=1)
                                Hash Cond: (f.status_key = s.status_key)
                                Buffers: shared hit=1530
                                ->  Hash Join  (cost=74.40..2060.43 rows=25356 width=38) (actual time=0.770..13.588 rows=25456 loops=1)
                                      Hash Cond: (f.doctor_sk = doc_1.doctor_sk)
                                      Buffers: shared hit=1529
                                      ->  Hash Join  (cost=54.05..1972.91 rows=25356 width=10) (actual time=0.752..10.475 rows=25456 loops=1)
                                            Hash Cond: (f.department_sk = dep.department_sk)
                                            Buffers: shared hit=1528
                                            ->  Hash Join  (cost=28.52..1880.41 rows=25356 width=14) (actual time=0.741..7.329 rows=25456 loops=1)
                                                  Hash Cond: (f.date_key = d.date_key)
                                                  Buffers: shared hit=1527
                                                  ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=14) (actual time=0.335..3.512 rows=26327 loops=1)
                                                        Filter: (NOT is_removed)
                                                        Rows Removed by Filter: 12
                                                        Buffers: shared hit=1519
                                                  ->  Hash  (cost=19.38..19.38 rows=731 width=8) (actual time=0.151..0.152 rows=731 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 37kB
                                                        Buffers: shared hit=8
                                                        ->  Seq Scan on dim_date d  (cost=0.00..19.38 rows=731 width=8) (actual time=0.007..0.085 rows=731 loops=1)
                                                              Filter: (full_date <= CURRENT_DATE)
                                                              Rows Removed by Filter: 28
                                                              Buffers: shared hit=8
                                            ->  Hash  (cost=16.90..16.90 rows=690 width=4) (actual time=0.006..0.006 rows=10 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                  Buffers: shared hit=1
                                                  ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=4) (actual time=0.003..0.004 rows=10 loops=1)
                                                        Buffers: shared hit=1
                                      ->  Hash  (cost=14.60..14.60 rows=460 width=36) (actual time=0.011..0.012 rows=22 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                            Buffers: shared hit=1
                                            ->  Seq Scan on dim_doctor doc_1  (cost=0.00..14.60 rows=460 width=36) (actual time=0.005..0.007 rows=22 loops=1)
                                                  Buffers: shared hit=1
                                ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.012..0.013 rows=4 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                      Buffers: shared hit=1
                                      ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.009..0.010 rows=4 loops=1)
                                            Buffers: shared hit=1
                    ->  Hash  (cost=712.77..712.77 rows=799 width=50) (actual time=8.558..8.561 rows=2310 loops=1)
                          Buckets: 4096 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 168kB
                          Buffers: shared hit=196
                          ->  Subquery Scan on cap  (cost=668.81..712.77 rows=799 width=50) (actual time=7.424..8.243 rows=2310 loops=1)
                                Buffers: shared hit=196
                                ->  HashAggregate  (cost=668.81..704.78 rows=799 width=50) (actual time=7.423..8.040 rows=2310 loops=1)
                                      Group Key: c.doctor_key, d_1.week_start
                                      Filter: (sum(c.scheduled_slots) > 0)
                                      Batches: 1  Memory Usage: 625kB
                                      Buffers: shared hit=196
                                      ->  Hash Join  (cost=28.52..427.58 rows=16082 width=44) (actual time=0.194..4.245 rows=16082 loops=1)
                                            Hash Cond: (c.date_key = d_1.date_key)
                                            Buffers: shared hit=196
                                            ->  Seq Scan on fact_doctor_daily_capacity c  (cost=0.00..354.98 rows=16698 width=44) (actual time=0.004..1.152 rows=16698 loops=1)
                                                  Buffers: shared hit=188
                                            ->  Hash  (cost=19.38..19.38 rows=731 width=8) (actual time=0.185..0.185 rows=731 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 37kB
                                                  Buffers: shared hit=8
                                                  ->  Seq Scan on dim_date d_1  (cost=0.00..19.38 rows=731 width=8) (actual time=0.006..0.104 rows=731 loops=1)
                                                        Filter: (full_date <= CURRENT_DATE)
                                                        Rows Removed by Filter: 28
                                                        Buffers: shared hit=8
              ->  Hash  (cost=14.60..14.60 rows=230 width=64) (actual time=0.020..0.021 rows=22 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 10kB
                    Buffers: shared hit=1
                    ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=230 width=64) (actual time=0.011..0.014 rows=22 loops=1)
                          Filter: is_current
                          Buffers: shared hit=1
Planning:
  Buffers: shared hit=18
Planning Time: 1.287 ms
Execution Time: 33.488 ms
```
