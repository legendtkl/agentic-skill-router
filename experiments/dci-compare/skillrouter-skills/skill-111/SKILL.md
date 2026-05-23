---
name: skill-111
description: "Utility for generating trajectories in PDDL domains through a set of actions and state transitions, focusing on robot navigation and control in dynamic environments."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Guidelines

### PDDL Files
- Domain files must define actions that manipulate spatial states.
- Problem files should specify start and goal states clearly.
- Trajectories must adhere to sequential action constraints.

### Planner Behavior
- Trajectory generation must complete within specified time.
- If no trajectory exists, return an empty trajectory or failure flag.

---

# PDDL Trajectory Planner

## 1. Load Domain and Problem
### `load-trajectory-problem(domain_path, problem_path)`

**Description**:  
Loads a PDDL domain and problem file specific to trajectory planning, creating a planning problem instance.

**Parameters**:
- `domain_path` (str): Path to the PDDL domain file.
- `problem_path` (str): Path to the PDDL problem file.

**Returns**:
- `trajectory_problem`: A trajectory planning problem object.

**Example**:
```python
trajectory_problem = load_trajectory_problem("domain.pddl", "navigation_task.pddl")
```

**Notes**:
- Uses unified_planning.io.PDDLReader.
- Throws an error if parsing is unsuccessful.

## 2. Generate Trajectory
### `generate-trajectory(trajectory_problem)`

**Description**:
Generates a series of actions (trajectory) for the specified planning problem.

**Parameters**:
- `trajectory_problem`: A trajectory planning problem instance.

**Returns**:
- `trajectory`: A list of sequential actions representing the trajectory.

**Example**:
```python
trajectory = generate_trajectory(trajectory_problem)
```

**Notes**:
- Utilizes `unified_planning.shortcuts.TrajectoryPlanner`.
- If no trajectory can be formed, it returns None.

## 3. Save Trajectory
### `save-trajectory(trajectory, output_path)`

**Description**:
Writes a trajectory to a file in a defined format suitable for future use.

**Parameters**:
- `trajectory`: A list of actions representing the trajectory.
- `output_path` (str): Path where the trajectory will be saved.

**Example**:
```python
save_trajectory(trajectory, "navigation_solution.trajectory")
```

**Notes**:
- Utilizes a custom file writer for trajectory formats.
- Output is a structured text file.

## 4. Validate Trajectory
### `validate-trajectory(trajectory_problem, trajectory)`

**Description**:
Validates that the generated trajectory meets the constraints and goals defined in the given problem.

**Parameters**:
- `trajectory_problem`: The trajectory planning problem.
- `trajectory`: The generated trajectory.

**Returns**:
- bool: True if trajectory is valid, False otherwise.

**Example**:
```python
is_valid = validate_trajectory(trajectory_problem, trajectory)
```

**Notes**:
- Uses `unified_planning.shortcuts.TrajectoryValidator`.
- Checks action feasibility and goal reachability.

# Example Workflow
```python
# Load the problem
trajectory_problem = load_trajectory_problem("domain.pddl", "navigation_task.pddl")

# Generate trajectory
trajectory = generate_trajectory(trajectory_problem)

# Validate trajectory
if not validate_trajectory(trajectory_problem, trajectory):
    raise ValueError("Generated trajectory is invalid")

# Save trajectory
save_trajectory(trajectory, "navigation_solution.trajectory")
```
# Notes

- This skill set is designed for effective trajectory planning in dynamic environments.
- Suitable for research in robot navigation and path optimization.