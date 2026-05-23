---
name: skill-031
description: "Integrate and manage audio files in PowerPoint presentations. This skill focuses on embedding and editing audio content within .pptx files."
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX Audio Integration

## Overview
Integrating audio into PowerPoint presentations can enhance the audience's experience. This skill provides a guide to embedding, playing, and editing audio files in .pptx presentations.

## Embedding Audio Files
To embed audio files into a PowerPoint slide, you can use the following method:

```python
from pptx import Presentation

# Load the presentation
prs = Presentation('path-to-file.pptx')

# Adding a new slide for audio
slide_layout = prs.slide_layouts[5]  # Blank layout
slide = prs.slides.add_slide(slide_layout)

# Specify the audio file
audio_path = 'path-to-audio.mp3'

# Embed audio
slide.shapes.add_media(audio_path, left=Inches(1), top=Inches(1), width=Inches(1), height=Inches(1))

# Save the presentation
prs.save('audio-integrated-presentation.pptx')
```

## Editing Audio Settings
Audio playback settings can be adjusted:
- Set the audio to play automatically or on click.
- Loop the audio for background presentations.

```python
for shape in slide.shapes:
    if shape.media_type == 'audio':
        shape.playback_options.auto_play = True
        shape.playback_options.loop = True
```

## Conclusion
Incorporating audio into your PowerPoint presentations can create a more engaging experience for your audience. By embedding and managing audio effectively, you can enhance the overall impact of your presentation.