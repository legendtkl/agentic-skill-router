---
name: skill-108
description: Extract images from PDF documents and save them in various formats for further processing.
license: Proprietary. LICENSE.txt has complete terms
---

# PDF Image Extractor Guide

## Overview

This skill allows users to extract images embedded within PDF documents and save them in formats such as JPEG, PNG, or TIFF. This is particularly useful for graphic designers and researchers who require high-quality visuals from PDF sources. 

## Extraction Process
The process involves reading the PDF file, identifying image objects, and exporting them as standalone image files. 

## Quick Start

```python
from pypdf import PdfReader
import os

# Function to extract images from a PDF
def extract_images_from_pdf(pdf_file, output_dir):
    reader = PdfReader(pdf_file)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    for i, page in enumerate(reader.pages):
        images = page.images
        for j, img in enumerate(images):
            with open(f"{output_dir}/image_{i+1}_{j+1}.png", "wb") as img_file:
                img_file.write(img.data)

# Extract images to output directory
extract_images_from_pdf("document.pdf", "extracted_images")
```

## Handling Different Image Formats
Support for saving images in different formats can be added:
```python
from PIL import Image

# Function to save image in different formats
def save_image(image_data, output_path, format='PNG'):
    image = Image.open(image_data)
    image.save(output_path, format)

# Usage
save_image(image_data, "output_image.jpeg", format='JPEG')
```

## Conclusion
This skill is essential for anyone looking to extract and work with images from PDF documents. For detailed functionality and advanced extraction techniques, refer to docs/pdf_image_extractor.md.