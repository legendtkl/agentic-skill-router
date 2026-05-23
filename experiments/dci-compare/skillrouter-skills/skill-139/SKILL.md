---
name: skill-139
description: "General techniques for numerical computing with JAX. Covers a wide range of numerical methods and operations suitable for various applications in scientific computing."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Guidelines

### Numerical Methods
- All numerical methods should be compatible with JAX arrays.
- Ensure that methods are efficient and maintain numerical accuracy.

# JAX General Numerical Computing

## 1. Basic Operations

### `add(a, b)`
**Description**: Perform element-wise addition of two arrays.  
**Parameters**:
- `a` (array): First input array.  
- `b` (array): Second input array.  

**Returns**: Array resulting from element-wise addition.

```python
import jax.numpy as jnp
import jax_general_numerical_computing as jx

a = jnp.array([1, 2, 3])
b = jnp.array([4, 5, 6])
result = jx.add(a, b)
```  

## 2. Advanced Mathematical Functions

### `sin(x)`
**Description**: Compute the sine of an array of values.  
**Parameters**:
- `x` (array): Input array.  

**Returns**: Array of sine values corresponding to the input array.

```python
x = jnp.array([0, jnp.pi/2, jnp.pi])
sine_values = jx.sin(x)
```  

## 3. Differential Equations

### `solve_ode(ode_func, y0, t)`
**Description**: Solve ordinary differential equations using a given function and initial conditions.  
**Parameters**:
- `ode_func` (callable): Function representing the ODE.  
- `y0` (array): Initial conditions.  
- `t` (array): Time points for solution.  

**Returns**: Solution to the ODE at the specified time points.

```python
from jax import scipy
def ode_func(t, y):
    return -0.5 * y

solution = jx.solve_ode(ode_func, jnp.array([1.0]), jnp.array([0, 1, 2]))
```  

## 4. Statistical Functions

### `mean(array)`
**Description**: Calculate the mean of an array.  
**Parameters**:
- `array` (array): Input array.  

**Returns**: Mean value of the input array.

```python
array = jnp.array([1, 2, 3, 4, 5])
mean_value = jx.mean(array)
```  

## 5. Matrix Operations

### `matrix_multiply(a, b)`
**Description**: Multiply two matrices using JAX.  
**Parameters**:
- `a` (array): First matrix.  
- `b` (array): Second matrix.  

**Returns**: Resulting matrix from multiplication.

```python
A = jnp.array([[1, 2], [3, 4]])
B = jnp.array([[5, 6], [7, 8]])
result_matrix = jx.matrix_multiply(A, B)
```  

**Notes**:
- This skill serves as a broad overview of numerical computing methods using JAX.
- Users are encouraged to explore specific methods and optimizations based on their applications.