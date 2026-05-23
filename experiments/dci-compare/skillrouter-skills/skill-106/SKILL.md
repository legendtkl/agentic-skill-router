---
name: skill-106
description: A comprehensive toolkit for processing various document types including text, images, and spreadsheets.
license: Proprietary. LICENSE.txt has complete terms
---

# Document Processing Utility Guide

## Overview

This utility provides broad functionality for processing and managing documents across multiple formats. Users can extract, manipulate, and convert documents, catering to a wide variety of applications in data management and analysis. It supports documents in formats such as PDF, DOCX, XLSX, images, and more. 

## Key Features
- **Extraction**: Extract text and data from different document formats.
- **Conversion**: Convert between document types, such as DOCX to PDF or PDF to CSV.
- **Manipulation**: Merge, split, or rearrange document pages or sections.
- **Validation**: Check document integrity and format compliance.

## Usage
Here’s a general example of how to use the utility to process documents:
```python
from document_processor import DocumentProcessor

doc_processor = DocumentProcessor()

# Extract text from a PDF file
text = doc_processor.extract_text("example.pdf")
print(text)

# Convert DOCX to PDF
doc_processor.convert("input.docx", "output.pdf")

# Validate document format
is_valid = doc_processor.validate_format("data_file.xlsx")
print(f"Is valid: {is_valid}")
```

## Supported Formats
The utility supports a range of document formats:
- **Text Documents**: PDF, DOCX, TXT
- **Spreadsheets**: XLSX, CSV
- **Images**: PNG, JPG

For each format, various processing functions can be applied, but it's important to note that specific functionality may vary by type.

## Conclusion
This utility serves as a powerful tool to streamline document processing tasks across various applications. For more detailed instructions, please consult the extended manual located at docs/document_processing_utility.md.