# 05_patient_cohort_retention.sql

Rows returned: 142. Columns: cohort_month, months_after, cohort_size, retained_patients, retention_pct.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Incremental Sort  (cost=6321.37..8335.65 rows=127 width=56) (actual time=48.527..48.846 rows=142 loops=1)
  Sort Key: sized.cohort_month, sized.months_after
  Presorted Key: sized.cohort_month
  Full-sort Groups: 5  Sort Method: quicksort  Average Memory: 26kB  Peak Memory: 26kB
  Buffers: shared hit=1530
  CTE visits
    ->  HashAggregate  (cost=2278.61..2532.17 rows=25356 width=8) (actual time=21.100..22.896 rows=15442 loops=1)
          Group Key: f_1.patient_sk, d.month_start
          Batches: 1  Memory Usage: 1553kB
          Buffers: shared hit=1530
          ->  Hash Join  (cost=98.80..2151.83 rows=25356 width=8) (actual time=0.814..15.821 rows=25456 loops=1)
                Hash Cond: (f_1.status_key = s.status_key)
                Buffers: shared hit=1530
                ->  Hash Join  (cost=74.40..2060.43 rows=25356 width=10) (actual time=0.793..12.838 rows=25456 loops=1)
                      Hash Cond: (f_1.doctor_sk = doc.doctor_sk)
                      Buffers: shared hit=1529
                      ->  Hash Join  (cost=54.05..1972.91 rows=25356 width=14) (actual time=0.780..9.921 rows=25456 loops=1)
                            Hash Cond: (f_1.department_sk = dep.department_sk)
                            Buffers: shared hit=1528
                            ->  Hash Join  (cost=28.52..1880.41 rows=25356 width=18) (actual time=0.771..7.030 rows=25456 loops=1)
                                  Hash Cond: (f_1.date_key = d.date_key)
                                  Buffers: shared hit=1527
                                  ->  Seq Scan on fact_appointment f_1  (cost=0.00..1782.39 rows=26327 width=18) (actual time=0.355..3.624 rows=26327 loops=1)
                                        Filter: ((NOT is_removed) AND (patient_sk IS NOT NULL))
                                        Rows Removed by Filter: 12
                                        Buffers: shared hit=1519
                                  ->  Hash  (cost=19.38..19.38 rows=731 width=8) (actual time=0.142..0.144 rows=731 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 37kB
                                        Buffers: shared hit=8
                                        ->  Seq Scan on dim_date d  (cost=0.00..19.38 rows=731 width=8) (actual time=0.007..0.083 rows=731 loops=1)
                                              Filter: (full_date <= CURRENT_DATE)
                                              Rows Removed by Filter: 28
                                              Buffers: shared hit=8
                            ->  Hash  (cost=16.90..16.90 rows=690 width=4) (actual time=0.005..0.006 rows=10 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=1
                                  ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=4) (actual time=0.003..0.004 rows=10 loops=1)
                                        Buffers: shared hit=1
                      ->  Hash  (cost=14.60..14.60 rows=460 width=4) (actual time=0.009..0.010 rows=22 loops=1)
                            Buckets: 1024  Batches: 1  Memory Usage: 9kB
                            Buffers: shared hit=1
                            ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=4) (actual time=0.005..0.007 rows=22 loops=1)
                                  Buffers: shared hit=1
                ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.014..0.015 rows=4 loops=1)
                      Buckets: 1024  Batches: 1  Memory Usage: 9kB
                      Buffers: shared hit=1
                      ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.010..0.011 rows=4 loops=1)
                            Buffers: shared hit=1
  ->  Subquery Scan on sized  (cost=3767.58..5798.92 rows=127 width=56) (actual time=46.926..48.792 rows=142 loops=1)
        Filter: ((sized.months_after >= 0) AND (sized.months_after <= 6))
        Rows Removed by Filter: 168
        Buffers: shared hit=1530
        ->  WindowAgg  (cost=3767.58..5415.72 rows=25356 width=24) (actual time=46.918..48.726 rows=310 loops=1)
              Buffers: shared hit=1530
              ->  GroupAggregate  (cost=3767.58..4971.99 rows=25356 width=16) (actual time=46.656..48.614 rows=310 loops=1)
                    Group Key: f.cohort_month, ((((EXTRACT(year FROM age((v.month_start)::timestamp with time zone, (f.cohort_month)::timestamp with time zone)) * '12'::numeric) + EXTRACT(month FROM age((v.month_start)::timestamp with time zone, (f.cohort_month)::timestamp with time zone))))::integer)
                    Buffers: shared hit=1530
                    ->  Sort  (cost=3767.58..3830.97 rows=25356 width=12) (actual time=46.629..47.346 rows=15442 loops=1)
                          Sort Key: f.cohort_month, ((((EXTRACT(year FROM age((v.month_start)::timestamp with time zone, (f.cohort_month)::timestamp with time zone)) * '12'::numeric) + EXTRACT(month FROM age((v.month_start)::timestamp with time zone, (f.cohort_month)::timestamp with time zone))))::integer), v.patient_sk
                          Sort Method: quicksort  Memory: 988kB
                          Buffers: shared hit=1530
                          ->  Hash Join  (cost=640.40..1912.78 rows=25356 width=12) (actual time=28.355..40.103 rows=15442 loops=1)
                                Hash Cond: (v.patient_sk = f.patient_sk)
                                Buffers: shared hit=1530
                                ->  CTE Scan on visits v  (cost=0.00..507.12 rows=25356 width=8) (actual time=21.103..22.001 rows=15442 loops=1)
                                      Buffers: shared hit=1530
                                ->  Hash  (cost=637.90..637.90 rows=200 width=8) (actual time=7.223..7.224 rows=1998 loops=1)
                                      Buckets: 2048 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 95kB
                                      ->  Subquery Scan on f  (cost=633.90..637.90 rows=200 width=8) (actual time=6.682..7.024 rows=1998 loops=1)
                                            ->  HashAggregate  (cost=633.90..635.90 rows=200 width=8) (actual time=6.681..6.868 rows=1998 loops=1)
                                                  Group Key: visits.patient_sk
                                                  Batches: 1  Memory Usage: 257kB
                                                  ->  CTE Scan on visits  (cost=0.00..507.12 rows=25356 width=8) (actual time=0.001..4.548 rows=15442 loops=1)
Planning:
  Buffers: shared hit=12
Planning Time: 0.792 ms
Execution Time: 49.444 ms
```
