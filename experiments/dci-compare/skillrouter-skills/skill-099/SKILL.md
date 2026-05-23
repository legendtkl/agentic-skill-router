---
name: skill-099
description: A system for managing character customization options in games, such as appearance, skills, and attributes.
---

# Character Customization Skill

This skill provides a `character_customization` module to handle character appearance, skills, and attributes customization for players.

## When to use

*   **RPGs**: To create detailed character creation processes.
*   **Multiplayer Games**: To enable players to personalize their avatars.
*   **Game Development**: To streamline character customizability in various game genres.

## How to use

Import the module:
```python
from character_customization import Character, CustomizationOptions
```

### 1. The `Character` Class
The main representation of a character.
```python
character = Character(name="Hero")
```

### 2. Adding Customization Options
Define options for character customization.
```python
options = CustomizationOptions()
options.add_appearance_option("hair_color", ["red", "blue", "green"])
options.add_skill_option("combat_ability", ["swordplay", "archery"])
```

### 3. Customizing Character
Apply selected customization options to the character.
```python
character.customize(options)
```

### 4. Retrieving Character Attributes
Get the current attributes and skills of a character.
```python
attributes = character.get_attributes()  # Returns a dictionary of current attributes
```

### 5. Saving Customization
Serialize the character's customization settings.
```python
customization_data = character.save_customization()  # Returns JSON representation
```

### 6. Loading Customization
Load existing customization settings for a character.
```python
character.load_customization(customization_data)
```

## Example
```python
character = Character(name="Knight")
options = CustomizationOptions()
options.add_appearance_option("armor_type", ["plate", "leather"])
options.add_skill_option("magic_ability", ["fireball", "heal"])
character.customize(options)
```

This skill provides an interactive and flexible way for players to customize their characters, enhancing the gaming experience.