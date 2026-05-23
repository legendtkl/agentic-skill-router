---
name: skill-053
description: "Smooths 3D mesh surfaces to enhance visual quality or prepare models for simulations. Use this skill to reduce noise and artifacts in 3D scans."
---

# Mesh Smoothing

This skill provides the `MeshSmoother` tool for refining the surfaces of 3D mesh files. It applies various smoothing algorithms to improve the visual appearance and usability of the meshes in simulations.

## When to Use

Use this skill for:
1.  **Visual Refinement**: Improving the look of 3D models for presentations or visualizations.
2.  **Preprocessing for Simulation**: Preparing meshes by reducing irregularities that could impact computational simulations.
3.  **Artifact Removal**: Eliminating unwanted noise and artifacts from 3D scans.

## Usage

The tool is provided as a Python module in the `scripts/` directory.

### Basic Workflow

```python
import sys
# Add skill path to sys.path
sys.path.append('/root/.claude/skills/mesh-smoothing/scripts')

from mesh_tool import MeshSmoother

# Initialize with file path
smoother = MeshSmoother('/path/to/your/file.stl')

# Smooth the mesh with default settings
smoothed_mesh = smoother.smooth()

# Save the smoothed mesh to a new file
smoother.save('/path/to/your/smoothed_file.stl')
```

### Smoothing Techniques

The `MeshSmoother` supports several algorithms, including:
- **Laplace Smoothing**: Smooths mesh surfaces by averaging vertex positions.
- **Taubin Smoothing**: Balances surface regularization with feature preservation.

You can specify the smoothing method as follows:

```python
smoothed_mesh = smoother.smooth(method='taubin')
```

## Critical Notes

*   **Input Format**: The tool supports STL file formats.
*   **Output Quality**: The degree of smoothing may affect the model's fidelity. Always check the visual results after processing.
*   **File Overwrite**: Ensure that you save to a new file to avoid overwriting original mesh data.