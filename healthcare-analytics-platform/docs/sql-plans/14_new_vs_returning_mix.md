# 14_new_vs_returning_mix.sql

Rows returned: 25. Columns: month_start, new_patients, returning_patients, new_share_pct.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=5352.46..5352.96 rows=200 width=52) (actual time=46.560..46.572 rows=25 loops=1)
  Sort Key: monthly.month_start
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=1530
  ->  Subquery Scan on monthly  (cost=5337.82..5344.82 rows=200 width=52) (actual time=46.532..46.558 rows=25 loops=1)
        Buffers: shared hit=1530
        ->  HashAggregate  (cost=5337.82..5339.82 rows=200 width=20) (actual time=46.523..46.536 rows=25 loops=1)
              Group Key: d.month_start
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=1530
              ->  WindowAgg  (cost=4006.63..4894.09 rows=25356 width=9) (actual time=35.270..44.770 rows=15442 loops=1)
                    Buffers: shared hit=1530
                    ->  Unique  (cost=4006.63..4196.80 rows=25356 width=8) (actual time=35.241..40.144 rows=15442 loops=1)
                          Buffers: shared hit=1530
                          ->  Sort  (cost=4006.63..4070.02 rows=25356 width=8) (actual time=35.238..37.370 rows=25456 loops=1)
                                Sort Key: f.patient_sk, d.month_start
                                Sort Method: quicksort  Memory: 1564kB
                                Buffers: shared hit=1530
                                ->  Hash Join  (cost=98.80..2151.83 rows=25356 width=8) (actual time=1.010..25.290 rows=25456 loops=1)
                                      Hash Cond: (f.status_key = s.status_key)
                                      Buffers: shared hit=1530
                                      ->  Hash Join  (cost=74.40..2060.43 rows=25356 width=10) (actual time=0.988..20.900 rows=25456 loops=1)
                                            Hash Cond: (f.doctor_sk = doc.doctor_sk)
                                            Buffers: shared hit=1529
                                            ->  Hash Join  (cost=54.05..1972.91 rows=25356 width=14) (actual time=0.974..16.198 rows=25456 loops=1)
                                                  Hash Cond: (f.department_sk = dep.department_sk)
                                                  Buffers: shared hit=1528
                                                  ->  Hash Join  (cost=28.52..1880.41 rows=25356 width=18) (actual time=0.962..11.574 rows=25456 loops=1)
                                                        Hash Cond: (f.date_key = d.date_key)
                                                        Buffers: shared hit=1527
                                                        ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=18) (actual time=0.357..6.019 rows=26327 loops=1)
                                                              Filter: ((NOT is_removed) AND (patient_sk IS NOT NULL))
                                                              Rows Removed by Filter: 12
                                                              Buffers: shared hit=1519
                                                        ->  Hash  (cost=19.38..19.38 rows=731 width=8) (actual time=0.224..0.226 rows=731 loops=1)
                                                              Buckets: 1024  Batches: 1  Memory Usage: 37kB
                                                              Buffers: shared hit=8
                                                              ->  Seq Scan on dim_date d  (cost=0.00..19.38 rows=731 width=8) (actual time=0.008..0.129 rows=731 loops=1)
                                                                    Filter: (full_date <= CURRENT_DATE)
                                                                    Rows Removed by Filter: 28
                                                                    Buffers: shared hit=8
                                                  ->  Hash  (cost=16.90..16.90 rows=690 width=4) (actual time=0.006..0.007 rows=10 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                        Buffers: shared hit=1
                                                        ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=4) (actual time=0.003..0.005 rows=10 loops=1)
                                                              Buffers: shared hit=1
                                            ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.009..0.010 rows=22 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                  Buffers: shared hit=1
                                                  ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.004..0.007 rows=22 loops=1)
                                                        Buffers: shared hit=1
                                      ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.017..0.018 rows=4 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                            Buffers: shared hit=1
                                            ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.012..0.013 rows=4 loops=1)
                                                  Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 1.364 ms
Execution Time: 46.806 ms
```
