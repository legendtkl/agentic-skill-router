---
name: skill-122
description: "Create high-quality visualizations of data using JAX. Supports various plotting techniques and customization options."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Guidelines

### Visualizations
- All visualizations MUST be compatible with JAX data structures.
- Ensure visual clarity and appropriateness for data types.
- Provide detailed error messages for invalid configurations.

# JAX Data Visualization

## 1. Basic Line Plot

### `line_plot(x, y, title='Line Plot', xlabel='X-axis', ylabel='Y-axis')`
**Description**: Generate a basic line plot of `y` against `x`.  
**Parameters**:
- `x` (array): Data for the x-axis.  
- `y` (array): Data for the y-axis.  
- `title` (str, optional): Title of the plot.  
- `xlabel` (str, optional): Label for the x-axis.  
- `ylabel` (str, optional): Label for the y-axis.  

**Returns**: Visualization displayed using JAX-compatible plotting library.

```python
import jax.numpy as jnp
import jax_data_visualization as jx
import matplotlib.pyplot as plt

x = jnp.array([0, 1, 2, 3, 4])
y = jnp.array([0, 1, 4, 9, 16])
jx.line_plot(x, y, title='Quadratic Growth')
```  

## 2. Scatter Plot

### `scatter_plot(x, y, title='Scatter Plot')`
**Description**: Generate a scatter plot of data points.  
**Parameters**:
- `x` (array): Data for the x-axis.  
- `y` (array): Data for the y-axis.  
- `title` (str, optional): Title of the plot.  

**Returns**: Visualization displayed using JAX-compatible plotting library.

```python
def scatter_plot(x, y, title='Scatter Plot'):
    plt.scatter(x, y)
    plt.title(title)
    plt.xlabel('X-axis')
    plt.ylabel('Y-axis')
    plt.show()

scatter_plot(x, y)
```  

## 3. Histogram Plot

### `histogram_plot(data, bins=10)`
**Description**: Generate a histogram of the data.  
**Parameters**:
- `data` (array): Data for histogram.  
- `bins` (int, optional): Number of bins in the histogram.  

**Returns**: Visualization displayed using JAX-compatible plotting library.

```python
def histogram_plot(data, bins=10):
    plt.hist(data, bins=bins)
    plt.title('Histogram')
    plt.xlabel('Value')
    plt.ylabel('Frequency')
    plt.show()

histogram_plot(jnp.array([1, 2, 2, 3, 4, 4, 4, 5]))
```  

## 4. Customization Options

### `custom_plot(x, y, style='default')`
**Description**: Generates a customizable plot based on specified style.  
**Parameters**:
- `x` (array): Data for the x-axis.
- `y` (array): Data for the y-axis.
- `style` (str, optional): Custom style for the plot.

**Returns**: Visualization displayed with custom style.

```python
def custom_plot(x, y, style='default'):
    plt.style.use(style)
    plt.plot(x, y)
    plt.title('Custom Style Plot')
    plt.xlabel('X-axis')
    plt.ylabel('Y-axis')
    plt.show()

custom_plot(x, y, style='ggplot')
```  

## 5. Save Plot

### `save_plot(filename)`
**Description**: Save the current plot to a specified file.  
**Parameters**:
- `filename` (str): Filename to save the plot as.

**Returns**: None.

```python
def save_plot(filename):
    plt.savefig(filename)

save_plot('my_plot.png')
```  

**Notes**:
- Visualizations can be saved in multiple formats (e.g., PNG, PDF).
- Ensure appropriate labeling for all axes and titles.