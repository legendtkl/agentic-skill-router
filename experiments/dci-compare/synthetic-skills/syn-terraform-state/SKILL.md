---
name: syn-terraform-state
description: Terraform operations skill. Primary capability: remote state and locking. It sits among neighboring Terraform areas — related skills cover reusable module authoring and provider and multi-region configuration — so confirm the task is about remote state and locking specifically.
---

# Terraform: remote state and locking

## When to use

Use this skill for remote state and locking in Terraform. This skill
specifically handles remote state and locking and nothing else in the
Terraform family.

## Procedure

Configure a remote backend (S3 + DynamoDB lock), migrate local state, and handle state locking and `terraform state` surgery.

## Notes

This is the Terraform skill dedicated to remote state and locking.
Sibling skills cover other Terraform capabilities; this one
is the right choice only when the task is about remote state and locking.
