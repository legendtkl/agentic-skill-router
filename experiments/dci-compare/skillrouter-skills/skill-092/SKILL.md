---
name: skill-092
description: Analyze fault lines and their properties using geospatial data. Use when assessing seismic hazards and understanding fault behavior.
license: MIT
---

# Fault Line Analysis with GeoPandas

## Overview

Understanding fault lines is crucial for assessing seismic hazards and predicting earthquake behavior. This guide focuses on analyzing fault lines using geospatial data to comprehend their characteristics and potential impacts.

## Key Concepts

### Types of Fault Lines
- **Normal Faults**: Caused by extensional forces where the hanging wall moves down.
- **Reverse Faults**: Caused by compressional forces where the hanging wall moves up.
- **Strike-slip Faults**: Lateral movement along the fault plane.

## Loading Fault Line Data

### From Shapefiles
```python
import geopandas as gpd

# Load fault lines from a shapefile

gdf_faults = gpd.read_file('fault_lines.shp')
```

### Visualizing Fault Lines
```python
import matplotlib.pyplot as plt

# Plot the fault lines

gdf_faults.plot(color='red', linewidth=1)
plt.title('Fault Lines Visualization')
plt.show()
```

## Analyzing Fault Properties

### Length and Orientation
```python
# Calculate the length of each fault line

gdf_faults['length'] = gdf_faults.geometry.length

# Calculate the orientation of each fault line

gdf_faults['orientation'] = gdf_faults.geometry.angle
```

## Spatial Relationships
### Proximity to Urban Areas
Identify urban areas near fault lines to assess risk.
```python
# Load urban area data

gdf_urban = gpd.read_file('urban_areas.shp')

# Calculate distances to urban areas

gdf_faults['nearest_urban_distance'] = gdf_faults.geometry.distance(gdf_urban.unary_union)
```

## Conclusion

Fault line analysis is essential for understanding seismic hazards. By leveraging geospatial data, we can evaluate fault characteristics and their potential impact on surrounding areas.