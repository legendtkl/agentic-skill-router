---
name: skill-022
description: Create geographical map visualizations using D3.js (v6) to represent spatial data and geographical relationships.
---

# D3.js Map Visualization Skill

This skill enables the creation of geographical visualizations using **D3.js**. It focuses on rendering maps and spatial relationships to effectively display data that has a geographical context, such as demographics, weather patterns, or resource distribution.

## When to use

Activate this skill when the user needs assistance with:

- "Visualize geographical data on a map"
- "Create a choropleth map"
- "Show spatial data relationships"
- "Map data distributions across regions"

If the user requires non-geographical visualizations, **don’t** use this skill—opt for the D3.js Visualization Skill instead.

---

## Inputs you should expect

- One or more local data files: `*.json`, `*.csv` with geographical coordinates or region data
- Mapping requirements:
  - Geographical boundaries (geoJSON topology)
  - Data attributes to bind to regions (e.g., population, sales)
  - Visualization preferences (color scales, legend)
- Output constraints:
  - Specific mapping styles (e.g., interactive vs. static maps)

If details are missing, **make reasonable defaults** and document them in comments near the top of the output file.

---

## Outputs you should produce

Prefer producing **all of** the following when feasible:

1. `dist/map.html` — standalone HTML that renders the map visualization
2. `dist/map.svg` — exported SVG representation of the map
3. (Optional) `dist/map.png` — raster image output if specified

Always keep outputs in a predictable folder (default: `dist/`), unless the task specifies paths.

---

## Mapping principles (non-negotiable)

To create effective map visualizations:

### Geospatial accuracy
- Ensure that the geographical data used is accurate and up-to-date for reliable representations.
- Handle data projections appropriately to maintain shape integrity on the map.

### User experience
- Provide interactive features such as zooming and panning to allow users to explore map details.
- Include tooltips for additional contextual information on hover or click.

---

## Example Usage

```html
<!DOCTYPE html>
<html>
<head>
    <title>Map Visualization</title>
    <script src="https://d3js.org/d3.v6.min.js"></script>
    <script src="dist/map.js"></script>
</head>
<body>
    <h1>Geospatial Data Visualization</h1>
    <div id="map"></div>
</body>
</html>
```

This example sets up an HTML page to render a map visualization using D3.js. The associated `map.js` file would contain logic for rendering the geographical data.