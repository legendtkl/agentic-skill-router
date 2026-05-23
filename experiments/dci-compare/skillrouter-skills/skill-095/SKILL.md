---
name: skill-095
description: "Manage deployment configurations and environments for your applications hosted on GitHub using the GitHub CLI. This skill allows you to handle different deployment versions and track deployment statuses effectively."
license: Proprietary. LICENSE.txt has complete terms
---

# GitHub Deployment CLI (gh-deploy)

Control your deployment processes directly from the command line.

## Usage

```
gh deploy <command> [flags]
```

## Core Commands

```
  create:     Create a new deployment
  status:     Check the status of a deployment
  rollback:   Rollback to a previous deployment
  list:       List all deployments for a repository
  configure:   Configure deployment environments
```

Use `gh deploy <command> --help` for more information about a command.

---

## gh deploy create

Create a new deployment for a specified branch.

```
USAGE
  gh deploy create <branch> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to deploy
  --env ENV_NAME                 Specify the deployment environment

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh deploy create main --env production
  $ gh deploy create feature-branch --env staging

LEARN MORE
  Use 'gh deploy create --help' for more information about this command.
```

---

## gh deploy status

Check the status of a deployment.

```
USAGE
  gh deploy status <deployment_id> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to check

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh deploy status 123
  $ gh deploy status --repo OWNER/REPO 456

LEARN MORE
  Use 'gh deploy status --help' for more information about this command.
```

---

## gh deploy rollback

Rollback to a previous deployment.

```
USAGE
  gh deploy rollback <deployment_id> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to roll back

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh deploy rollback 123
  $ gh deploy rollback --repo OWNER/REPO 456

LEARN MORE
  Use 'gh deploy rollback --help' for more information about this command.
```

---

## gh deploy list

List all deployments for a repository.

```
USAGE
  gh deploy list [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to list deployments

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh deploy list -R OWNER/REPO

LEARN MORE
  Use 'gh deploy list --help' for more information about this command.
```

---

## gh deploy configure

Configure deployment environments and settings.

```
USAGE
  gh deploy configure <env_name> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to configure

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh deploy configure production -R OWNER/REPO

LEARN MORE
  Use 'gh deploy configure --help' for more information about this command.
```