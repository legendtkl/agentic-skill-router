---
name: skill-131
description: "Provides utilities for optimizing PDDL planning problems by transforming domain specifications and enhancing state representations."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

### General Guidelines

- PDDL domain files must meet optimization standards.
- Problem files must adhere to the transformations specified.
- Outputs should clearly indicate optimization metrics.

### Optimization Behavior
- Optimization processes should complete within a predefined time.
- If no optimization is possible, return an indication of failure.

---

# PDDL Optimization Utilities

## 1. Load and Transform Domain
### `load-and-transform-domain(domain_path)`

**Description**:  
Loads a PDDL domain file and applies transformations to optimize the state representation.

**Parameters**:
- `domain_path` (str): Path to the PDDL domain file.

**Returns**:
- `optimized_domain`: A transformed domain for better efficiency.

**Example**:
```python
optimized_domain = load_and_transform_domain("domain.pddl")
```

**Notes**:
- Utilizes `unified_planning.io.PDDLTransformer`.
- Throws an error if transformation fails.

## 2. Optimize Problem
### `optimize-problem(problem_path, optimized_domain)`

**Description**:
Optimizes the specified problem based on the optimized domain loaded previously.

**Parameters**:
- `problem_path` (str): Path to the PDDL problem file.
- `optimized_domain`: The transformed domain.

**Returns**:
- `optimized_problem`: An optimized problem object ready for planning.

**Example**:
```python
optimized_problem = optimize_problem("task01.pddl", optimized_domain)
```

**Notes**:
- Uses `unified_planning.shortcuts.ProblemOptimizer`.
- Returns None if no optimization is possible.

## 3. Save Optimized Problem
### `save-optimized-problem(optimized_problem, output_path)`

**Description**:
Writes the optimized problem to disk in standard PDDL format.

**Parameters**:
- `optimized_problem`: A PDDL problem that has been optimized.
- `output_path` (str): Output file path.

**Example**:
```python
save_optimized_problem(optimized_problem, "optimized_task01.pddl")
```

**Notes**:
- Uses `unified_planning.io.PDDLWriter` for output.
- Outputs a text file with optimized specifications.

## 4. Validate Optimization
### `validate-optimization(optimized_problem)`

**Description**:
Validates that the optimizations applied to the problem are effective and correct.

**Parameters**:
- `optimized_problem`: The problem that has undergone optimization.

**Returns**:
- bool: True if optimizations are valid, False otherwise.

**Example**:
```python
is_valid = validate_optimization(optimized_problem)
```

**Notes**:
- Uses `unified_planning.shortcuts.OptimizationValidator`.
- Ensures that optimized goals are reachable and valid.

# Example Workflow
```python
# Load and transform domain
optimized_domain = load_and_transform_domain("domain.pddl")

# Optimize problem
optimized_problem = optimize_problem("task01.pddl", optimized_domain)

# Validate optimization
if not validate_optimization(optimized_problem):
    raise ValueError("Optimized problem is invalid")

# Save optimized problem
save_optimized_problem(optimized_problem, "optimized_task01.pddl")
```
# Notes

- This skill set enhances the efficiency of PDDL planning problems through optimization.
- Designed for research in automated planning improvement.