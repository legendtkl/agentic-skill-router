---
name: skill-146
description: "Analyze and visualize issue data from GitHub repositories to gain insights into issue trends, resolution times, and team performance. Use this skill to generate reports and dashboards for better project management."
license: Proprietary. LICENSE.txt has complete terms
---

# GitHub Issue Analytics

Leverage GitHub's issue tracking data to get actionable insights.

## Usage

```
gh-issue-analytics <command> [flags]
```

## Core Commands

```
  stats:      Generate statistics about issues
  trends:     Visualize trends in issue creation and resolution
  report:     Create comprehensive issue reports
  export:     Export issue data to CSV or JSON
  compare:    Compare issue metrics between repositories
```

Use `gh-issue-analytics <command> --help` for more information about a command.

---

## gh-issue-analytics stats

Generate statistics about issues in a repository.

```
USAGE
  gh-issue-analytics stats <flags>

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to analyze

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh-issue-analytics stats -R OWNER/REPO
  $ gh-issue-analytics stats --repo=my-repo

LEARN MORE
  Use 'gh-issue-analytics stats --help' for more information about this command.
```

---

## gh-issue-analytics trends

Visualize trends in issue creation and resolution.

```
USAGE
  gh-issue-analytics trends <flags>

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to analyze
  --from DATE                    Start date for analysis
  --to DATE                      End date for analysis

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh-issue-analytics trends -R OWNER/REPO --from 2023-01-01 --to 2023-12-31

LEARN MORE
  Use 'gh-issue-analytics trends --help' for more information about this command.
```

---

## gh-issue-analytics report

Create comprehensive reports based on issue data.

```
USAGE
  gh-issue-analytics report <flags>

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository for the report
  --format FORMAT                Specify output format (pdf, html)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh-issue-analytics report --format pdf -R OWNER/REPO

LEARN MORE
  Use 'gh-issue-analytics report --help' for more information about this command.
```

---

## gh-issue-analytics export

Export issue data to CSV or JSON format.

```
USAGE
  gh-issue-analytics export <flags>

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to export from
  --format FORMAT                Specify the export format (csv or json)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh-issue-analytics export -R OWNER/REPO --format csv

LEARN MORE
  Use 'gh-issue-analytics export --help' for more information about this command.
```

---

## gh-issue-analytics compare

Compare issue metrics between multiple repositories.

```
USAGE
  gh-issue-analytics compare <repo1> <repo2> [flags]

FLAGS
  --metric METRIC              Specify which metric to compare (e.g., open, closed)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh-issue-analytics compare OWNER/REPO1 OWNER/REPO2 --metric open

LEARN MORE
  Use 'gh-issue-analytics compare --help' for more information about this command.
```