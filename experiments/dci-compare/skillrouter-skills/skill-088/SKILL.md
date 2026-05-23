---
name: skill-088
description: "A comprehensive utility skill for managing various tasks on GitHub repositories using the gh CLI tool. This skill covers a wide range of functionalities, enabling users to interact with their repositories, issues, pull requests, and much more."
license: Proprietary. LICENSE.txt has complete terms
---

# GitHub CLI Utilities

Harness the power of the GitHub CLI for numerous repository management tasks.

## Usage

```
gh <utility> [command] [flags]
```

## Utility Overview

```
  repo:      Manage repositories
  issue:     Handle issues in repositories
  pr:        Work with pull requests
  user:      Manage user settings and profile
  project:   Interact with GitHub projects
  workflow:  Manage workflows
```

Use `gh <utility> --help` for more information about a specific utility.

---

### repo

Manage repositories efficiently.

```
USAGE
  gh repo <command> [flags]

CORE COMMANDS
  create:     Create a new repository
  list:       List repositories
  delete:     Delete a repository

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh repo create new-repo
  $ gh repo list

LEARN MORE
  Use 'gh repo --help' for more information about repository management.
```

---

### issue

Handle issues in repositories.

```
USAGE
  gh issue <command> [flags]

CORE COMMANDS
  create:     Create a new issue
  list:       List issues
  close:      Close an issue

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh issue create --title "Issue Title"
  $ gh issue list

LEARN MORE
  Use 'gh issue --help' for more information about issue management.
```

---

### pr

Work with pull requests in a simple manner.

```
USAGE
  gh pr <command> [flags]

CORE COMMANDS
  create:     Create a pull request
  list:       List pull requests
  merge:      Merge a pull request

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh pr create --title "Pull Request Title"
  $ gh pr list

LEARN MORE
  Use 'gh pr --help' for more information about pull requests.
```

---

### user

Manage user settings and profile information.

```
USAGE
  gh user <command> [flags]

CORE COMMANDS
  view:       View user information
  edit:       Edit user settings

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository if needed

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh user view
  $ gh user edit --name "New Name"

LEARN MORE
  Use 'gh user --help' for more information about user management.
```

---

### project

Interact with GitHub projects.

```
USAGE
  gh project <command> [flags]

CORE COMMANDS
  create:     Create a new project
  list:       List projects

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh project create --title "New Project"
  $ gh project list

LEARN MORE
  Use 'gh project --help' for more information about project management.
```

---

### workflow

Manage workflows associated with repositories.

```
USAGE
  gh workflow <command> [flags]

CORE COMMANDS
  list:       List workflows
  run:        Run a workflow

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh workflow list
  $ gh workflow run --id 123

LEARN MORE
  Use 'gh workflow --help' for more information about workflows.
```