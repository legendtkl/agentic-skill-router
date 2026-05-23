---
name: skill-014
description: "Extract and manage data embedded in PowerPoint presentations. This skill facilitates the retrieval of charts, tables, and other data elements from .pptx files."
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX Data Extraction

## Overview
Data embedded in PowerPoint presentations can provide valuable insights and facilitate analysis. This skill covers methods for extracting tables, charts, and other data elements from .pptx files.

## Extracting Tables
To extract tables from a PowerPoint slide, use the following method:

```python
from pptx import Presentation

# Load the presentation
prs = Presentation('path-to-file.pptx')

# Extract data from tables
for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_table:
            table = shape.table
            for row in range(len(table.rows)):
                for col in range(len(table.columns)):
                    cell = table.cell(row, col)
                    print(cell.text)
```

## Extracting Charts
Charts can also be extracted for further data analysis. The following example demonstrates how to get chart data:

```python
for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_chart:
            chart = shape.chart
            data = chart.plots[0].chart_data
            print(data)
```

## Conclusion
The ability to extract data from PowerPoint presentations can enhance your analytical capabilities and enable better decision-making based on visual data representations.