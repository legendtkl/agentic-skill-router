---
name: skill-107
description: Visualize complex network structures using D3.js (v6), enabling users to explore relationships and connections between data points.
---

# D3.js Network Visualization Skill

Use this skill to create visual representations of network structures such as social networks, data relationships, or any interconnected systems using **D3.js**. The goal is to provide users with a visual insight into how different nodes are connected.

## When to use

Activate this skill when the user asks for any of the following:

- "Visualize a network of relationships"
- "Create a social network graph"
- "Show connections between entities"
- "Map out a data relationship structure"

If the user requires more traditional data visualizations (e.g., charts, graphs), **don’t** use this skill—opt for the D3.js Visualization Skill instead.

---

## Inputs you should expect

- One or more local data files: `*.json` or `*.csv` containing node and link data
- A network intent:
  - Node attributes (e.g., id, name, group)
  - Link attributes (e.g., source, target, relationship type)
  - Visualization preferences (e.g., layout type, force-directed graph)
- Output constraints:
  - Interactivity level (e.g., "hover to display details" or "click to expand nodes")

If details are missing, **make reasonable defaults** and document them in comments near the top of the output file.

---

## Outputs you should produce

Prefer producing **all of** the following when feasible:

1. `dist/network.html` — standalone HTML that renders the network visualization
2. `dist/network.svg` — exported SVG representation of the network
3. (Optional) `dist/network.json` — if the task requires a data export of the network structure

Always keep outputs in a predictable folder (default: `dist/`), unless the task specifies paths.

---

## Network visualization principles (non-negotiable)

To create effective network visualizations:

### Layout considerations
- Use a force-directed layout for dynamic representations unless specified otherwise.
- Provide options for different layouts (e.g., radial, hierarchical) based on user needs.

### Interactivity features
- Implement tooltips for nodes and links to display additional information on hover.
- Allow users to zoom and pan to explore dense network areas efficiently.

---

## Example Usage

```html
<!DOCTYPE html>
<html>
<head>
    <title>Network Visualization</title>
    <script src="https://d3js.org/d3.v6.min.js"></script>
    <script src="dist/network.js"></script>
</head>
<body>
    <h1>Network Graph</h1>
    <div id="network"></div>
</body>
</html>
```

This example demonstrates how to set up a simple HTML file to visualize a network. The `network.js` file would contain the logic for creating nodes and links and handling interactivity.