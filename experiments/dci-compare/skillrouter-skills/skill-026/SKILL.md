---
name: skill-026
description: "A skill for generating and automating Excel spreadsheet (.xlsx) creation and modification for data analysis and reporting. Use this skill to streamline your data handling processes."
license: Proprietary. LICENSE.txt has complete terms
---

# Spreadsheet Automation

## Overview

The Spreadsheet Automation skill allows users to generate and manipulate Excel spreadsheets (.xlsx) programmatically. This is useful for tasks such as data analysis, reporting, and automating repetitive spreadsheet processes.

## Workflow Decision Tree

### Creating a New Spreadsheet
Use the "Creating a new Excel file" workflow below.

## Creating a New Excel File
To create an Excel file, you can utilize the `xlsx` library, which enables you to generate worksheets, write data, and format cells.

### Prerequisites
Make sure you have the `xlsx` library installed:
```bash
npm install xlsx
```

### Sample Code
Here’s an example of generating a new spreadsheet:
```javascript
const XLSX = require('xlsx');

// Create a new workbook
let wb = XLSX.utils.book_new();

// Add a new worksheet
let ws_data = [['Name', 'Age'], ['Alice', 30], ['Bob', 25]];
let ws = XLSX.utils.aoa_to_sheet(ws_data);
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

// Write the workbook to a file
XLSX.writeFile(wb, 'output.xlsx');
```

## Conclusion
The Spreadsheet Automation skill is a powerful tool for users looking to automate their Excel spreadsheet tasks, making data manipulation and analysis much more efficient.