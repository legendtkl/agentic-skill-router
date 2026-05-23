---
name: syn-rabbitmq-prefetch
description: Operate, configure, troubleshoot, and manage RabbitMQ. Use for RabbitMQ engineering tasks, day-to-day operations, and production support.
---

# RabbitMQ: consumer prefetch and fair dispatch

## When to use

Use this skill for consumer prefetch and fair dispatch in RabbitMQ. This skill
specifically handles consumer prefetch and fair dispatch and nothing else in the
RabbitMQ family.

## Procedure

Tune the `prefetch_count`/QoS so fast consumers aren't starved and slow ones don't hoard unacked messages.

## Notes

This is the RabbitMQ skill dedicated to consumer prefetch and fair dispatch.
Sibling skills cover other RabbitMQ capabilities; this one
is the right choice only when the task is about consumer prefetch and fair dispatch.
