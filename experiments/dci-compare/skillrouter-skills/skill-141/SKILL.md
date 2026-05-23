---
name: skill-141
description: "Tools for managing time-based planning problems in PDDL domains, focusing on task scheduling and resource allocation."
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for Outputs

## General Guidelines

### PDDL Files
- Domain files must define actions with time constraints and resources.
- Problem files should specify deadlines for tasks.
- Schedules must follow sequential constraints.

### Scheduler Behavior
- Scheduling must complete within a specified timeout.
- If no schedule exists, return an empty schedule or an explicit failure flag.

---

# PDDL Scheduling Skills

## 1. Load Scheduling Domain and Problem
### `load-scheduling-problem(domain_path, problem_path)`

**Description**:  
Loads a PDDL domain file and problem file for scheduling tasks, creating a scheduling problem instance.

**Parameters**:
- `domain_path` (str): Path to the PDDL domain file.
- `problem_path` (str): Path to the PDDL problem file.

**Returns**:
- `scheduling_problem`: A scheduling problem object.

**Example**:
```python
scheduling_problem = load_scheduling_problem("scheduling_domain.pddl", "tasks_to_schedule.pddl")
```

**Notes**:
- Uses `unified_planning.io.PDDLReader`.
- Raises an error if parsing fails.

## 2. Generate Schedule
### `generate-schedule(scheduling_problem)`

**Description**:
Generates a schedule for the specified planning problem based on task timings and deadlines.

**Parameters**:
- `scheduling_problem`: A scheduling problem instance.

**Returns**:
- `schedule`: A list of scheduled tasks with timing.

**Example**:
```python
schedule = generate_schedule(scheduling_problem)
```

**Notes**:
- Uses `unified_planning.shortcuts.Scheduler`.
- Returns None if no schedule can be found.

## 3. Save Schedule
### `save-schedule(schedule, output_path)`

**Description**:
Writes the generated schedule to a file in a specified format suitable for scheduling applications.

**Parameters**:
- `schedule`: A list of scheduled tasks.
- `output_path` (str): Path where the schedule will be saved.

**Example**:
```python
save_schedule(schedule, "scheduled_tasks.txt")
```

**Notes**:
- Utilizes a specialized file writer for scheduling formats.

## 4. Validate Schedule
### `validate-schedule(scheduling_problem, schedule)`

**Description**:
Validates that the generated schedule meets the task requirements and deadlines specified in the problem.

**Parameters**:
- `scheduling_problem`: The scheduling problem.
- `schedule`: The generated schedule.

**Returns**:
- bool: True if the schedule is valid, False otherwise.

**Example**:
```python
is_valid = validate_schedule(scheduling_problem, schedule)
```

**Notes**:
- Uses `unified_planning.shortcuts.SchedulingValidator`.
- Ensures that task timing and resource allocation are correct.

# Example Workflow
```python
# Load scheduling problem
scheduling_problem = load_scheduling_problem("scheduling_domain.pddl", "tasks_to_schedule.pddl")

# Generate schedule
schedule = generate_schedule(scheduling_problem)

# Validate schedule
if not validate_schedule(scheduling_problem, schedule):
    raise ValueError("Generated schedule is invalid")

# Save schedule
save_schedule(schedule, "scheduled_tasks.txt")
```
# Notes

- This skill set aids in the effective scheduling of tasks within PDDL domains.
- Ideal for research in automated scheduling and resource management.