---
name: syn-nginx-loadbalancing
description: NGINX operations skill. Primary capability: upstream load balancing. It sits among neighboring NGINX areas — related skills cover TLS termination and HTTPS and request rate limiting — so confirm the task is about upstream load balancing specifically.
---

# NGINX: upstream load balancing

## When to use

Use this skill for upstream load balancing in NGINX. This skill
specifically handles upstream load balancing and nothing else in the
NGINX family.

## Procedure

Define an `upstream` block across several backends, pick a balancing method (round-robin, least_conn, ip_hash), and set health checks.

## Notes

This is the NGINX skill dedicated to upstream load balancing.
Sibling skills cover other NGINX capabilities; this one
is the right choice only when the task is about upstream load balancing.
