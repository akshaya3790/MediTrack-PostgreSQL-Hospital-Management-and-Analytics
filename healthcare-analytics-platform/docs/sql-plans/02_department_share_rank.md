# 02_department_share_rank.sql

Rows returned: 90. Columns: quarter_start, department_name, appointments, share_pct, demand_rank, share_change_pts, rank_gain.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=10719.30..10785.12 rows=26327 width=124) (actual time=26.935..26.946 rows=90 loops=1)
  Sort Key: q.quarter_start, (dense_rank() OVER (?)), q.department_name
  Sort Method: quicksort  Memory: 31kB
  Buffers: shared hit=1530
  ->  WindowAgg  (cost=8062.34..8786.34 rows=26327 width=124) (actual time=26.842..26.901 rows=90 loops=1)
        Buffers: shared hit=1530
        ->  Sort  (cost=8062.34..8128.16 rows=26327 width=84) (actual time=26.838..26.848 rows=90 loops=1)
              Sort Key: q.department_name, q.quarter_start
              Sort Method: quicksort  Memory: 30kB
              Buffers: shared hit=1530
              ->  WindowAgg  (cost=4944.67..6129.38 rows=26327 width=84) (actual time=26.724..26.805 rows=90 loops=1)
                    Buffers: shared hit=1530
                    ->  WindowAgg  (cost=4944.67..5471.21 rows=26327 width=52) (actual time=26.701..26.740 rows=90 loops=1)
                          Buffers: shared hit=1530
                          ->  Sort  (cost=4944.67..5010.49 rows=26327 width=44) (actual time=26.678..26.689 rows=90 loops=1)
                                Sort Key: q.quarter_start, q.appointments DESC
                                Sort Method: quicksort  Memory: 29kB
                                Buffers: shared hit=1530
                                ->  Subquery Scan on q  (cost=2550.98..3011.71 rows=26327 width=44) (actual time=26.508..26.653 rows=90 loops=1)
                                      Buffers: shared hit=1530
                                      ->  HashAggregate  (cost=2550.98..3011.71 rows=26327 width=44) (actual time=26.506..26.642 rows=90 loops=1)
                                            Group Key: (date_trunc('quarter'::text, (d.full_date)::timestamp with time zone))::date, dep.department_name
                                            Batches: 1  Memory Usage: 793kB
                                            Buffers: shared hit=1530
                                            ->  Hash Join  (cost=95.35..2353.53 rows=26327 width=36) (actual time=0.557..22.497 rows=26327 loops=1)
                                                  Hash Cond: (f.status_key = s.status_key)
                                                  Buffers: shared hit=1530
                                                  ->  Hash Join  (cost=70.95..2062.11 rows=26327 width=38) (actual time=0.525..14.393 rows=26327 loops=1)
                                                        Hash Cond: (f.doctor_sk = doc.doctor_sk)
                                                        Buffers: shared hit=1529
                                                        ->  Hash Join  (cost=50.60..1972.02 rows=26327 width=42) (actual time=0.509..10.974 rows=26327 loops=1)
                                                              Hash Cond: (f.department_sk = dep.department_sk)
                                                              Buffers: shared hit=1528
                                                              ->  Hash Join  (cost=25.08..1876.97 rows=26327 width=14) (actual time=0.490..7.481 rows=26327 loops=1)
                                                                    Hash Cond: (f.date_key = d.date_key)
                                                                    Buffers: shared hit=1527
                                                                    ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=14) (actual time=0.329..3.589 rows=26327 loops=1)
                                                                          Filter: (NOT is_removed)
                                                                          Rows Removed by Filter: 12
                                                                          Buffers: shared hit=1519
                                                                    ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.148..0.149 rows=759 loops=1)
                                                                          Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                                                          Buffers: shared hit=8
                                                                          ->  Seq Scan on dim_date d  (cost=0.00..15.59 rows=759 width=8) (actual time=0.005..0.066 rows=759 loops=1)
                                                                                Buffers: shared hit=8
                                                              ->  Hash  (cost=16.90..16.90 rows=690 width=36) (actual time=0.009..0.009 rows=10 loops=1)
                                                                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                                    Buffers: shared hit=1
                                                                    ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.004..0.005 rows=10 loops=1)
                                                                          Buffers: shared hit=1
                                                        ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.010..0.011 rows=22 loops=1)
                                                              Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                              Buffers: shared hit=1
                                                              ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.004..0.006 rows=22 loops=1)
                                                                    Buffers: shared hit=1
                                                  ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.017..0.018 rows=4 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                        Buffers: shared hit=1
                                                        ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.012..0.013 rows=4 loops=1)
                                                              Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.793 ms
Execution Time: 27.517 ms
```
