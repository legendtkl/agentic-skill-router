---
name: syn-postgres-vacuum
description: PostgreSQL operations skill. Primary capability: autovacuum and bloat control. It sits among neighboring PostgreSQL areas — related skills cover streaming replication between a primary and standby and logical backup and point-in-time restore — so confirm the task is about autovacuum and bloat control specifically.
---

# PostgreSQL: autovacuum and bloat control

## When to use

Use this skill for autovacuum and bloat control in PostgreSQL. This skill
specifically handles autovacuum and bloat control and nothing else in the
PostgreSQL family.

## Procedure

Diagnose table/index bloat, tune `autovacuum_vacuum_scale_factor` and cost limits, run `VACUUM FULL`/`pg_repack`, and stop transaction-ID wraparound.

## Notes

This is the PostgreSQL skill dedicated to autovacuum and bloat control.
Sibling skills cover other PostgreSQL capabilities; this one
is the right choice only when the task is about autovacuum and bloat control.
