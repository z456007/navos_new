# SQL Explain Report

Generated at: 2026-07-11T18:04:26.847Z (Asia/Shanghai date 2026-07-12)
Database: 127.0.0.1:3306/navos_new

| query | key used | rows | notes |
|---|---|---:|---|
| account lease | (none) | 121 | `idx_accounts_lease_pick` exists in `possible_keys`; MySQL optimizer chose table scan on this small local fixture even after `ANALYZE TABLE`; `FORCE INDEX` verifies the index is usable. |
| image running | idx_image_tasks_status | 1 | expected key used |
| video running | idx_video_tasks_status | 1 | expected key used |
| yyds domain pick | (none) | 365 | `idx_yyds_domain_health_pick` exists in `possible_keys`; MySQL optimizer chose table scan on this small local fixture even after `ANALYZE TABLE`; `FORCE INDEX` verifies the index is usable. |

## Index existence check

- `accounts.idx_accounts_lease_pick`: present on `(status, rate_limited_until, lease_until, balance_remaining, last_used_at, created_at)`.
- `image_tasks.idx_image_tasks_status`: present and selected.
- `video_tasks.idx_video_tasks_status`: present and selected.
- `yyds_domain_health.idx_yyds_domain_health_pick`: present on `(status, cooldown_until, weight, last_success_at, last_failure_at)`.

## Queries

### account lease

```sql
EXPLAIN SELECT * FROM accounts
WHERE status = 'active'
  AND rate_limited_until <= 0
  AND lease_until <= 0
  AND balance_remaining >= 0
ORDER BY last_used_at ASC, created_at ASC
LIMIT 1
FOR UPDATE;
```

### image running

```sql
EXPLAIN SELECT * FROM image_tasks WHERE status = 'running' ORDER BY updated_at ASC LIMIT 100;
```

### video running

```sql
EXPLAIN SELECT * FROM video_tasks WHERE status = 'running' ORDER BY updated_at ASC LIMIT 100;
```

### yyds domain pick

```sql
EXPLAIN SELECT * FROM yyds_domain_health WHERE status IN ('active','cooldown') ORDER BY weight DESC LIMIT 100;
```

## Forced-index sanity checks

```sql
EXPLAIN SELECT * FROM accounts FORCE INDEX (idx_accounts_lease_pick)
WHERE status = 'active'
  AND rate_limited_until <= 0
  AND lease_until <= 0
  AND balance_remaining >= 0
ORDER BY last_used_at ASC, created_at ASC
LIMIT 1
FOR UPDATE;
-- key = idx_accounts_lease_pick, Extra = Using index condition; Using filesort
```

```sql
EXPLAIN SELECT * FROM yyds_domain_health FORCE INDEX (idx_yyds_domain_health_pick)
WHERE status IN ('active','cooldown')
ORDER BY weight DESC
LIMIT 100;
-- key = idx_yyds_domain_health_pick, Extra = Using index condition; Using filesort
```

