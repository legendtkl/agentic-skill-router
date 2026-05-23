---
name: skill-062
description: "A skill for merging multiple PDF documents into a single cohesive file, ensuring proper order and formatting. Use this skill when Claude needs to combine several PDF files into one for better management or distribution."
license: Proprietary. LICENSE.txt has complete terms
---

# PDF Merger

## Overview

The PDF Merger skill allows users to combine multiple PDF files into one document. This is particularly useful for organizations that need to consolidate reports, presentations, or any other type of documentation into a single file for distribution.

## Workflow Decision Tree

### Merging PDFs
Use the "Combining multiple PDF files" workflow below.

## Combining Multiple PDF Files
To merge PDF files, you can use the PyPDF2 library, which provides an easy-to-use interface for handling PDF files in Python.

### Prerequisites
Ensure you have the PyPDF2 library installed. If it’s not installed, you can add it using pip:
```bash
pip install PyPDF2
```

### Merging Process
Here is a step-by-step process for merging PDF files:
1. **Gather PDF Files**: Collect all the PDF files you wish to merge.
2. **Create a merger object**: Use the PdfMerger class to start the merging process.
3. **Append PDFs**: Loop through each PDF file and append it to your merger object.
4. **Write out the merged PDF**: Specify the output file name and save the merged PDF.

### Sample Code
Here is a simple example:
```python
from PyPDF2 import PdfMerger

# Initialize the PdfMerger
merger = PdfMerger()

# List of PDF files to merge
pdf_files = ['file1.pdf', 'file2.pdf', 'file3.pdf']

# Append each PDF file
for pdf in pdf_files:
    merger.append(pdf)

# Write out the merged PDF
merger.write('merged_output.pdf')
merger.close()
```

## Conclusion
This PDF Merger skill simplifies the process of combining multiple PDF documents, providing an efficient solution for users needing to consolidate their files.