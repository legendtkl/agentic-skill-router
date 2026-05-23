---
name: skill-038
description: Manage and query chemical databases for efficient data retrieval and organization of chemical compounds.
license: Proprietary. LICENSE.txt has complete terms
---

# Chemical Database Manager Guide

## Overview

This skill empowers users to manage and query chemical databases effectively. It provides functionalities to store, retrieve, and organize data related to chemical compounds, enhancing research capabilities in chemistry. 

## Key Features
- **Database Creation**: Set up and configure a new chemical database.
- **Data Entry**: Input chemical compounds and their properties into the database.
- **Querying**: Perform complex queries to retrieve specific information based on various criteria (e.g., molecular weight, boiling point).

## Quick Start

### Creating a Database
```python
from chemical_db_manager import ChemicalDatabase

# Initialize a new chemical database
db = ChemicalDatabase("my_chemical_db")

# Create the database structure
db.create_structure()
```

### Inserting Data
To add new compounds into the database:
```python
compound_data = {
    "name": "Acetic Acid",
    "formula": "C2H4O2",
    "molecular_weight": 60.05,
    "boiling_point": 118.1
}

db.insert_compound(compound_data)
```

### Querying Data
Retrieve compounds based on specific criteria:
```python
results = db.query_compounds(molecular_weight=60)
for compound in results:
    print(f"Compound: {compound['name']}, Formula: {compound['formula']}")
```

## Advanced Features
- **Data Export**: Export the database to various formats such as CSV or JSON for analysis.
- **Data Analysis**: Integrate with analytical tools for deeper insights into chemical properties and relationships.

For in-depth documentation on querying and data management, visit docs/chemical_database_manager.md.