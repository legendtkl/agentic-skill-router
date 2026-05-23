---
name: skill-029
description: Summarizes key points and action items from lengthy email threads within enterprise communication systems.
---

# Enterprise Email Summarization Skill (Efficient)

This skill provides **concise summaries of email threads**, extracting essential points and action items to streamline communication in enterprise environments.

It is designed to improve productivity by reducing the time spent sifting through long email chains and ensuring important information is highlighted.

## When to Invoke This Skill

Invoke when ANY of the following is true:

1. The user needs a **summary of a lengthy email thread** to grasp its essential points quickly.
2. Important action items need to be **extracted** to delegate tasks efficiently.
3. Communication clarity is needed for **team updates** or reports based on email discussions.

## Why Use This Skill?

**Without this skill:** users may miss critical information or spend excessive time reading through emails, leading to inefficiencies.

**With this skill:** a subagent:
- scans email threads for key themes and decisions
- identifies and highlights action items
- provides a structured summary that enhances understanding

Typical time savings: **40–70%**.

## Invocation

Use this format:

```python
Task(subagent_type="enterprise-email-summarization", prompt="""
Email thread: <paste the email thread here>

Output requirements:
- Return a concise summary of key points and action items.
- Provide a list of highlighted decisions and responsible parties.

Constraints:
- Maintain the context and tone of the original emails.
- Avoid summarizing less relevant exchanges.
""")
```

## Core Procedure (Must Follow)

### Step 0 — Parse email content
- Extract:
  - email threads (from, to, subject, body)

If the email thread is too long, prioritize extracting the most recent exchanges.

### Step 1 — Identify key themes
- Analyze the content for recurring subjects and decisions made throughout the thread.

### Step 2 — Extract action items
- Look for phrases indicating tasks or responsibilities and note who is accountable.

### Step 3 — Format summary
- Create a clear, bullet-pointed summary of key points and action items for easy consumption.

### Step 4 — Return results
- Present the summarized content in a user-friendly format.