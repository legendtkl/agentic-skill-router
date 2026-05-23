---
name: skill-103
description: "A skill for creating and manipulating PowerPoint presentations (.pptx files) using JavaScript, allowing users to add slides, images, and formatted text."
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX Slide Generator

## Overview

The PPTX Slide Generator skill enables users to programmatically create PowerPoint presentations using JavaScript. This is useful for generating dynamic presentations automatically based on input data.

## Workflow Decision Tree

### Creating a New Presentation
Use the "Creating a new PPTX presentation" workflow below.

## Creating a New PPTX Presentation
To create a new PowerPoint presentation, you will use the `PptxGenJS` library, which allows for flexible creation of slides, text, images, and tables.

### Sample Code
Here’s a simple example of how to create a PPTX presentation:
```javascript
// Import the pptxgenjs library
const PptxGenJS = require('pptxgenjs');

// Create a new presentation
let pptx = new PptxGenJS();

// Add a slide
let slide = pptx.addSlide();

// Add text to the slide
slide.addText('Hello World!', { x: 1, y: 1, fontSize: 18, color: '363636' });

// Add an image to the slide
slide.addImage({ path: 'path-to-image.png', x: 1, y: 2, w: 5, h: 2 });

// Save the presentation
pptx.writeFile({ fileName: 'Presentation.pptx' });
```

## Conclusion
The PPTX Slide Generator skill provides a straightforward way to automate the creation of PowerPoint presentations using JavaScript, making it easier to produce professional presentations quickly.