---
name: skill-118
description: "A comprehensive skill for processing 3D mesh data, including analysis, smoothing, and visualization techniques."
---

# Mesh Processing

This skill aims to provide an all-encompassing solution for various tasks related to 3D mesh data processing. It covers an array of mesh operations, from geometric analysis to visual enhancements.

## When to Use

Use this skill for:
1.  **General Mesh Operations**: Performing a wide variety of actions on 3D models, suitable for different applications.
2.  **Industry Applications**: Useful in engineering, gaming, and augmented reality contexts.
3.  **Research and Development**: Facilitating analysis and modifications for academic or industrial research.

## Usage

The tools are provided as a Python module in the `scripts/` directory. Depending on the specific task, the relevant tools can be imported and used accordingly.

### Basic Workflow for Different Tasks

```python
import sys
# Add skill path to sys.path
sys.path.append('/root/.claude/skills/mesh-processing/scripts')

from mesh_tool import MeshAnalyzer, MeshSmoother, MeshVisualizer

# Example for analysis
analyzer = MeshAnalyzer('/path/to/your/file.stl')
report = analyzer.analyze_largest_component()

# Example for smoothing
smoother = MeshSmoother('/path/to/your/file.stl')
smooth_mesh = smoother.smooth()

# Example for visualization
visualizer = MeshVisualizer('/path/to/your/file.stl')
visualizer.render()
```

### Critical Notes

*   **Tool Variety**: Each task has a specific tool; ensure you are using the right one for your needs.
*   **Formats and Compatibility**: The tools aim to support common mesh formats like STL, OBJ, and PLY, but check compatibility before use.
*   **Performance Considerations**: Heavy processing tasks may require optimization depending on the mesh complexity.