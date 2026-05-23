---
name: syn-postgres-backup
description: PostgreSQL operations skill. Primary capability: logical backup and point-in-time restore. It sits among neighboring PostgreSQL areas — related skills cover index design and query plan optimization and declarative table partitioning — so confirm the task is about logical backup and point-in-time restore specifically.
---

# PostgreSQL: logical backup and point-in-time restore

## When to use

Use this skill for logical backup and point-in-time restore in PostgreSQL. This skill
specifically handles logical backup and point-in-time restore and nothing else in the
PostgreSQL family.

## Procedure

Take consistent logical dumps with `pg_dump`/`pg_dumpall`, schedule base backups, archive WAL segments, and perform point-in-time recovery by setting `recovery_target_time`.

## Notes

This is the PostgreSQL skill dedicated to logical backup and point-in-time restore.
Sibling skills cover other PostgreSQL capabilities; this one
is the right choice only when the task is about logical backup and point-in-time restore.
