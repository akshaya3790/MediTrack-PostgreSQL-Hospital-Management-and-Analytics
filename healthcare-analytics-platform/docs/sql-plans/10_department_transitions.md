# 10_department_transitions.sql

Rows returned: 100. Columns: from_department, to_department, transitions, pct_of_from, same_department.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Incremental Sort  (cost=5156.26..5204.78 rows=845 width=105) (actual time=39.134..39.208 rows=100 loops=1)
  Sort Key: seq.from_department, (count(*)) DESC
  Presorted Key: seq.from_department
  Full-sort Groups: 3  Sort Method: quicksort  Average Memory: 27kB  Peak Memory: 27kB
  Buffers: shared hit=1530
  ->  WindowAgg  (cost=5156.09..5181.44 rows=845 width=105) (actual time=39.088..39.157 rows=100 loops=1)
        Buffers: shared hit=1530
        ->  Sort  (cost=5156.09..5158.20 rows=845 width=72) (actual time=39.072..39.088 rows=100 loops=1)
              Sort Key: seq.from_department
              Sort Method: quicksort  Memory: 30kB
              Buffers: shared hit=1530
              ->  HashAggregate  (cost=5083.31..5115.01 rows=845 width=72) (actual time=39.018..39.051 rows=100 loops=1)
                    Group Key: seq.from_department, seq.to_department
                    Filter: (count(*) >= 5)
                    Batches: 1  Memory Usage: 129kB
                    Buffers: shared hit=1530
                    ->  Subquery Scan on seq  (cost=4006.63..4894.09 rows=25229 width=64) (actual time=24.319..35.420 rows=23458 loops=1)
                          Filter: (seq.to_department IS NOT NULL)
                          Rows Removed by Filter: 1998
                          Buffers: shared hit=1530
                          ->  WindowAgg  (cost=4006.63..4640.53 rows=25356 width=78) (actual time=24.318..33.500 rows=25456 loops=1)
                                Buffers: shared hit=1530
                                ->  Sort  (cost=4006.63..4070.02 rows=25356 width=46) (actual time=24.298..26.241 rows=25456 loops=1)
                                      Sort Key: f.patient_sk, d.full_date, f.start_hour, f.appointment_id
                                      Sort Method: quicksort  Memory: 2190kB
                                      Buffers: shared hit=1530
                                      ->  Hash Join  (cost=98.80..2151.83 rows=25356 width=46) (actual time=0.829..16.006 rows=25456 loops=1)
                                            Hash Cond: (f.status_key = s.status_key)
                                            Buffers: shared hit=1530
                                            ->  Hash Join  (cost=74.40..2060.43 rows=25356 width=48) (actual time=0.813..13.104 rows=25456 loops=1)
                                                  Hash Cond: (f.doctor_sk = doc.doctor_sk)
                                                  Buffers: shared hit=1529
                                                  ->  Hash Join  (cost=54.05..1972.91 rows=25356 width=52) (actual time=0.803..10.162 rows=25456 loops=1)
                                                        Hash Cond: (f.department_sk = dep.department_sk)
                                                        Buffers: shared hit=1528
                                                        ->  Hash Join  (cost=28.52..1880.41 rows=25356 width=24) (actual time=0.793..7.173 rows=25456 loops=1)
                                                              Hash Cond: (f.date_key = d.date_key)
                                                              Buffers: shared hit=1527
                                                              ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=24) (actual time=0.343..3.429 rows=26327 loops=1)
                                                                    Filter: ((NOT is_removed) AND (patient_sk IS NOT NULL))
                                                                    Rows Removed by Filter: 12
                                                                    Buffers: shared hit=1519
                                                              ->  Hash  (cost=19.38..19.38 rows=731 width=8) (actual time=0.147..0.149 rows=731 loops=1)
                                                                    Buckets: 1024  Batches: 1  Memory Usage: 37kB
                                                                    Buffers: shared hit=8
                                                                    ->  Seq Scan on dim_date d  (cost=0.00..19.38 rows=731 width=8) (actual time=0.006..0.087 rows=731 loops=1)
                                                                          Filter: (full_date <= CURRENT_DATE)
                                                                          Rows Removed by Filter: 28
                                                                          Buffers: shared hit=8
                                                        ->  Hash  (cost=16.90..16.90 rows=690 width=36) (actual time=0.006..0.007 rows=10 loops=1)
                                                              Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                              Buffers: shared hit=1
                                                              ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.003..0.005 rows=10 loops=1)
                                                                    Buffers: shared hit=1
                                                  ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.008..0.008 rows=22 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                        Buffers: shared hit=1
                                                        ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.003..0.005 rows=22 loops=1)
                                                              Buffers: shared hit=1
                                            ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.012..0.012 rows=4 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                  Buffers: shared hit=1
                                                  ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.007..0.008 rows=4 loops=1)
                                                        Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.874 ms
Execution Time: 39.818 ms
```
