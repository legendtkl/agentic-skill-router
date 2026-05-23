---
name: skill-060
description: Create interactive data exploration tools using D3.js (v6), enabling users to filter and drill down into datasets for deeper insight.
---

# D3.js Interactive Data Exploration Skill

This skill allows you to build interactive dashboards and data exploration tools using **D3.js**. The goal is to facilitate user interaction with complex datasets, allowing them to filter, sort, and drill down into the data dynamically.

## When to use

Activate this skill when the user asks for any of the following:

- "Create an interactive dashboard"
- "Enable filtering on my dataset"
- "Build a data exploration tool"
- "Allow users to drill down into data"
- "Visualize data with interactive features"

If the user requires static visualizations or reports, **don’t** use this skill—opt for the D3.js Visualization Skill instead.

---

## Inputs you should expect

- One or more local data files: `*.csv`, `*.tsv`, `*.json`
- User interaction requirements:
  - Filter options (fields, conditions)
  - Sorting preferences
  - Drill-down paths (hierarchical structure)
  - Dimensions (width/height) for the dashboard
  - Any labeling requirements (titles, descriptions)
- Output constraints:
  - Interactivity level (e.g., "requires dynamic filtering" or "no interaction needed")

If details are missing, **make reasonable defaults** and document them in comments near the top of the output file.

---

## Outputs you should produce

Prefer producing **all of** the following when feasible:

1. `dist/dashboard.html` — standalone HTML that renders the interactive exploration tool
2. `dist/dashboard.js` — JavaScript file containing the interactivity logic (modular and reusable)
3. (Optional) `dist/dashboard.css` — if the task specifies custom styling for the dashboard

Always keep outputs in a predictable folder (default: `dist/`), unless the task specifies paths.

---

## Interactivity guidelines (non-negotiable)

To ensure a smooth user experience:

### Interaction rules
- Provide clear UI elements for filtering and sorting (e.g., dropdowns, sliders).
- Ensure that data updates dynamically based on user interactions without page refresh.
- Maintain consistent visual feedback (e.g., loading indicators when fetching new data).

### Data loading considerations
- Use asynchronous data loading techniques (e.g., `d3.json`, `d3.csv`) to avoid blocking the UI.
- Implement error handling to manage data loading failures gracefully.

---

## Example Usage

```html
<!DOCTYPE html>
<html>
<head>
    <title>Interactive Data Dashboard</title>
    <link rel="stylesheet" href="dist/dashboard.css">
    <script src="https://d3js.org/d3.v6.min.js"></script>
    <script src="dist/dashboard.js"></script>
</head>
<body>
    <div id="dashboard">
        <h1>Data Exploration Dashboard</h1>
        <div id="filters"></div>
        <svg id="visualization"></svg>
    </div>
</body>
</html>
```

This example demonstrates the basic structure of an HTML file that uses the interactive data exploration tool. Adjust the `#filters` and `#visualization` elements based on your dataset and requirements.