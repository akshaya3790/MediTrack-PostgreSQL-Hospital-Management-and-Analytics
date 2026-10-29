# 13_removal_rate_trend.sql

Rows returned: 260. Columns: department_name, month_start, seen, removed, removal_rate_pct.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=4090.79..4135.64 rows=17940 width=84) (actual time=24.226..24.247 rows=260 loops=1)
  Sort Key: dep.department_name, d.month_start
  Sort Method: quicksort  Memory: 41kB
  Buffers: shared hit=1530
  ->  HashAggregate  (cost=2419.59..2823.24 rows=17940 width=84) (actual time=23.883..24.099 rows=260 loops=1)
        Group Key: dep.department_name, d.month_start
        Batches: 1  Memory Usage: 817kB
        Buffers: shared hit=1530
        ->  Hash Join  (cost=95.35..2156.20 rows=26339 width=37) (actual time=0.593..19.553 rows=26339 loops=1)
              Hash Cond: (f.status_key = s.status_key)
              Buffers: shared hit=1530
              ->  Hash Join  (cost=70.95..2062.21 rows=26339 width=39) (actual time=0.566..15.945 rows=26339 loops=1)
                    Hash Cond: (f.doctor_sk = doc.doctor_sk)
                    Buffers: shared hit=1529
                    ->  Hash Join  (cost=50.60..1972.08 rows=26339 width=43) (actual time=0.551..12.232 rows=26339 loops=1)
                          Hash Cond: (f.department_sk = dep.department_sk)
                          Buffers: shared hit=1528
                          ->  Hash Join  (cost=25.08..1877.00 rows=26339 width=15) (actual time=0.538..8.487 rows=26339 loops=1)
                                Hash Cond: (f.date_key = d.date_key)
                                Buffers: shared hit=1527
                                ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26339 width=15) (actual time=0.371..2.923 rows=26339 loops=1)
                                      Buffers: shared hit=1519
                                ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.147..0.148 rows=759 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                      Buffers: shared hit=8
                                      ->  Seq Scan on dim_date d  (cost=0.00..15.59 rows=759 width=8) (actual time=0.007..0.078 rows=759 loops=1)
                                            Buffers: shared hit=8
                          ->  Hash  (cost=16.90..16.90 rows=690 width=36) (actual time=0.008..0.009 rows=10 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                Buffers: shared hit=1
                                ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.005..0.006 rows=10 loops=1)
                                      Buffers: shared hit=1
                    ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.010..0.011 rows=22 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          Buffers: shared hit=1
                          ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.005..0.006 rows=22 loops=1)
                                Buffers: shared hit=1
              ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.019..0.020 rows=4 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                    Buffers: shared hit=1
                    ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.013..0.014 rows=4 loops=1)
                          Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.668 ms
Execution Time: 24.793 ms
```
