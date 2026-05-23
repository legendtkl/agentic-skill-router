---
name: syn-postgres-replication
description: PostgreSQL operations skill. Primary capability: streaming replication between a primary and standby. It sits among neighboring PostgreSQL areas — related skills cover logical backup and point-in-time restore and index design and query plan optimization — so confirm the task is about streaming replication between a primary and standby specifically.
---

# PostgreSQL: streaming replication between a primary and standby

## When to use

Use this skill for streaming replication between a primary and standby in PostgreSQL. This skill
specifically handles streaming replication between a primary and standby and nothing else in the
PostgreSQL family.

## Procedure

Configure `wal_level=replica`, create a physical replication slot, run `pg_basebackup` to seed the standby, and set `primary_conninfo` so the standby streams WAL from the primary. Verify with `pg_stat_replication`.

## Notes

This is the PostgreSQL skill dedicated to streaming replication between a primary and standby.
Sibling skills cover other PostgreSQL capabilities; this one
is the right choice only when the task is about streaming replication between a primary and standby.
