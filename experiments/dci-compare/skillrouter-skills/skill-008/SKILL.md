---
name: skill-008
description: "A robust tool for cleaning, standardizing, and preparing CSV data files for analysis. Ideal for ensuring accuracy in datasets before use in reports or financial models."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General CSV File Handling

### Cleanliness Standards
- All CSV files must be delivered free of duplicate entries and with consistent formatting.
- Ensure all string values are trimmed of whitespace and standardize case (e.g., all lowercase).

### Standardization Rules
- Dates should be formatted to YYYY-MM-DD.
- Numerical values should not contain commas or currency symbols.
- Replace any missing values with "N/A" or appropriate placeholders.

## Data Cleaning Techniques

### Deduplication
- Implement algorithms to detect and remove duplicate rows based on key columns.
- Example code snippet:
```python
import pandas as pd

def remove_duplicates(file_path):
    df = pd.read_csv(file_path)
    df_cleaned = df.drop_duplicates()
    return df_cleaned
```

### Formatting Strings
- Normalize string values by removing leading or trailing whitespace and converting to lowercase before analysis.
- Example code snippet:
```python
def format_strings(df):
    df['column_name'] = df['column_name'].str.strip().str.lower()
    return df
```

### Handling Missing Data
- Replace missing values with specified placeholders or use interpolation if appropriate.
- Example code snippet:
```python
def handle_missing_data(df):
    df.fillna('N/A', inplace=True)
    return df
```

## Documentation Requirements

### Data Source Citation
- Ensure all cleaned data is accompanied by a citation of the original data source: "Source: [System/Document], [Date], [Specific Reference]."

### Change Log
- Maintain a change log documenting any alterations made during the cleaning process, including date and reason for changes.