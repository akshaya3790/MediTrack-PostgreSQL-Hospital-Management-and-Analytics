# 03_rolling_department_demand.sql

Rows returned: 1050. Columns: week_start, department_name, appointments, rolling_4w, rolling_13w, weeks_in_window, trend_signal.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=88529.49..89103.91 rows=229770 width=148) (actual time=18.222..18.271 rows=1050 loops=1)
  Sort Key: dep.department_name, w.week_start
  Sort Method: quicksort  Memory: 136kB
  Buffers: shared hit=1612
  ->  WindowAgg  (cost=37577.39..50789.16 rows=229770 width=148) (actual time=16.538..18.039 rows=1050 loops=1)
        Buffers: shared hit=1612
        ->  WindowAgg  (cost=37577.39..42172.79 rows=229770 width=76) (actual time=16.526..17.076 rows=1050 loops=1)
              Buffers: shared hit=1612
              ->  Sort  (cost=37577.39..38151.81 rows=229770 width=44) (actual time=16.515..16.582 rows=1050 loops=1)
                    Sort Key: dep.department_sk, w.week_start
                    Sort Method: quicksort  Memory: 99kB
                    Buffers: shared hit=1612
                    ->  Hash Left Join  (cost=3038.24..7748.86 rows=229770 width=44) (actual time=16.038..16.375 rows=1050 loops=1)
                          Hash Cond: ((w.week_start = c.week_start) AND (dep.department_sk = c.department_sk))
                          Buffers: shared hit=1612
                          ->  Nested Loop  (cost=925.67..3855.55 rows=229770 width=40) (actual time=6.267..6.466 rows=1050 loops=1)
                                Buffers: shared hit=85
                                ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=36) (actual time=0.003..0.006 rows=10 loops=1)
                                      Buffers: shared hit=1
                                ->  Materialize  (cost=925.67..967.36 rows=333 width=4) (actual time=0.626..0.637 rows=105 loops=10)
                                      Buffers: shared hit=84
                                      ->  Subquery Scan on w  (cost=925.67..965.70 rows=333 width=4) (actual time=6.258..6.319 rows=105 loops=1)
                                            Filter: (w.week_start <= CURRENT_DATE)
                                            Rows Removed by Filter: 4
                                            Buffers: shared hit=84
                                            ->  Result  (cost=925.67..950.70 rows=1000 width=4) (actual time=6.256..6.307 rows=109 loops=1)
                                                  Buffers: shared hit=84
                                                  ->  ProjectSet  (cost=925.67..930.70 rows=1000 width=8) (actual time=6.255..6.292 rows=109 loops=1)
                                                        Buffers: shared hit=84
                                                        ->  Aggregate  (cost=925.67..925.68 rows=1 width=8) (actual time=6.247..6.250 rows=1 loops=1)
                                                              Buffers: shared hit=84
                                                              ->  Hash Join  (cost=25.37..793.98 rows=26339 width=4) (actual time=0.203..4.817 rows=26339 loops=1)
                                                                    Hash Cond: (f.date_key = d.date_key)
                                                                    Buffers: shared hit=84
                                                                    ->  Index Only Scan using fact_appointment_date_idx on fact_appointment f  (cost=0.29..699.37 rows=26339 width=4) (actual time=0.006..1.734 rows=26339 loops=1)
                                                                          Heap Fetches: 0
                                                                          Buffers: shared hit=76
                                                                    ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.192..0.193 rows=759 loops=1)
                                                                          Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                                                          Buffers: shared hit=8
                                                                          ->  Seq Scan on dim_date d  (cost=0.00..15.59 rows=759 width=8) (actual time=0.003..0.120 rows=759 loops=1)
                                                                                Buffers: shared hit=8
                          ->  Hash  (cost=2096.22..2096.22 rows=1090 width=16) (actual time=9.761..9.763 rows=1090 loops=1)
                                Buckets: 2048  Batches: 1  Memory Usage: 68kB
                                Buffers: shared hit=1527
                                ->  Subquery Scan on c  (cost=2074.42..2096.22 rows=1090 width=16) (actual time=9.486..9.657 rows=1090 loops=1)
                                      Buffers: shared hit=1527
                                      ->  HashAggregate  (cost=2074.42..2085.32 rows=1090 width=16) (actual time=9.485..9.575 rows=1090 loops=1)
                                            Group Key: d_1.week_start, f_1.department_sk
                                            Batches: 1  Memory Usage: 193kB
                                            Buffers: shared hit=1527
                                            ->  Hash Join  (cost=25.08..1876.97 rows=26327 width=8) (actual time=0.390..6.381 rows=26327 loops=1)
                                                  Hash Cond: (f_1.date_key = d_1.date_key)
                                                  Buffers: shared hit=1527
                                                  ->  Seq Scan on fact_appointment f_1  (cost=0.00..1782.39 rows=26327 width=8) (actual time=0.257..2.911 rows=26327 loops=1)
                                                        Filter: (NOT is_removed)
                                                        Rows Removed by Filter: 12
                                                        Buffers: shared hit=1519
                                                  ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.122..0.123 rows=759 loops=1)
                                                        Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                                        Buffers: shared hit=8
                                                        ->  Seq Scan on dim_date d_1  (cost=0.00..15.59 rows=759 width=8) (actual time=0.004..0.060 rows=759 loops=1)
                                                              Buffers: shared hit=8
Planning:
  Buffers: shared hit=24
Planning Time: 0.525 ms
Execution Time: 18.428 ms
```
