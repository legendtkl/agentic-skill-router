---
name: skill-023
description: "A skill for creating dynamic HTML reports from JSON data, allowing users to visualize data in a web format with styling and structure."
license: Proprietary. LICENSE.txt has complete terms
---

# HTML Report Generator

## Overview

The HTML Report Generator skill enables users to convert JSON data into a structured and styled HTML report. This can be helpful for creating dashboards or reports that need to be shared in a web-friendly format.

## Workflow Decision Tree

### Generating HTML Reports
Use the "Creating a new HTML report" workflow below.

## Creating a New HTML Report
To generate an HTML report, you can use a simple templating engine like Handlebars.js to create a visually appealing report.

### Sample Code
Here is a basic example of how to create an HTML report:
```javascript
const fs = require('fs');
const Handlebars = require('handlebars');

// Sample JSON data
const data = {
  title: 'Monthly Sales Report',
  sales: [
    { product: 'Widget A', amount: 300 },
    { product: 'Widget B', amount: 450 },
  ],
};

// HTML template
const template = `
<html>
<head><title>{{title}}</title></head>
<body>
<h1>{{title}}</h1>
<ul>
{{#each sales}}<li>{{product}}: {{amount}}</li>{{/each}}
</ul>
</body>
</html>
`;

// Compile the template
const compiledTemplate = Handlebars.compile(template);

// Generate the HTML report
const html = compiledTemplate(data);

// Write the HTML report to a file
fs.writeFileSync('report.html', html);
```

## Conclusion
The HTML Report Generator skill provides a straightforward way to visualize and present JSON data in an accessible HTML format, making it ideal for web-based reporting.