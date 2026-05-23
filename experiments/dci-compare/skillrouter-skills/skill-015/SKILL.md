---
name: skill-015
description: "Commit changes and push to GitHub following Spaarke git conventions"
---

# Push to GitHub

> **Category**: Operations
> **Last Updated**: January 2026

---

## Purpose

Automate the git workflow from staged changes to pull request creation. Ensures code quality checks run before commits, generates conventional commit messages, and creates well-documented PRs that link to related issues and specs.

---

## Applies When

- User wants to push code to GitHub
- Creating a pull request
- Committing completed work
- **Trigger phrases**: "push to github", "create PR", "commit and push", "ready to merge", "submit changes"

---

## Prerequisites

1. **Git configured**: `git config user.name` and `git.config user.email` set
2. **On a branch**: Should NOT be on `main` or `master` for feature work
3. **GitHub CLI (optional)**: `gh` CLI for automated PR creation

---

## Worktree Support

When working in a **git worktree** (e.g., `spaarke-wt-{project-name}`), additional sync is required:

### Architecture Understanding

```
┌─────────────────────────────────────────────────────────────┐
│  Main Repo (C:/code_files/spaarke)                          │
│  └─ LOCAL master branch ← needs explicit pull after merge   │
├─────────────────────────────────────────────────────────────┤
│  Worktree (C:/code_files/spaarke-wt-{project})              │
│  └─ feature/work branch → pushes to origin/master           │
├─────────────────────────────────────────────────────────────┤
│  GitHub (origin/master) ← "merge to master" updates this    │
└─────────────────────────────────────────────────────────────┘
```

### Worktree Detection

```
DETECT worktree:
  git rev-parse --git-common-dir

  IF output contains ".git/worktrees":
    → Working in a worktree
    → MAIN_REPO_PATH = git rev-parse --git-common-dir (parent of .git/worktrees)
    → After merge to master, MUST sync main repo
```

### Auto-Sync After Merge (MANDATORY for Worktrees)

When merging to master from a worktree, **always** sync the main repo:

```powershell
# After pushing branch:master
cd {MAIN_REPO_PATH}
git fetch origin
git pull origin master
```

This ensures the main repo's local master matches origin/master.

---

## When to Create a PR

PRs should be created **early in the project lifecycle** for visibility:

| Stage | Action | PR State |
|-------|--------|----------|
| After project artifacts created | Create feature branch | No PR yet |
| After first meaningful commit | Create draft PR | **Draft** |
| Implementation complete | Mark PR ready | **Ready for Review** |
| After code review passes | Merge to master | Merged |

### Recommended Workflow

1. **Project start** (after `/design-to-project` Phase 3):
   ```powershell
   git checkout -b feature/{project-name}
   git add projects/{project-name}/
   git commit -m "feat({scope}): initialize {project-name} project"
   git push -u origin feature/{project-name}
   ```

2. **Create draft PR** (for visibility):
   ```powershell
   gh pr create --draft --title "feat({scope}): {project-name}" --body "## Status\n- [ ] Implementation in progress"
   ```

3. **During implementation** (incremental commits):
   ```powershell
   git add .
   git commit -m "{type}({scope}): {description}"
   git push
   ```

4. **When ready for review**:
   ```powershell
   gh pr ready  # Converts draft to ready-for-review
   ```

5. **After approval** (merge to master):
   ```powershell
   gh pr merge --squash  # Or merge via GitHub UI
   ```

---

## Workflow

### Step 1: Pre-flight Checks

Before committing, verify code quality:

```
CHECK current branch:
  IF on main/master AND has changes:
    → WARN: "You're on the main branch. Create a feature branch first?"
    → SUGGEST: git checkout -b feature/{description}

CHECK for uncommitted changes:
  git status --porcelain
  IF no changes:
    → "No changes to commit. Nothing to do."
    → STOP

RUN quality checks (ask user first):
  → "Should I run linting, code review, and ADR check before committing? (recommended)"
  IF yes:
    → Execute linting on changed files:
      • TypeScript/PCF: cd src/client/pcf && npm run lint
      • C#: dotnet build --warnaserror (Roslyn analyzers)
    → Execute /code-review on changed files
    → Execute /adr-check on changed files
    → Report any issues found
    → IF lint errors OR critical issues: STOP and ask user to fix first
```

### Step 1.5: Check for Untracked Source Files (MANDATORY)

**This step prevents accidentally leaving source files uncommitted.**

```
CHECK for untracked source files:
  git status --porcelain | grep "^??" | grep -E "\.(cs|ts|tsx|ps1|js|json|md)$"

  IF untracked source files found:
    → 🚨 WARNING: Untracked source files detected!
    → List all untracked source files with paths
    → ASK: "These files are NOT staged for commit. Actions:"
      1. Add all to this commit (git add {files})
      2. Add to .gitignore (if intentionally excluded)
      3. Review each file individually
      4. Abort and investigate
    → REQUIRE explicit user decision before proceeding
    → IF user chooses to add: git add {files}
    → IF user chooses to ignore: Confirm files are truly not needed
    → DO NOT proceed to Step 2 until resolved

  IF no untracked source files:
    → Continue to Step 2

RATIONALE: Untracked source files are a common cause of "missing code after merge"
issues. This check ensures all source files are explicitly handled before push.
```

**Source file patterns to check:**
- `.cs` - C# source files
- `.ts`, `.tsx` - TypeScript/React files
- `.js` - JavaScript files
- `.ps1` - PowerShell scripts
- `.json` - Configuration files (in src/ directories)
- `.md` - Documentation (in docs/ or project directories)

### Step 2: Review Changes

```powershell
# Show what will be committed
git status

# Show diff summary
git diff --stat

# For detailed review
git diff
```

Present summary to user:
```
📋 Changes to commit:
  Modified: {N} files
  Added: {N} files  
  Deleted: {N} files

Files:
  M  src/server/api/SomeFile.cs
  A  src/client/pcf/NewComponent/index.ts
  D  src/old/deprecated.js

Proceed with commit? (y/n)
```

### Step 3: Stage Changes

```powershell
# Stage all changes (default)
git add .

# Or stage specific files if user requests
git add {specific files}
```

### Step 4: Generate Commit Message

Follow **Conventional Commits** format:

```
{type}({scope}): {description}

{body - optional}

{footer - optional}
```

#### Commit Types

| Type | When to Use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes nor adds |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Build process, dependencies, tooling |

#### Scope (Spaarke-specific)

| Scope | Area |
|-------|------|
| `api` | BFF API changes |
| `pcf` | PCF control changes |
| `plugin` | Dataverse plugin changes |
| `dataverse` | Dataverse configuration/ribbon |
| `infra` | Infrastructure/Bicep |
| `docs` | Documentation |
| `deps` | Dependency updates |

#### Generate Message

```
ANALYZE changed files to determine:
  - Primary type (feat/fix/refactor/etc.)
  - Scope (api/pcf/plugin/etc.)
  - Brief description (imperative mood, <50 chars)

PROPOSE commit message:
  "{type}({scope}): {description}"

ASK user to confirm or modify
```

**Example messages:**
- `feat(pcf): add dark mode theme selector to command bar`
- `fix(api): resolve token caching race condition`
- `refactor(dataverse): update ribbon XML for UCI compatibility`
- `docs(skills): add pr-workflow skill for git automation`

### Step 5: Commit

```powershell
git commit -m "{approved message}"
```

### Step 6: Push to Remote

```powershell
# Push current branch to origin
git push origin HEAD

# If branch doesn't exist on remote yet
git push -u origin HEAD
```

### Step 7: Create or Update Pull Request

#### First: Check for Existing PR

```powershell
# Check if PR already exists for this branch
gh pr list --head {current-branch} --state open --json number,url,title
```

```
IF PR exists:
  → "✅ PR #{number} already exists: {title}"
  → "   {PR URL}"
  → "   Changes pushed to existing PR."
  → SKIP PR creation
  → DONE

IF no PR exists:
  → "No PR found for branch '{branch}'. Create one? (y/n)"
  → IF user says no:
      → "Pushed to remote. Create PR manually when ready:"
      → "  https://github.com/spaarke-dev/spaarke/compare/{branch}?expand=1"
      → DONE
  → IF user says yes:
      → Continue to PR creation below
```

#### Create New PR: Using GitHub CLI (Preferred)

```powershell
# Check if gh is available
gh --version

# Create PR interactively
gh pr create --title "{commit message}" --body "{PR body}"

# Or with full template
gh pr create --title "{title}" --body @- << 'EOF'
## Summary
{Brief description of changes}

## Related
- Closes #{issue number} (if applicable)
- Related to: {link to spec or design doc}

## Changes
- {Change 1}
- {Change 2}

## Testing
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] ADR compliance verified

## Checklist
- [ ] Code follows Spaarke conventions
- [ ] Documentation updated (if needed)
- [ ] No secrets or sensitive data committed
EOF
```

#### Create New PR: Manual (Browser)

```
PROVIDE GitHub PR URL:
  https://github.com/spaarke-dev/spaarke/compare/{branch}?expand=1

SUGGEST PR template content for user to paste
```

### Step 8: Monitor CI Status

After pushing, the `sdap-ci.yml` workflow runs automatically.

```powershell
# Check CI status for the PR
gh pr checks

# Or watch CI progress in real-time
gh pr checks --watch
```

**CI Pipeline Jobs** (see `ci-cd` skill for details):

| Job | What It Checks | Blocking? |
|-----|----------------|-----------|
| `security-scan` | Trivy vulnerability scan | Yes |
| `build-test` | Build + unit tests | Yes |
| `code-quality` | Format, ADR tests, plugin size | Yes |
| `adr-pr-comment` | Posts ADR violations to PR | No |

```
WAIT for CI checks:
  gh pr checks --watch

IF any check fails:
  → View logs: gh run view {run-id} --log
  → Fix issues locally
  → Commit and push again
  → CI will re-run automatically

IF all checks pass:
  → Ready for review/merge
```

### Step 9: Summary

```
✅ PR Workflow Complete

Branch: {branch-name}
Commit: {short-sha} - {commit message}
PR: {PR URL or "Create manually at {URL}"}
CI Status: gh pr checks (run to verify)

Next steps:
1. Monitor CI: gh pr checks --watch
2. Fix any CI failures
3. Request reviewers (when CI green)
4. Merge when approved and CI passes
```

### Step 10: Merge to Master (When Ready)

When user requests "merge to master" or "merge and sync":

```
1. Verify CI passes:
   gh pr checks (or gh run list --branch {branch})

2. Push branch to master:
   git push origin {branch}:master

3. IF in worktree (MANDATORY):
   MAIN_REPO=$(git rev-parse --git-common-dir | sed 's|/.git/worktrees.*||')
   cd "$MAIN_REPO"
   git fetch origin
   git pull origin master
   → Report: "✅ Main repo synced to {commit-sha}"

4. Summary:
   ✅ Merged to master
   ✅ Remote origin/master updated
   ✅ Main repo local master synced (if worktree)
```

**Important**: "Merge to master" updates origin/master but does NOT automatically update the main repo's local master when working in a worktree. Step 3 ensures full sync.

---

## Conventions

### Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/{description}` | `feature/dark-mode-theme` |
| Bug fix | `fix/{description}` | `fix/token-cache-race` |
| Hotfix | `hotfix/{description}` | `hotfix/prod-auth-failure` |
| Project | `project/{project-name}` | `project/mda-darkmode-theme` |

### Commit Message Rules

- **Imperative mood**: "add feature" not "added feature"
- **No period** at end of subject line
- **Subject ≤ 50 chars**, body ≤ 72 chars per line
- **Reference issues** in footer: `Closes #123` or `Refs #456`

---

## Error Handling

| Situation | Response |
|-----------|----------|
| On main/master branch | Warn user, suggest creating feature branch |
| No changes to commit | Inform user, stop workflow |
| Code review finds critical issues | Report issues, ask user to fix before continuing |
| Push rejected (behind remote) | Suggest `git pull --rebase origin {branch}` |
| Push rejected (no upstream) | Use `git push -u origin HEAD` |
| `gh` CLI not installed | Fall back to manual PR creation with URL |
| Merge conflicts | Stop and guide user through resolution |

---

## Related Skills

- `code-review` - Run before committing to catch issues
- `adr-check` - Validate ADR compliance before committing
- `spaarke-conventions` - Naming and coding standards
- `ci-cd` - Monitor CI pipeline status and troubleshoot failures

---

## Quick Reference

```powershell
# Full workflow in commands
git status                              # Review changes
git add .                               # Stage all
git commit -m "type(scope): message"    # Commit
git push origin HEAD                    # Push
gh pr create                            # Create PR (if gh installed)
```

---

## Tips for AI

- **CRITICAL: Always run Step 1.5 (untracked source file check) before ANY commit/push**
- Untracked files have caused code loss - treat this check as mandatory, not optional
- Always show `git status` before committing so user sees what's included
- Propose a commit message based on changed files - don't just ask user to write one
- If user is on main/master, strongly recommend creating a feature branch first
- Run `/code-review` and `/adr-check` by default unless user declines
- For large changesets, suggest breaking into multiple commits
- Always provide the GitHub compare URL even if `gh` CLI creates the PR
- Include project/issue references in PR body when context is available
- After push, **always run `gh pr checks`** to show CI status
- If CI fails, use `gh run view {id} --log` to diagnose before suggesting fixes
- Never suggest merging until all CI checks pass
- Reference `ci-cd` skill for detailed troubleshooting guidance

### Worktree-Specific Tips

- **ALWAYS** detect if working in a worktree before merge operations
- After merging to master, **ALWAYS** sync the main repo's local master
- Use `git rev-parse --git-common-dir` to find the main repo path
- Report both remote AND local sync status to user
- If user says "merge to master", this means: push to origin/master AND sync main repo