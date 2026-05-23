---
name: syn-k8s-netpolicy
description: Kubernetes operations skill. Primary capability: network policy isolation. It sits among neighboring Kubernetes areas — related skills cover Deployment rollout and rollback and Ingress routing and TLS — so confirm the task is about network policy isolation specifically.
---

# Kubernetes: network policy isolation

## When to use

Use this skill for network policy isolation in Kubernetes. This skill
specifically handles network policy isolation and nothing else in the
Kubernetes family.

## Procedure

Write NetworkPolicy resources to default-deny traffic and explicitly allow pod-to-pod ingress/egress by label selector and port.

## Notes

This is the Kubernetes skill dedicated to network policy isolation.
Sibling skills cover other Kubernetes capabilities; this one
is the right choice only when the task is about network policy isolation.
