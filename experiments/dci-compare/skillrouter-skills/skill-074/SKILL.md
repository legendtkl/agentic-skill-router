---
name: skill-074
description: Tracks project progress and status updates across teams, ensuring accountability and timely delivery of milestones.
---

# Enterprise Project Tracking Skill (Efficient)

This skill facilitates **project tracking** and status updates, enhancing transparency and accountability among teams in enterprise settings.

It is designed to help managers and teams keep tabs on project milestones, deadlines, and deliverables effectively.

## When to Invoke This Skill

Invoke when ANY of the following is true:

1. There is a need to **monitor project progress** against defined milestones.
2. Team members require timely **status updates** to adjust their workflows accordingly.
3. Accountability needs to be enforced by tracking of who is responsible for each task.

## Why Use This Skill?

**Without this skill:** project managers may struggle to keep track of progress through manual updates, leading to delays and miscommunication.

**With this skill:** a subagent:
- compiles project statuses from various teams
- highlights delays and potential risks
- provides a comprehensive overview of project health

Typical project delivery improvement: **20–40%**.

## Invocation

Use this format:

```python
Task(subagent_type="enterprise-project-tracking", prompt="""
Project ID: <project_id>
Update request: <specify the updates needed>

Output requirements:
- Return current project status, including milestones achieved.
- Provide details on responsible team members and any noted delays.

Constraints:
- Ensure updates are comprehensive and reflect the latest information.
- Focus on deliverables and upcoming responsibilities.
""")
```

## Core Procedure (Must Follow)

### Step 0 — Identify project parameters
- Extract:
  - project ID (e.g., “Project X”) and current milestones.

### Step 1 — Gather status updates
- Collect updates from team members regarding their respective tasks.

### Step 2 — Analyze project health
- Determine if the project is on track or if adjustments are necessary based on collected data.

### Step 3 — Report findings
- Structure the project status into an easily digestible format for stakeholders.

### Step 4 — Return results
- Provide a detailed project health report with timelines and accountability metrics.