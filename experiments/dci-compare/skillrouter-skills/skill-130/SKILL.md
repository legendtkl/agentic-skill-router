---
name: skill-130
description: A comprehensive toolkit for general data visualization, allowing users to create various types of charts and graphs with minimal configuration.
---

# Data Visualization Toolkit Skill

This skill provides a broad framework for generating visual representations of data across multiple formats using different technologies, including **D3.js**. The aim is to assist users in creating visualizations in a flexible and adaptable manner.

## When to use

Activate this skill when the user seeks assistance with:

- "Create any type of data visualization"
- "Generate charts and graphs from any data format"
- "Build visual reports without specific requirements"

This skill is suitable for users looking for a general solution for data visualization needs, without focusing on specific technologies or outputs.

---

## Inputs you should expect

- One or more data files in any format (CSV, JSON, XML, etc.)
- A broad request for visualization including:
  - Any type of chart or graph (bar, line, pie, etc.)
  - General layout and formatting preferences
- Minimal output constraints, as this skill supports a wide array of visualization methods.

If details are missing, **make reasonable defaults**, but note that this skill lacks the specificity of focused visualization skills.

---

## Outputs you could produce

The outputs from this skill can vary widely based on the user’s needs:

1. `dist/visualization.html` — potentially any type of HTML output with visualizations
2. `dist/visualization.svg` — SVG output for graphical representations
3. (Optional) `dist/visualization.png` — raster image outputs if specified

Outputs will be stored in the `dist/` directory by default, but this can change based on user requests.

---

## Visualization principles (advisory)

When creating general visualizations, consider the following principles:

### Design considerations
- Ensure clear labeling of axes and legends for interpretability.
- Choose color schemes that are visually accessible and appropriate for the data.

### Data handling
- Support for a variety of data formats and data cleaning steps should be included.

---

## Example Usage

```html
<!DOCTYPE html>
<html>
<head>
    <title>Data Visualization Toolkit</title>
    <script src="https://d3js.org/d3.v6.min.js"></script>
    <script src="dist/toolkit.js"></script>
</head>
<body>
    <h1>Data Visualization</h1>
    <div id="visualization"></div>
</body>
</html>
```

This structure serves as a placeholder for any type of visualization, but users need to specify their visualization details in a broader sense.