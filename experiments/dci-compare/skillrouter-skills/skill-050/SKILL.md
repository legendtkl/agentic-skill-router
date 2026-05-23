---
name: skill-050
description: "Explore advanced optimization techniques for machine learning models using JAX. Includes gradient descent variants, adaptive methods, and optimization utilities."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Guidelines

### Optimization
- All optimization routines MUST support JAX-compatible parameters and gradients.
- Ensure numerical stability and convergence for all optimization methods.
- Provide informative error messages for invalid inputs or configurations.

# JAX Optimization Techniques

## 1. Gradient Descent

### `gradient_descent(fn, init_params, learning_rate, num_steps)`
**Description**: Perform gradient descent optimization on a loss function.  
**Parameters**:
- `fn` (callable): The loss function to minimize.  
- `init_params` (array): Initial parameters for optimization.  
- `learning_rate` (float): Step size for each iteration.  
- `num_steps` (int): Number of optimization steps.  

**Returns**: Optimized parameters after the specified number of steps.

```python
import jax
import jax.numpy as jnp
from jax import grad
import jax_optimization_techniques as jx

# Define a simple quadratic loss function
def loss_fn(params):
    return jnp.sum((params - 3) ** 2)

# Perform optimization
optimized_params = jx.gradient_descent(loss_fn, jnp.array([0.0]), learning_rate=0.1, num_steps=100)
```  

## 2. Adam Optimizer

### `adam_optimizer(fn, init_params, learning_rate, num_steps)`
**Description**: Optimize a loss function using the Adam optimization algorithm.  
**Parameters**:
- `fn` (callable): The loss function to minimize.  
- `init_params` (array): Initial parameters for optimization.  
- `learning_rate` (float): Step size for each iteration.  
- `num_steps` (int): Number of optimization steps.  

**Returns**: Optimized parameters after the specified number of steps.

```python
# Initialize Adam optimizer
def adam_optimizer(fn, init_params, learning_rate=0.001, num_steps=100):
    params = init_params
    m = jax.numpy.zeros_like(params)
    v = jax.numpy.zeros_like(params)
    beta1 = 0.9
    beta2 = 0.999
    epsilon = 1e-8

    for t in range(1, num_steps + 1):
        g = grad(fn)(params)
        m = beta1 * m + (1 - beta1) * g
        v = beta2 * v + (1 - beta2) * (g ** 2)
        m_hat = m / (1 - beta1 ** t)
        v_hat = v / (1 - beta2 ** t)
        params -= learning_rate * m_hat / (jnp.sqrt(v_hat) + epsilon)
    return params

optimized_params = adam_optimizer(loss_fn, jnp.array([0.0]), learning_rate=0.01, num_steps=100)
```

## 3. Learning Rate Schedulers

### `exponential_decay(initial_lr, global_step, decay_steps, decay_rate)`
**Description**: Calculate the learning rate at a given step using exponential decay.  
**Parameters**:
- `initial_lr` (float): Initial learning rate.  
- `global_step` (int): Current training step.  
- `decay_steps` (int): Step interval for decay.  
- `decay_rate` (float): Rate of decay.  

**Returns**: Adjusted learning rate.

```python
def exponential_decay(initial_lr, global_step, decay_steps, decay_rate):
    return initial_lr * (decay_rate ** (global_step // decay_steps))

current_lr = exponential_decay(0.1, 50, 10, 0.96)
```  

## 4. Hyperparameter Tuning

### `hyperparameter_tuning(fn, param_grid)`
**Description**: Perform hyperparameter tuning to find optimal parameters for a model.  
**Parameters**:
- `fn` (callable): The model training function that takes hyperparameters as input.  
- `param_grid` (dict): Dictionary of hyperparameters and their corresponding list of values to test.  

**Returns**: Best parameters based on validation performance.

```python
from sklearn.model_selection import ParameterGrid

def tune_hyperparameters(fn, param_grid):
    best_score = float('inf')
    best_params = None
    for params in ParameterGrid(param_grid):
        score = fn(**params)
        if score < best_score:
            best_score = score
            best_params = params
    return best_params

best_params = tune_hyperparameters(train_model, {'learning_rate': [0.01, 0.1], 'batch_size': [32, 64]})
```

**Notes**:
- Ensure that the loss function and tuning parameters are well-defined.
- Use cross-validation for better evaluation of model performance.