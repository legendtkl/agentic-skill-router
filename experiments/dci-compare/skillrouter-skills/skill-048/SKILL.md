---
name: skill-048
description: "A skill for performing image transformations and augmentations using JAX. Ideal for preprocessing images in machine learning workflows."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Guidelines

### Images
- All images MUST be represented as JAX-compatible arrays.
- Ensure transformations maintain image integrity and aspect ratios as needed.
- Provide clear error messages for unsupported image formats.

# JAX Image Transformations

## 1. Loading Images

### `load_image(path)`
**Description**: Load an image file and convert it to a JAX-compatible array.  
**Parameters**:
- `path` (str): File path to the image.  

**Returns**: JAX array representation of the image.

```python
import jax
import jax.numpy as jnp
import jax_image_transformations as jx
from PIL import Image

def load_image(path):
    img = Image.open(path)
    return jnp.array(img)

image_array = jx.load_image("image.jpg")
```  

## 2. Image Resizing

### `resize_image(image, new_size)`
**Description**: Resize an image to a new specified size.  
**Parameters**:
- `image` (array): Input image array.  
- `new_size` (tuple): New size as (width, height).  

**Returns**: Resized image as a JAX array.

```python
def resize_image(image, new_size):
    from jax.scipy.ndimage import zoom
    h, w, _ = image.shape
    scale_h = new_size[1] / h
    scale_w = new_size[0] / w
    return zoom(image, (scale_h, scale_w, 1))

resized_image = jx.resize_image(image_array, (128, 128))
```  

## 3. Image Rotation

### `rotate_image(image, angle)`
**Description**: Rotate an image by a specified angle in degrees.  
**Parameters**:
- `image` (array): Input image array.  
- `angle` (float): Angle in degrees to rotate the image.  

**Returns**: Rotated image as a JAX array.

```python
def rotate_image(image, angle):
    from jax.scipy.ndimage import rotate
    return rotate(image, angle, reshape=False)

rotated_image = jx.rotate_image(resized_image, 45)
```  

## 4. Image Flipping

### `flip_image(image, direction)`
**Description**: Flip an image horizontally or vertically.  
**Parameters**:
- `image` (array): Input image array.  
- `direction` (str): "horizontal" or "vertical".  

**Returns**: Flipped image as a JAX array.

```python
def flip_image(image, direction):
    if direction == "horizontal":
        return jnp.flip(image, axis=1)
    elif direction == "vertical":
        return jnp.flip(image, axis=0)
    else:
        raise ValueError("Invalid direction. Use 'horizontal' or 'vertical'.")

flipped_image = jx.flip_image(rotated_image, "horizontal")
```  

## 5. Image Normalization

### `normalize_image(image)`
**Description**: Normalize an image to the range [0, 1].  
**Parameters**:
- `image` (array): Input image array.  

**Returns**: Normalized image as a JAX array.

```python
def normalize_image(image):
    return image / 255.0

normalized_image = jx.normalize_image(flipped_image)
```  

**Notes**:
- Transformations should maintain the original channel format of the images.
- Consider using batch processing for efficiency in large datasets.