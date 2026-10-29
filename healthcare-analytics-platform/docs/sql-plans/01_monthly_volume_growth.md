# 01_monthly_volume_growth.sql

Rows returned: 26. Columns: month_start, appointments, completed, previous_month, mom_growth_pct, same_month_last_year, yoy_growth_pct.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
WindowAgg  (cost=2420.47..2421.90 rows=26 width=100) (actual time=32.013..32.061 rows=26 loops=1)
  Buffers: shared hit=1530
  ->  Sort  (cost=2420.47..2420.53 rows=26 width=20) (actual time=31.976..31.985 rows=26 loops=1)
        Sort Key: d.month_start
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=1530
        ->  HashAggregate  (cost=2419.59..2419.85 rows=26 width=20) (actual time=31.948..31.960 rows=26 loops=1)
              Group Key: d.month_start
              Batches: 1  Memory Usage: 24kB
              Buffers: shared hit=1530
              ->  Hash Join  (cost=95.35..2156.20 rows=26339 width=37) (actual time=0.752..26.515 rows=26339 loops=1)
                    Hash Cond: (f.status_key = s.status_key)
                    Buffers: shared hit=1530
                    ->  Hash Join  (cost=70.95..2062.21 rows=26339 width=7) (actual time=0.713..21.512 rows=26339 loops=1)
                          Hash Cond: (f.doctor_sk = doc.doctor_sk)
                          Buffers: shared hit=1529
                          ->  Hash Join  (cost=50.60..1972.08 rows=26339 width=11) (actual time=0.685..16.701 rows=26339 loops=1)
                                Hash Cond: (f.department_sk = dep.department_sk)
                                Buffers: shared hit=1528
                                ->  Hash Join  (cost=25.08..1877.00 rows=26339 width=15) (actual time=0.655..11.834 rows=26339 loops=1)
                                      Hash Cond: (f.date_key = d.date_key)
                                      Buffers: shared hit=1527
                                      ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26339 width=15) (actual time=0.400..3.489 rows=26339 loops=1)
                                            Buffers: shared hit=1519
                                      ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.226..0.227 rows=759 loops=1)
                                            Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                            Buffers: shared hit=8
                                            ->  Seq Scan on dim_date d  (cost=0.00..15.59 rows=759 width=8) (actual time=0.012..0.108 rows=759 loops=1)
                                                  Buffers: shared hit=8
                                ->  Hash  (cost=16.90..16.90 rows=690 width=4) (actual time=0.010..0.011 rows=10 loops=1)
                                      Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                      Buffers: shared hit=1
                                      ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=4) (actual time=0.004..0.005 rows=10 loops=1)
                                            Buffers: shared hit=1
                          ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.013..0.014 rows=22 loops=1)
                                Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                Buffers: shared hit=1
                                ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.005..0.007 rows=22 loops=1)
                                      Buffers: shared hit=1
                    ->  Hash  (cost=16.40..16.40 rows=640 width=34) (actual time=0.022..0.023 rows=4 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          Buffers: shared hit=1
                          ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=34) (actual time=0.015..0.016 rows=4 loops=1)
                                Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 1.281 ms
Execution Time: 32.273 ms
```
