# 04_not_completed_weekday_hour.sql

Rows returned: 55. Columns: day_name, start_hour, past, not_completed, rate, rate_low_95, rate_high_95, overall_rate.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=1924.44..1924.64 rows=82 width=180) (actual time=63.172..63.185 rows=55 loops=1)
  Sort Key: c.iso_dow, c.start_hour
  Sort Method: quicksort  Memory: 29kB
  Buffers: shared hit=77804
  CTE cells
    ->  GroupAggregate  (cost=1902.13..1904.39 rows=82 width=28) (actual time=58.786..62.776 rows=55 loops=1)
          Group Key: d.iso_dow, d.day_name, f.start_hour
          Buffers: shared hit=77804
          ->  Sort  (cost=1902.13..1902.34 rows=82 width=44) (actual time=58.703..60.213 rows=25406 loops=1)
                Sort Key: d.iso_dow, d.day_name, f.start_hour
                Sort Method: quicksort  Memory: 1970kB
                Buffers: shared hit=77804
                ->  Nested Loop  (cost=14.27..1899.53 rows=82 width=44) (actual time=0.739..47.650 rows=25406 loops=1)
                      Buffers: shared hit=77804
                      ->  Nested Loop  (cost=14.12..1893.69 rows=82 width=48) (actual time=0.734..39.347 rows=25406 loops=1)
                            Buffers: shared hit=77760
                            ->  Nested Loop  (cost=13.96..1889.80 rows=82 width=52) (actual time=0.724..31.257 rows=25406 loops=1)
                                  Buffers: shared hit=77740
                                  ->  Hash Join  (cost=13.68..1865.67 rows=82 width=46) (actual time=0.716..7.802 rows=25406 loops=1)
                                        Hash Cond: (f.status_key = s.status_key)
                                        Buffers: shared hit=1522
                                        ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26339 width=16) (actual time=0.346..2.714 rows=26339 loops=1)
                                              Buffers: shared hit=1519
                                        ->  Hash  (cost=13.66..13.66 rows=2 width=34) (actual time=0.018..0.020 rows=2 loops=1)
                                              Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                              Buffers: shared hit=3
                                              ->  Bitmap Heap Scan on dim_appointment_status s  (cost=8.32..13.66 rows=2 width=34) (actual time=0.014..0.015 rows=2 loops=1)
                                                    Recheck Cond: (status_code = ANY ('{completed,unresolved}'::text[]))
                                                    Heap Blocks: exact=1
                                                    Buffers: shared hit=3
                                                    ->  Bitmap Index Scan on dim_appointment_status_status_code_key  (cost=0.00..8.32 rows=2 width=0) (actual time=0.008..0.009 rows=2 loops=1)
                                                          Index Cond: (status_code = ANY ('{completed,unresolved}'::text[]))
                                                          Buffers: shared hit=2
                                  ->  Index Scan using dim_date_pkey on dim_date d  (cost=0.28..0.29 rows=1 width=14) (actual time=0.001..0.001 rows=1 loops=25406)
                                        Index Cond: (date_key = f.date_key)
                                        Buffers: shared hit=76218
                            ->  Memoize  (cost=0.16..0.18 rows=1 width=4) (actual time=0.000..0.000 rows=1 loops=25406)
                                  Cache Key: f.department_sk
                                  Cache Mode: logical
                                  Hits: 25396  Misses: 10  Evictions: 0  Overflows: 0  Memory Usage: 2kB
                                  Buffers: shared hit=20
                                  ->  Index Only Scan using dim_department_pkey on dim_department dep  (cost=0.15..0.17 rows=1 width=4) (actual time=0.001..0.001 rows=1 loops=10)
                                        Index Cond: (department_sk = f.department_sk)
                                        Heap Fetches: 10
                                        Buffers: shared hit=20
                      ->  Memoize  (cost=0.16..0.18 rows=1 width=4) (actual time=0.000..0.000 rows=1 loops=25406)
                            Cache Key: f.doctor_sk
                            Cache Mode: logical
                            Hits: 25384  Misses: 22  Evictions: 0  Overflows: 0  Memory Usage: 3kB
                            Buffers: shared hit=44
                            ->  Index Only Scan using dim_doctor_pkey on dim_doctor doc  (cost=0.15..0.17 rows=1 width=4) (actual time=0.001..0.001 rows=1 loops=22)
                                  Index Cond: (doctor_sk = f.doctor_sk)
                                  Heap Fetches: 22
                                  Buffers: shared hit=44
  ->  Nested Loop  (cost=2.06..17.45 rows=82 width=180) (actual time=62.837..63.154 rows=55 loops=1)
        Buffers: shared hit=77804
        ->  Aggregate  (cost=2.06..2.07 rows=1 width=32) (actual time=62.808..62.809 rows=1 loops=1)
              Buffers: shared hit=77804
              ->  CTE Scan on cells  (cost=0.00..1.64 rows=82 width=16) (actual time=58.790..62.790 rows=55 loops=1)
                    Buffers: shared hit=77804
        ->  CTE Scan on cells c  (cost=0.00..1.64 rows=82 width=52) (actual time=0.000..0.004 rows=55 loops=1)
Planning:
  Buffers: shared hit=15
Planning Time: 0.814 ms
Execution Time: 63.565 ms
```
