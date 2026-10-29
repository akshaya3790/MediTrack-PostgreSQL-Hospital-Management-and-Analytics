# 09_not_completed_history_effect.sql

Rows returned: 4. Columns: history_group, appointments, not_completed_rate, lift_vs_group_mean, lift_vs_overall.

Measured on 2026-10-29 against the database in ANALYTICS_DB_NAME.

```text
Sort  (cost=6051.14..6051.31 rows=67 width=136) (actual time=69.992..70.005 rows=4 loops=1)
  Sort Key: grouped.history_group
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1528
  CTE grouped
    ->  Subquery Scan on ml_appointment_features  (cost=3904.98..5320.07 rows=13164 width=33) (actual time=24.507..54.623 rows=25406 loops=1)
          Buffers: shared hit=1528
          ->  Subquery Scan on history  (cost=3904.98..5089.70 rows=13164 width=99) (actual time=24.505..51.444 rows=25406 loops=1)
                Filter: history.is_past
                Rows Removed by Filter: 921
                Buffers: shared hit=1528
                ->  WindowAgg  (cost=3904.98..4826.43 rows=26327 width=72) (actual time=24.502..47.155 rows=26327 loops=1)
                      Buffers: shared hit=1528
                      ->  Sort  (cost=3904.98..3970.80 rows=26327 width=16) (actual time=24.483..33.489 rows=26327 loops=1)
                            Sort Key: f.patient_sk, d.full_date, f.start_hour, f.appointment_id
                            Sort Method: quicksort  Memory: 1797kB
                            Buffers: shared hit=1528
                            ->  Hash Join  (cost=50.60..1972.02 rows=26327 width=16) (actual time=0.533..11.775 rows=26327 loops=1)
                                  Hash Cond: (f.department_sk = dep.department_sk)
                                  Buffers: shared hit=1528
                                  ->  Hash Join  (cost=25.08..1876.97 rows=26327 width=20) (actual time=0.515..8.590 rows=26327 loops=1)
                                        Hash Cond: (f.date_key = d.date_key)
                                        Buffers: shared hit=1527
                                        ->  Seq Scan on fact_appointment f  (cost=0.00..1782.39 rows=26327 width=20) (actual time=0.337..3.542 rows=26327 loops=1)
                                              Filter: ((NOT is_removed) AND (patient_sk IS NOT NULL))
                                              Rows Removed by Filter: 12
                                              Buffers: shared hit=1519
                                        ->  Hash  (cost=15.59..15.59 rows=759 width=8) (actual time=0.172..0.174 rows=759 loops=1)
                                              Buckets: 1024  Batches: 1  Memory Usage: 38kB
                                              Buffers: shared hit=8
                                              ->  Seq Scan on dim_date d  (cost=0.00..15.59 rows=759 width=8) (actual time=0.005..0.101 rows=759 loops=1)
                                                    Buffers: shared hit=8
                                  ->  Hash  (cost=16.90..16.90 rows=690 width=4) (actual time=0.013..0.014 rows=10 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                        Buffers: shared hit=1
                                        ->  Seq Scan on dim_department dep  (cost=0.00..16.90 rows=690 width=4) (actual time=0.007..0.009 rows=10 loops=1)
                                              Buffers: shared hit=1
  InitPlan 2 (returns $1)
    ->  Aggregate  (cost=329.10..329.11 rows=1 width=32) (actual time=3.105..3.106 rows=1 loops=1)
          ->  CTE Scan on grouped grouped_1  (cost=0.00..263.28 rows=13164 width=1) (actual time=0.001..1.511 rows=25406 loops=1)
  ->  WindowAgg  (cost=394.92..399.93 rows=67 width=136) (actual time=69.970..69.979 rows=4 loops=1)
        Buffers: shared hit=1528
        ->  HashAggregate  (cost=394.92..397.92 rows=67 width=72) (actual time=66.839..66.842 rows=4 loops=1)
              Group Key: grouped.history_group
              Filter: (count(*) >= 5)
              Batches: 1  Memory Usage: 40kB
              Buffers: shared hit=1528
              ->  CTE Scan on grouped  (cost=0.00..263.28 rows=13164 width=33) (actual time=24.510..62.024 rows=25406 loops=1)
                    Buffers: shared hit=1528
Planning:
  Buffers: shared hit=12
Planning Time: 0.616 ms
Execution Time: 70.541 ms
```
