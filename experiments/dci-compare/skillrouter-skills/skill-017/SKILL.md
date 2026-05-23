---
name: skill-017
description: Methods for detecting anomalies in time series data across various domains, including finance and IoT. Use when working with datasets where outlier detection is crucial.
---

# Time Series Anomaly Detection

This skill provides guidance on identifying anomalies within time series data, a critical task in fields such as finance, manufacturing, and IoT.

## Overview

Anomalies in time series can indicate critical events, fraud, or operational issues. Detecting these anomalies is vital for:
- Fraud detection in transactions
- Monitoring equipment health
- Alerting on unexpected system behavior

## Techniques for Anomaly Detection

Several methods can be utilized for detecting anomalies in time series data, including:
- Statistical methods (Z-scores, IQR)
- Machine learning models (Isolation Forest, LSTM)
- Change point detection

### Statistical Methods

#### Z-Score Method

The Z-score method involves calculating the Z-score for each data point to identify how far it is from the mean. A common threshold is a Z-score of +/- 3.

##### Python Implementation

```python
import numpy as np
import pandas as pd

# Load your time series data
# data = pd.read_csv('your_time_series.csv')

mean = np.mean(data['value'])
std_dev = np.std(data['value'])

# Calculate Z-scores
data['z_score'] = (data['value'] - mean) / std_dev

# Identify anomalies
anomalies = data[(data['z_score'] > 3) | (data['z_score'] < -3)]
print(anomalies)
```

### Machine Learning Methods

#### Isolation Forest

Isolation Forest is an effective algorithm for anomaly detection that isolates anomalies instead of profiling normal data points.

##### Python Implementation

```python
from sklearn.ensemble import IsolationForest

# Load your time series data
# data = pd.read_csv('your_time_series.csv')

model = IsolationForest(contamination=0.01)
model.fit(data[['value']])

# Predict anomalies
data['anomaly'] = model.predict(data[['value']])
# Anomalies will be labeled as -1
anomalies = data[data['anomaly'] == -1]
print(anomalies)
```

## Change Point Detection

Change point detection helps find points in time series where the statistical properties change significantly. This is useful for monitoring systems that may exhibit sudden shifts.

### Python Implementation

```python
from ruptures import Pelt
from ruptures.costs import CostL2

# Load your time series data
# data = pd.read_csv('your_time_series.csv')

algo = Pelt(CostL2()).fit(data['value'].values)
change_points = algo.predict(pen=10)
print(change_points)
```

## Conclusion

Detecting anomalies in time series is essential for various applications. The choice of method will depend on the data characteristics and the specific requirements of the task.