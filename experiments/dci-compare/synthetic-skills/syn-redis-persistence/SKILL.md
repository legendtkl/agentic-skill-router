---
name: syn-redis-persistence
description: Redis operations skill. Primary capability: RDB and AOF persistence. It sits among neighboring Redis areas — related skills cover cluster sharding and resharding and memory limits and eviction policy tuning — so confirm the task is about RDB and AOF persistence specifically.
---

# Redis: RDB and AOF persistence

## When to use

Use this skill for RDB and AOF persistence in Redis. This skill
specifically handles RDB and AOF persistence and nothing else in the
Redis family.

## Procedure

Choose between RDB snapshots and AOF, tune `appendfsync`, configure save points, and plan restart/restore durability.

## Notes

This is the Redis skill dedicated to RDB and AOF persistence.
Sibling skills cover other Redis capabilities; this one
is the right choice only when the task is about RDB and AOF persistence.
