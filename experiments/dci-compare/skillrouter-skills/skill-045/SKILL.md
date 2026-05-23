---
name: skill-045
description: Methods and tools for analyzing economic inequality across different sectors and demographics. Use to assess disparities in income, wealth, and opportunities.
---

# Economic Inequality Analysis

This skill provides insights into techniques and methodologies for analyzing economic inequality, a critical issue in socio-economic research.

## Overview

Economic inequality refers to disparities in wealth, income, and access to resources among individuals or groups. Understanding these inequalities is essential for:
- Informing policy decisions
- Understanding social dynamics
- Promoting economic equity

## Measuring Economic Inequality

Several metrics can be used to quantify economic inequality, including:
- Gini Coefficient
- Lorenz Curve
- Theil Index

### Gini Coefficient

The Gini coefficient measures income inequality within a population, ranging from 0 (perfect equality) to 1 (maximum inequality).

#### Python Implementation

```python
import numpy as np
import pandas as pd
def gini_coefficient(data):
    n = len(data)
    if n == 0:
        return 0
    index = np.arange(1, n + 1)
    return (2 * np.sum(index * np.sort(data)) / np.sum(data) - (n + 1)) / n

# Load your income data
# income_data = pd.read_csv('income_data.csv')

# Calculate Gini Coefficient
gini = gini_coefficient(income_data['income'])
print(f'Gini Coefficient: {gini}')
```

### Lorenz Curve

The Lorenz curve is a graphical representation of income distribution, showing the proportion of total income earned by cumulative percentages of the population. It helps visualize inequality.

#### Python Implementation

```python
import matplotlib.pyplot as plt

# Calculate cumulative income shares
income_data = income_data.sort_values('income')
income_data['cumulative_income'] = income_data['income'].cumsum() / income_data['income'].sum()

# Plot Lorenz Curve
plt.plot(income_data['cumulative_income'], label='Lorenz Curve')
plt.plot([0, 1], [0, 1], linestyle='--', color='red')  # Line of equality
plt.title('Lorenz Curve')
plt.xlabel('Cumulative share of population')
plt.ylabel('Cumulative share of income')
plt.legend()
plt.show()
```

## Conclusion

Analyzing economic inequality provides valuable insights into the distribution of wealth and resources. Employing various measurement techniques allows researchers and policymakers to address disparities effectively.