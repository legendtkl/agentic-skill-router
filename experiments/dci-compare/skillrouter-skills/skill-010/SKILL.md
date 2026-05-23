---
name: skill-010
description: "Aligns multiple 3D scans into a unified coordinate system. Use this skill to consolidate overlapping mesh data from different sources."
---

# Mesh Registration

This skill provides the `MeshRegistrar` tool for aligning and merging multiple 3D mesh files into a single coherent model. It is particularly useful in situations where multiple scans of the same object or area need to be combined.

## When to Use

Use this skill for:
1.  **Combining Scans**: Merging data from different perspectives or devices into one unified mesh.
2.  **Enhanced Detail**: Utilizing overlapping data to improve the overall detail and quality of the final model.
3.  **Geometric Alignment**: Correcting position discrepancies between scans.

## Usage

The tool is provided as a Python module in the `scripts/` directory.

### Basic Workflow

```python
import sys
# Add skill path to sys.path
sys.path.append('/root/.claude/skills/mesh-registration/scripts')

from mesh_tool import MeshRegistrar

# Initialize with file paths of the meshes to align
registrar = MeshRegistrar(['/path/to/your/scan1.stl', '/path/to/your/scan2.stl'])

# Perform the registration
registered_mesh = registrar.register()

# Save the registered mesh to a new file
registrar.save('/path/to/your/registered_mesh.stl')
```

### Registration Techniques

The `MeshRegistrar` supports various alignment methods, including:
- **ICP (Iterative Closest Point)**: Aligns meshes by minimizing the distance between corresponding points.
- **Feature Matching**: Uses identifiable features to align meshes more accurately.

You can specify the registration method as follows:

```python
registered_mesh = registrar.register(method='icp')
```

## Critical Notes

*   **Input Format**: The tool supports STL and OBJ file formats for registration.
*   **Output Quality**: The accuracy of registration depends on the quality and overlap of the original scans.
*   **File Management**: Save registered meshes to avoid overwriting original data and to maintain version control.