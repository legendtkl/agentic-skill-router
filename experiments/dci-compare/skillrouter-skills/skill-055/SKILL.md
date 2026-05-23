---
name: skill-055
description: A library for rendering game scenes and environments using the same underlying technology stack. Use this for visualizing game spaces.
---

# Scene Renderer Skill

This skill provides a `scene_renderer` module to create, manipulate, and display game scenes in real-time.

## When to use

*   **Game Development**: To visualize environments during development.
*   **Level Editors**: For building and testing levels in a game.
*   **Showcasing**: To create demos or trailers for a game.

## How to use

Import the module:
```python
from scene_renderer import Scene, Entity, Camera
```

### 1. The `Scene` Class
The primary container for all entities and the camera.
```python
scene = Scene()
```

### 2. Adding Entities
Define and add objects to the scene.
```python
entity = Entity(id="tree", model="tree_model.obj", position=(10, 0, 20))
scene.add_entity(entity)
```

### 3. Setting Up the Camera
Define the camera parameters.
```python
camera = Camera(position=(0, 5, -10), look_at=(0, 0, 0))
scene.set_camera(camera)
```

### 4. Rendering the Scene
Render the current scene to the display.
```python
scene.render()  # Renders the current frame to the screen
```

### 5. Updating Entities
Update the state of entities every frame.
```python
for entity in scene.entities:
    entity.update()  # Move, rotate, or animate entities
```

### 6. Saving Scene State
Serialize the current scene to JSON format.
```python
scene_data = scene.to_json()  # Save the scene state
```

### 7. Loading a Scene
Load an existing scene from JSON.
```python
scene.from_json(scene_data)  # Load the scene state from JSON
```

This skill aims to streamline the process of rendering game scenes, enabling developers to create visually appealing environments quickly.