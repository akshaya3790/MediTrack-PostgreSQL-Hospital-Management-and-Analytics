# 08_workload_concentration.sql

Rows returned: 10. Columns: department_name, doctors, appointments, gini, top_doctor_share.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=4167.24..4167.74 rows=200 width=136) (actual time=13.919..13.928 rows=10 loops=1)
  Sort Key: (round((sum(((((2 * (row_number() OVER (?))) - (count(*) OVER (?))) - 1) * per_doctor.appointments)) / NULLIF(((max((count(*) OVER (?))))::numeric * max((sum(per_doctor.appointments) OVER (?)))), '0'::numeric)), 3)) DESC, per_doctor.department_name
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1530
  ->  GroupAggregate  (cost=3264.45..4159.60 rows=200 width=136) (actual time=13.881..13.916 rows=10 loops=1)
        Group Key: per_doctor.department_name
        Buffers: shared hit=1530
        ->  WindowAgg  (cost=3264.45..3740.51 rows=12695 width=120) (actual time=13.863..13.888 rows=22 loops=1)
              Buffers: shared hit=1530
              ->  WindowAgg  (cost=3264.45..3518.35 rows=12695 width=48) (actual time=13.850..13.868 rows=22 loops=1)
                    Buffers: shared hit=1530
                    ->  Sort  (cost=3264.45..3296.19 rows=12695 width=40) (actual time=13.843..13.852 rows=22 loops=1)
                          Sort Key: per_doctor.department_name, per_doctor.appointments
                          Sort Method: quicksort  Memory: 26kB
                          Buffers: shared hit=1530
                          ->  Subquery Scan on per_doctor  (cost=2145.26..2399.16 rows=12695 width=40) (actual time=13.767..13.832 rows=22 loops=1)
                                Buffers: shared hit=1530
                                ->  HashAggregate  (cost=2145.26..2272.21 rows=12695 width=72) (actual time=13.766..13.829 rows=22 loops=1)
                                      Group Key: dep.department_name, doc.doctor_key
                                      Batches: 1  Memory Usage: 409kB
                                      Buffers: shared hit=1530
                                      ->  Hash Join  (cost=97.45..2050.05 rows=12695 width=64) (actual time=0.889..11.480 rows=13409 loops=1)
                                            Hash Cond: (f.status_key = s.status_key)
                                            Buffers: shared hit=1530
                                            ->  Hash Join  (cost=73.05..1992.10 rows=12695 width=66) (actual time=0.866..9.815 rows=13409 loops=1)
                                                  Hash Cond: (f.doctor_sk = doc.doctor_sk)
                                                  Buffers: shared hit=1529
                                                  ->  Hash Join  (cost=52.70..1938.11 rows=12695 width=38) (actual time=0.849..8.102 rows=13409 loops=1)
                                                        Hash Cond: (f.department_sk = dep.department_sk)
                                                        Buffers: shared hit=1528
                                                        ->  Hash Join  (cost=27.18..1879.07 rows=12695 width=10) (actual time=0.835..6.414 rows=13409 loops=1)
                                                              Hash Cond: (f.date_key = d.date_key)
                                                              Buffers: shared hit=1527
                                                              ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=14) (actual time=0.355..3.447 rows=26327 loops=1)
                                                                    Filter: (NOT is_removed)
                                                                    Rows Removed by Filter: 12
                                                                    Buffers: shared hit=1519
                                                              ->  Hash  (cost=22.60..22.60 rows=366 width=4) (actual time=0.162..0.163 rows=366 loops=1)
                                                                    Buckets: 1024  Batches: 1  Memory Usage: 21kB
                                                                    Buffers: shared hit=8
                                                                    ->  Index Scan using dim_date_full_date_key on dim_date d  (cost=0.28..22.60 rows=366 width=4) (actual time=0.016..0.121 rows=366 loops=1)
                                                                          Index Cond: ((full_date >= (CURRENT_DATE - 365)) AND (full_date <= CURRENT_DATE))
                                                                          Buffers: shared hit=8
                                                        ->  Hash  (cost=16.90..16.90 rows=690 width=36) (actual time=0.008..0.009 rows=10 loops=1)
                                                              Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                              Buffers: shared hit=1
                                                              ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.004..0.006 rows=10 loops=1)
                                                                    Buffers: shared hit=1
                                                  ->  Hash  (cost=14.60..14.60 rows=460 width=36) (actual time=0.011..0.012 rows=22 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                        Buffers: shared hit=1
                                                        ->  Seq Scan on dim_doctor doc  (cost=0.00..14.60 rows=460 width=36) (actual time=0.005..0.008 rows=22 loops=1)
                                                              Buffers: shared hit=1
                                            ->  Hash  (cost=16.40..16.40 rows=640 width=2) (actual time=0.016..0.017 rows=4 loops=1)
                                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                  Buffers: shared hit=1
                                                  ->  Seq Scan on dim_appointment_status s  (cost=0.00..16.40 rows=640 width=2) (actual time=0.011..0.012 rows=4 loops=1)
                                                        Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.994 ms
Execution Time: 14.085 ms
```
