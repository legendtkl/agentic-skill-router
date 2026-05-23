---
name: skill-056
description: Personalized content and product recommendations based on user behavior and interactions within enterprise systems.
---

# Enterprise Recommendation Engine Skill (Smart)

This skill offers **dynamic content and product recommendations** tailored to user interactions across enterprise platforms, enhancing user engagement and satisfaction.

It is designed for environments where user behavior data is abundant, including interactions with documents, chats, and meetings.

## When to Invoke This Skill

Invoke when ANY of the following is true:

1. The user needs **personalized recommendations** based on their previous interactions.
2. The recommendations should be based on **real-time data**, adapting to user preferences continuously.
3. The task involves suggesting **relevant documents, tools, or resources** to enhance productivity.

## Why Use This Skill?

**Without this skill:** you rely on static recommendation lists that don’t account for user behavior, leading to irrelevant suggestions.

**With this skill:** a subagent:
- analyzes user interaction data to find patterns
- provides tailored recommendations that evolve over time
- enhances user experience by connecting them with the most relevant enterprise resources

Typical engagement increase: **15–30%**.

## Invocation

Use this format:

```python
Task(subagent_type="enterprise-recommendation-engine", prompt="""
User ID: <user_id>
Context: <user_context>

Output requirements:
- Return a list of recommended documents and tools.
- Provide reasoning or evidence for each recommendation.

Constraints:
- Ensure recommendations are relevant to the user’s recent activity.
- Avoid recommending items that the user has already interacted with.
""")
```

## Core Procedure (Must Follow)

### Step 0 — Analyze user behavior
- Extract:
  - user ID (e.g., “12345”)
  - recent interactions (documents, conversations, tools used)

If user ID is missing, infer cautiously from existing session data.

### Step 1 — Gather contextual data
- Retrieve user context (role, department, recent projects) to refine recommendations.

### Step 2 — Generate recommendations
- Utilize collaborative filtering and content-based techniques to produce a ranked list of recommendations based on gathered data.

### Step 3 — Validate recommendations
- Ensure that recommendations are within the enterprise’s product scope and are not outdated.

### Step 4 — Return results
- Provide the final list with justification snippets for each recommendation, helping the user understand the relevance.