---
name: skill-028
description: "A skill for reconstructing quantum states from measurement data using quantum state tomography techniques. Use when you need to derive the density matrix of a quantum system from experimental measurements, allowing for the verification of quantum states in various quantum experiments."
---

# Quantum State Tomography

## Overview

Quantum state tomography is a process used to reconstruct the quantum state of a system based on measurement outcomes. This skill provides tools for efficiently performing quantum state tomography using available measurement data.

## Installation

```bash
uv pip install qst
```

## Quick Start

```python
import numpy as np
from qst import StateTomography

# Simulated measurement outcomes
measurement_data = np.array([[0, 1], [1, 0], [1, 1]])  # Example outcomes

# Create a StateTomography object
qst = StateTomography(measurement_data)

# Perform state reconstruction
rho_estimated = qst.reconstruct()
print(rho_estimated)
```

## Core Capabilities

### 1. Measurement Data Handling

Handle measurement data efficiently:

```python
# Load measurement results from a file
measurement_data = np.loadtxt('measurements.txt')

# Filter data based on specific criteria
filtered_data = qst.filter_data(measurement_data, threshold=0.5)
```

### 2. State Reconstruction

Reconstruct quantum states using various algorithms:

```python
# Maximum likelihood estimation
rho_ml = qst.max_likelihood()

# Linear inversion
rho_inv = qst.linear_inversion()
```

### 3. Visualization of Results

Visualize the reconstructed density matrix:

```python
import matplotlib.pyplot as plt

qst.visualize_density_matrix(rho_estimated)
plt.title('Reconstructed Density Matrix')
plt.show()
```

### 4. Performance Metrics

Evaluate performance:

```python
fidelity = qst.calculate_fidelity(rho_estimated, true_state)
print(f'Fidelity: {fidelity}')
```

## Conclusion

Quantum state tomography is essential for verifying and analyzing quantum systems. The tools provided in this skill facilitate the reconstruction of quantum states from experimental data, crucial for advancing quantum information science.