---
name: syn-nginx-ratelimit
description: NGINX operations skill. Primary capability: request rate limiting. It sits among neighboring NGINX areas — related skills cover proxy response caching and reverse proxy configuration — so confirm the task is about request rate limiting specifically.
---

# NGINX: request rate limiting

## When to use

Use this skill for request rate limiting in NGINX. This skill
specifically handles request rate limiting and nothing else in the
NGINX family.

## Procedure

Use `limit_req_zone`/`limit_req` and `limit_conn` to throttle abusive clients, set burst and nodelay, return 429s.

## Notes

This is the NGINX skill dedicated to request rate limiting.
Sibling skills cover other NGINX capabilities; this one
is the right choice only when the task is about request rate limiting.
