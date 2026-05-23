---
name: skill-125
description: Convert PDF documents into structured XML format for easier data extraction and transformation.
license: Proprietary. LICENSE.txt has complete terms
---

# PDF to XML Conversion Guide

## Overview

This skill enables the conversion of PDF files into XML format, facilitating structured data extraction and manipulation. This feature is particularly useful for applications that require data processing and integration with XML-based systems. 

## Conversion Process
The conversion process involves reading a PDF document and generating an equivalent XML representation, maintaining the document's structure and contents. 

## Quick Start

```python
from pypdf import PdfReader
import xml.etree.ElementTree as ET

# Function to convert PDF to XML
def pdf_to_xml(pdf_file, xml_file):
    reader = PdfReader(pdf_file)
    root = ET.Element("document")
    for page in reader.pages:
        page_element = ET.SubElement(root, "page")
        page_element.text = page.extract_text()
    tree = ET.ElementTree(root)
    tree.write(xml_file)

# Convert PDF to XML
pdf_to_xml("input.pdf", "output.xml")
```

## Handling Complex PDF Structures
For PDFs that contain images, tables, or special formatting, additional handling may be required:
```python
# Convert PDF with special handling
from pypdf import PdfReader
from your_image_extraction_library import extract_images

def convert_complex_pdf(pdf_file, xml_file):
    reader = PdfReader(pdf_file)
    root = ET.Element("document")
    for i, page in enumerate(reader.pages):
        page_element = ET.SubElement(root, "page")
        page_element.text = page.extract_text()
        # Extract images and append to XML
        images = extract_images(page)
        for img in images:
            img_element = ET.SubElement(page_element, "image")
            img_element.text = img
    tree = ET.ElementTree(root)
    tree.write(xml_file)

# Use the function
convert_complex_pdf("complex_document.pdf", "complex_output.xml")
```

## XML Output Structure
The output XML will structure content based on pages, making it easy to query or transform. For further examples and detailed XML schema, refer to docs/pdf_to_xml.md.