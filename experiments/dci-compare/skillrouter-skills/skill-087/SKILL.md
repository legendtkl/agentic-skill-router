---
name: skill-087
description: A versatile skill for querying structured and unstructured data across enterprise systems to derive insights and support decision-making.
---

# Enterprise Data Query System Skill (Comprehensive)

This skill enables **data querying** across various enterprise sources, including databases, documents, and communication logs, facilitating data-driven decision-making.

It is designed to support a wide array of queries, from simple lookups to complex analytical requests across diverse data types.

## When to Invoke This Skill

Invoke when ANY of the following is true:

1. The user requires data from multiple sources to inform a decision.
2. The task involves combining structured and unstructured data for insights.
3. There is a need for generating reports or analytics based on various datasets.

## Why Use This Skill?

**Without this skill:** users may struggle with disparate data sources, leading to incomplete analysis and poor decision-making.

**With this skill:** a subagent:
- fetches relevant data quickly from different systems
- processes and formats data for reporting purposes
- supports a variety of query types, enhancing flexibility

Typical data retrieval efficiency increase: **50–80%**.

## Invocation

Use this format:

```python
Task(subagent_type="enterprise-data-query-system", prompt="""
Query: <describe your data query here>

Output requirements:
- Return the relevant data extracted from the specified sources.
- Include any necessary context or metadata.

Constraints:
- Ensure that data is recent and applicable to the query.
- Avoid irrelevant data that does not pertain to the query.
""")
```

## Core Procedure (Must Follow)

### Step 0 — Parse user query
- Extract:
  - primary goal of the query (e.g., data retrieval, report generation)
  - specific data sources mentioned (e.g., databases, documents)

### Step 1 — Identify relevant data sources
- Determine which systems contain the necessary data for the query.

### Step 2 — Execute data retrieval
- Query the identified sources and collate results effectively.

### Step 3 — Structure results
- Format data into a clear and actionable structure for user interpretation.

### Step 4 — Return results
- Provide users with the collected data, ensuring clarity and relevance.