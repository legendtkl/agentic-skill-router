---
name: skill-013
description: Automates the discovery of insights and patterns from various enterprise data sources, enhancing strategic planning.
---

# Enterprise Knowledge Discovery Skill (Insightful)

This skill focuses on **automating the discovery of insights** from extensive datasets across the enterprise, enabling informed strategic planning and decision-making.

It is designed for organizations with vast amounts of data that need to be analyzed to uncover valuable insights and trends.

## When to Invoke This Skill

Invoke when ANY of the following is true:

1. The user is looking to **uncover hidden patterns** in historical data for strategic decisions.
2. Insights are needed from **various types of data** sources, such as documents, databases, and communication logs.
3. There is a requirement to generate **reports** that summarize findings from the analysis.

## Why Use This Skill?

**Without this skill:** manual analysis of data can lead to missed opportunities and inefficient strategies due to the sheer volume of information.

**With this skill:** a subagent:
- systematically analyzes data from multiple sources
- identifies trends, correlations, and insights
- generates comprehensive reports for stakeholders

Typical insight generation improvement: **25–50%**.

## Invocation

Use this format:

```python
Task(subagent_type="enterprise-knowledge-discovery", prompt="""
Data sources: <list of data sources>
Objective: <define the objective for the discovery process>

Output requirements:
- Return key insights and patterns identified.
- Provide context and implications of these findings.

Constraints:
- Focus on actionable insights that relate to strategic planning.
- Avoid irrelevant data or findings that do not contribute to the objective.
""")
```

## Core Procedure (Must Follow)

### Step 0 — Define the discovery objective
- Extract:
  - the core objective for the discovery process (e.g., market trends analysis)

### Step 1 — Collect data
- Gather data from all specified sources relevant to the objective.

### Step 2 — Analyze for insights
- Use analytical techniques to identify significant patterns and insights.

### Step 3 — Compile findings
- Structure insights into a clear format for reporting.

### Step 4 — Return results
- Provide a comprehensive overview of the insights and their implications.