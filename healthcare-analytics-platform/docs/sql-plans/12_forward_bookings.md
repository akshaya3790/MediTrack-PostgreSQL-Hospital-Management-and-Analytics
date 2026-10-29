# 12_forward_bookings.sql

Rows returned: 40. Columns: week_start, department_name, booked_ahead, last_year, fill_vs_last_year.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Incremental Sort  (cost=110766.85..173512.50 rows=690000 width=84) (actual time=38.157..38.170 rows=40 loops=1)
  Sort Key: (((generate_series((((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7))::timestamp with time zone, (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28))::timestamp with time zone, '7 days'::interval)))::date), dep.department_name
  Presorted Key: (((generate_series((((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7))::timestamp with time zone, (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28))::timestamp with time zone, '7 days'::interval)))::date)
  Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 27kB  Peak Memory: 27kB
  Buffers: shared hit=1532
  CTE weekly
    ->  HashAggregate  (cost=2021.06..2025.96 rows=490 width=16) (actual time=6.073..6.092 rows=80 loops=1)
          Group Key: d.week_start, f.department_sk
          Batches: 1  Memory Usage: 49kB
          Buffers: shared hit=1530
          ->  Hash Join  (cost=135.97..2004.92 rows=2151 width=8) (actual time=0.844..5.811 rows=1859 loops=1)
                Hash Cond: (f.status_key = s.status_key)
                Buffers: shared hit=1530
                ->  Hash Join  (cost=111.57..1974.84 rows=2151 width=10) (actual time=0.801..5.531 rows=1859 loops=1)
                      Hash Cond: (f.doctor_sk = doc.doctor_sk)
                      Buffers: shared hit=1529
                      ->  Hash Join  (cost=91.22..1948.79 rows=2151 width=14) (actual time=0.781..5.272 rows=1859 loops=1)
                            Hash Cond: (f.department_sk = dep_1.department_sk)
                            Buffers: shared hit=1528
                            ->  Hash Join  (cost=65.70..1917.59 rows=2151 width=14) (actual time=0.765..5.018 rows=1859 loops=1)
                                  Hash Cond: (f.date_key = d.date_key)
                                  Buffers: shared hit=1527
                                  ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=14) (actual time=0.386..2.903 rows=26327 loops=1)
                                        Filter: (NOT is_removed)
                                        Rows Removed by Filter: 12
                                        Buffers: shared hit=1519
                                  ->  Hash  (cost=64.92..64.92 rows=62 width=8) (actual time=0.368..0.369 rows=53 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 11kB
                                        Buffers: shared hit=8
                                        ->  Seq Scan on dim_date d  (cost=0.00..64.92 rows=62 width=8) (actual time=0.154..0.361 rows=53 loops=1)
                                              Filter: (((week_start >= ((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7)) AND (week_start <= ((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28))) OR ((week_start >= (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7) - 364)) AND (week_start <= (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28) - 364))))
                                              Rows Removed by Filter: 706
                                              Buffers: shared hit=8
                            ->  Hash  (cost=16.90..16.90 rows=690 width=4) (actual time=0.010..0.011 rows=10 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=1
                                  ->  Seq Scan on dim_department dep_1  (cost=0.00..16.90 rows=690 width=4) (actual time=0.005..0.006 rows=10 loops=1)
                                        Buffers: shared hit=1
                      ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.012..0.013 rows=22 loops=1)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=1
                            ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.006..0.008 rows=22 loops=1)
                                  Buffers: shared hit=1
                ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.029..0.030 rows=4 loops=1)
                      Buckets: 1024  Batches: 1  Memory Usage: 9kB
                      Buffers: shared hit=1
                      ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.023..0.025 rows=4 loops=1)
                            Buffers: shared hit=1
  ->  Merge Left Join  (cost=108468.95..122311.83 rows=690000 width=84) (actual time=38.112..38.139 rows=40 loops=1)
        Merge Cond: (((((generate_series((((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7))::timestamp with time zone, (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28))::timestamp with time zone, '7 days'::interval)))::date) = now_.week_start) AND (dep.department_sk = now_.department_sk))
        Buffers: shared hit=1532
        ->  Sort  (cost=108437.26..110162.26 rows=690000 width=48) (actual time=38.045..38.049 rows=40 loops=1)
              Sort Key: (((generate_series((((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7))::timestamp with time zone, (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28))::timestamp with time zone, '7 days'::interval)))::date), dep.department_sk
              Sort Method: quicksort  Memory: 27kB
              Buffers: shared hit=1532
              ->  Merge Left Join  (cost=31.84..20292.74 rows=690000 width=48) (actual time=37.935..38.029 rows=40 loops=1)
                    Merge Cond: (dep.department_sk = ly.department_sk)
                    Join Filter: (ly.week_start = ((((generate_series((((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 7))::timestamp with time zone, (((date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))::date + 28))::timestamp with time zone, '7 days'::interval)))::date) - 364))
                    Rows Removed by Join Filter: 280
                    Buffers: shared hit=1532
                    ->  Nested Loop  (cost=0.15..8736.05 rows=690000 width=40) (actual time=31.784..31.816 rows=40 loops=1)
                          Buffers: shared hit=2
                          ->  Index Scan using dim_department_pkey on dim_department dep  (cost=0.15..58.50 rows=690 width=36) (actual time=0.071..0.081 rows=10 loops=1)
                                Buffers: shared hit=2
                          ->  Materialize  (cost=0.00..55.05 rows=1000 width=4) (actual time=3.171..3.172 rows=4 loops=10)
                                ->  Result  (cost=0.00..50.05 rows=1000 width=4) (actual time=31.703..31.712 rows=4 loops=1)
                                      ->  ProjectSet  (cost=0.00..5.05 rows=1000 width=8) (actual time=31.699..31.707 rows=4 loops=1)
                                            ->  Result  (cost=0.00..0.01 rows=1 width=0) (actual time=31.661..31.662 rows=1 loops=1)
                    ->  Sort  (cost=31.69..32.92 rows=490 width=16) (actual time=6.135..6.149 rows=317 loops=1)
                          Sort Key: ly.department_sk
                          Sort Method: quicksort  Memory: 28kB
                          Buffers: shared hit=1530
                          ->  CTE Scan on weekly ly  (cost=0.00..9.80 rows=490 width=16) (actual time=6.082..6.109 rows=80 loops=1)
                                Buffers: shared hit=1530
        ->  Sort  (cost=31.69..32.92 rows=490 width=16) (actual time=0.035..0.039 rows=80 loops=1)
              Sort Key: now_.week_start, now_.department_sk
              Sort Method: quicksort  Memory: 28kB
              ->  CTE Scan on weekly now_  (cost=0.00..9.80 rows=490 width=16) (actual time=0.003..0.009 rows=80 loops=1)
Planning:
  Buffers: shared hit=12
Planning Time: 0.806 ms
JIT:
  Functions: 70
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 1.964 ms, Inlining 0.000 ms, Optimization 1.585 ms, Emission 30.157 ms, Total 33.707 ms
Execution Time: 40.356 ms
```
