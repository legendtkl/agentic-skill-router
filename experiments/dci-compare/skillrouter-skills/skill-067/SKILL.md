---
name: skill-067
description: "Utilize speech synthesis techniques to generate audio narratives from PowerPoint slides. This skill focuses on converting slide text to speech for presentations."
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX Speech Synthesis

## Overview
Speech synthesis can be an effective tool for enhancing presentations by converting slide text into spoken audio. This skill details how to generate audio narratives from text in PowerPoint slides.

## Text-to-Speech Conversion
You can utilize libraries such as `gTTS` (Google Text-to-Speech) to convert slide text into audio files:

```python
from pptx import Presentation
from gtts import gTTS
import os

# Load the presentation
prs = Presentation('path-to-file.pptx')

# Extract text and convert to speech
for slide in prs.slides:
    text = ''
    for shape in slide.shapes:
        if hasattr(shape, 'text'):
            text += shape.text + '\n'

    # Create audio file
    tts = gTTS(text)
    audio_file = 'slide_audio.mp3'
    tts.save(audio_file)

    # Optionally play audio or attach it to the slide
    os.system(f'start {audio_file}')  # Adjust command for OS
```

## Conclusion
Integrating speech synthesis into your PowerPoint presentations allows for a dynamic and engaging format for delivering content, enabling accessibility and enhancing audience comprehension.