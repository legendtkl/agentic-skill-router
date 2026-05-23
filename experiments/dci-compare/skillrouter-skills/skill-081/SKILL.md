---
name: skill-081
description: "Visualizes 3D mesh data in an interactive viewer. Use this skill to explore mesh structures and properties visually."
---

# Mesh Visualization

This skill provides the `MeshVisualizer` tool for rendering and exploring 3D STL mesh files in an interactive environment. Use this tool for visualization purposes to better understand mesh properties and structure.

## When to Use

Use this skill for:
1.  **Interactive Exploration**: Navigating through 3D models to inspect features closely.
2.  **Presentation**: Showing 3D models in meetings or educational settings.
3.  **Debugging**: Identifying issues in mesh topology or integrity by visually inspecting the model.

## Usage

The tool is provided as a Python module in the `scripts/` directory.

### Basic Workflow

```python
import sys
# Add skill path to sys.path
sys.path.append('/root/.claude/skills/mesh-visualization/scripts')

from mesh_tool import MeshVisualizer

# Initialize with file path
visualizer = MeshVisualizer('/path/to/your/file.stl')

# Render the mesh in the viewer
visualizer.render()
```

### Interaction Features

The `MeshVisualizer` supports various interaction features:
- **Rotate**: Click and drag to rotate the mesh.
- **Zoom**: Use scroll wheel or pinch to zoom in and out.
- **View Properties**: Display mesh information such as vertex count and edges in the UI.

## Critical Notes

*   **Rendering Performance**: Larger meshes may require more processing power and time to render.
*   **Dependencies**: Ensure you have graphical libraries installed, such as PyOpenGL, for proper visualization.
*   **Interactive Mode**: The tool launches an interactive window; ensure your environment supports GUI operations.