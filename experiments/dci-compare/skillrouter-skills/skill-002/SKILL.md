---
name: skill-002
description: "Advanced tools for creating, modifying, and analyzing pivot tables in Excel, enabling quick data summarization and insights."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Pivot Table Standards

### Data Source Integrity
- Ensure that the data source for pivot tables is complete and well-structured to avoid errors.
- Pivot tables should not reference cells that contain errors or are blank.

### Naming Conventions
- Use clear and descriptive names for pivot tables and their associated fields to enhance usability.

## Pivot Table Creation Techniques

### Basic Creation Steps
- Pivot tables should be created directly from well-structured data ranges.
- Example code snippet:
```python
import pandas as pd

def create_pivot_table(df):
    pivot_table = df.pivot_table(values='Sales', index='Product', columns='Region', aggfunc='sum')
    return pivot_table
```

### Advanced Modifications
- Users should be able to modify pivot tables to include calculated fields and filters as needed.
- Example code snippet:
```python
def add_calculated_field(pivot_table):
    pivot_table['Profit'] = pivot_table['Sales'] - pivot_table['Cost']
    return pivot_table
```

## Documentation and Validation Requirements

### Metadata Inclusion
- Each pivot table must include metadata specifying its source data and any calculations performed.
- Example: "Pivot Table based on Sales Data from 2023 Q1."

### Change Tracking
- Maintain a log of changes made to pivot tables to facilitate auditing and validation.