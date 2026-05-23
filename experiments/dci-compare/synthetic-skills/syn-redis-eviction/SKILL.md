---
name: syn-redis-eviction
description: Redis operations skill. Primary capability: memory limits and eviction policy tuning. It sits among neighboring Redis areas — related skills cover cache-aside patterns and TTLs and pub/sub and stream messaging — so confirm the task is about memory limits and eviction policy tuning specifically.
---

# Redis: memory limits and eviction policy tuning

## When to use

Use this skill for memory limits and eviction policy tuning in Redis. This skill
specifically handles memory limits and eviction policy tuning and nothing else in the
Redis family.

## Procedure

Set `maxmemory`, choose an eviction policy (allkeys-lru, volatile-ttl, …), and analyze key memory with `MEMORY USAGE` and `--bigkeys`.

## Notes

This is the Redis skill dedicated to memory limits and eviction policy tuning.
Sibling skills cover other Redis capabilities; this one
is the right choice only when the task is about memory limits and eviction policy tuning.
