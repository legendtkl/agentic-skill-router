---
name: skill-136
description: Create animated visualizations using D3.js (v6) to bring data stories to life with motion and transitions.
---

# D3.js Animated Visualization Skill

This skill allows you to create dynamic and animated visualizations using **D3.js**. The aim is to enhance the storytelling aspect of data by integrating animations and transitions that engage viewers and illustrate changes over time.

## When to use

Activate this skill when the user asks for any of the following:

- "Create an animated chart or graph"
- "Show transitions between data states"
- "Visualize data evolution over time"
- "Make my visualization more engaging with motion"

If the user requires static visualizations or offline outputs, **don’t** proceed with this skill—opt for the D3.js Visualization Skill instead.

---

## Inputs you should expect

- One or more local data files: `*.csv`, `*.json`, or `*.tsv`
- Animation requirements:
  - Desired types of transitions (e.g., enter, update, exit)
  - Timing specifications (duration, delay)
  - Effects to apply (e.g., fade, slide, scale)
- Visualization preferences regarding dimensions, color schemes, and labeling

If details are missing, **make reasonable defaults** and document them in comments near the top of the output file.

---

## Outputs you should produce

Prefer producing **all of** the following when feasible:

1. `dist/animated-visualization.html` — standalone HTML that renders the animated visualization
2. `dist/animated-visualization.js` — JavaScript file containing the animation logic
3. (Optional) `dist/animated-visualization.gif` — if the task specifies a GIF output of the animation

Always keep outputs in a predictable folder (default: `dist/`), unless the task specifies paths.

---

## Animation principles (non-negotiable)

To create effective animated visualizations:

### Animation guidelines
- Use smooth and natural transitions between states to maintain viewer engagement.
- Keep the duration of animations consistent and predictable to avoid disorientation.
- Ensure that animations enhance the comprehension of the data rather than distract from it.

### Performance considerations
- Optimize animations to ensure they run smoothly even with large datasets; avoid heavy computations during transitions.

---

## Example Usage

```html
<!DOCTYPE html>
<html>
<head>
    <title>Animated Visualization</title>
    <script src="https://d3js.org/d3.v6.min.js"></script>
    <script src="dist/animated-visualization.js"></script>
</head>
<body>
    <h1>Animated Data Visualization</h1>
    <div id="animated-vis"></div>
</body>
</html>
```

This example shows how to set up an HTML file for displaying animated visualizations. The accompanying JavaScript file would contain the logic for managing animations based on the data provided.