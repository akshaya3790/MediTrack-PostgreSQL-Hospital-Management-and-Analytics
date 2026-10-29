# 11_over_capacity_days.sql

Rows returned: 250. Columns: department_name, month_start, days_with_capacity, days_without_capacity, overbooked_days, peak_pressure, mean_pressure.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=2823.79..2824.43 rows=254 width=124) (actual time=22.020..22.039 rows=250 loops=1)
  Sort Key: dep.department_name, d.month_start
  Sort Method: quicksort  Memory: 44kB
  Buffers: shared hit=1716
  ->  HashAggregate  (cost=2809.20..2813.65 rows=254 width=124) (actual time=21.787..21.898 rows=250 loops=1)
        Group Key: dep.department_name, d.month_start
        Batches: 1  Memory Usage: 285kB
        Buffers: shared hit=1716
        ->  Hash Join  (cost=2576.82..2656.98 rows=2537 width=94) (actual time=13.724..18.089 rows=7310 loops=1)
              Hash Cond: (COALESCE(f.department_sk, c.department_sk) = dep.department_sk)
              Buffers: shared hit=1716
              ->  Hash Join  (cost=2551.30..2624.75 rows=2537 width=24) (actual time=13.704..16.940 rows=7310 loops=1)
                    Hash Cond: (COALESCE(f.date_key, c.date_key) = d.date_key)
                    Buffers: shared hit=1715
                    ->  Hash Full Join  (cost=2522.77..2589.28 rows=2634 width=28) (actual time=13.544..15.666 rows=7590 loops=1)
                          Hash Cond: ((f.date_key = c.date_key) AND (f.department_sk = c.department_sk))
                          Buffers: shared hit=1707
                          ->  HashAggregate  (cost=1979.93..2006.27 rows=2634 width=48) (actual time=7.340..8.032 rows=6248 loops=1)
                                Group Key: f.date_key, f.department_sk
                                Batches: 1  Memory Usage: 721kB
                                Buffers: shared hit=1519
                                ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26339 width=9) (actual time=0.331..2.323 rows=26339 loops=1)
                                      Buffers: shared hit=1519
                          ->  Hash  (cost=517.79..517.79 rows=1670 width=12) (actual time=6.196..6.199 rows=7590 loops=1)
                                Buckets: 8192 (originally 2048)  Batches: 1 (originally 1)  Memory Usage: 391kB
                                Buffers: shared hit=188
                                ->  Subquery Scan on c  (cost=480.22..517.79 rows=1670 width=12) (actual time=4.083..5.473 rows=7590 loops=1)
                                      Buffers: shared hit=188
                                      ->  HashAggregate  (cost=480.22..501.09 rows=1670 width=12) (actual time=4.082..4.850 rows=7590 loops=1)
                                            Group Key: c_1.date_key, c_1.department_sk
                                            Batches: 1  Memory Usage: 913kB
                                            Buffers: shared hit=188
                                            ->  Seq Scan on fact_doctor_daily_capacity c_1  (cost=0.00..354.98 rows=16698 width=10) (actual time=0.003..1.040 rows=16698 loops=1)
                                                  Buffers: shared hit=188
                    ->  Hash  (cost=19.38..19.38 rows=731 width=8) (actual time=0.155..0.156 rows=731 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 37kB
                          Buffers: shared hit=8
                          ->  Seq Scan on dim_date d  (cost=0.00..19.38 rows=731 width=8) (actual time=0.005..0.091 rows=731 loops=1)
                                Filter: (full_date <= CURRENT_DATE)
                                Rows Removed by Filter: 28
                                Buffers: shared hit=8
              ->  Hash  (cost=16.90..16.90 rows=690 width=36) (actual time=0.013..0.014 rows=10 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                    Buffers: shared hit=1
                    ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.008..0.010 rows=10 loops=1)
                          Buffers: shared hit=1
Planning:
  Buffers: shared hit=8
Planning Time: 0.400 ms
Execution Time: 22.212 ms
```
