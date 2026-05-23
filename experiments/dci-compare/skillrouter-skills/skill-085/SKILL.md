---
name: skill-085
description: A system for managing and tracking items within a game environment. Use this for inventory management or item interactions in gameplay.
---

# Item Tracker Skill

This skill provides an `item_tracker` module to manage items, their properties, and interactions within a game.

## When to use

*   **Inventory Systems**: To manage items a player can carry.
*   **Quest Items**: To track specific items needed for quests.
*   **Game State Management**: To ensure items have the correct state throughout gameplay.

## How to use

Import the module:
```python
from item_tracker import Item, Inventory
```

### 1. The `Inventory` Class
The main container for items.
```python
inventory = Inventory()
```

### 2. Adding Items
Define and add items to the inventory.
```python
item = Item(id="sword", name="Sword of Destiny", quantity=1, description="A powerful sword.")
inventory.add_item(item)
```

### 3. Removing Items
Remove items from the inventory.
```python
inventory.remove_item("sword", quantity=1)  # Removes one sword
```

### 4. Checking Item Existence
Verify if an item exists in the inventory.
```python
exists = inventory.has_item("sword")  # Returns True if the sword is in the inventory
```

### 5. Listing Items
Get a list of all items in the inventory.
```python
all_items = inventory.list_items()  # Returns a list of all items
```
#### 6. Saving and Loading Inventory
Serialize and deserialize inventory state.
```python
# Save to JSON
data = inventory.to_json()
# Load from JSON
inventory.from_json(data)
```

### 7. Item Interactions
Define interactions that can be performed with items.
```python
item.interact("use")  # Triggers the use action for the item
```

This skill provides a simple structure for managing items, ensuring that the state of the game's inventory reflects player actions.