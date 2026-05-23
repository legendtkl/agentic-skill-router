---
name: skill-046
description: "Track and visualize contributions across multiple GitHub repositories to analyze team performance and engagement. Gain insights on commits, pull requests, and issue resolutions over time."
license: Proprietary. LICENSE.txt has complete terms
---

# GitHub Contribution Tracker

Monitor and visualize contribution metrics from GitHub repositories.

## Usage

```
gh contribution <command> [flags]
```

## Core Commands

```
  track:       Track contributions across repositories
  visualize:   Generate visual reports of contributions
  compare:     Compare contributions between team members
  export:      Export contribution data for analysis
```

Use `gh contribution <command> --help` for more information about a command.

---

## gh contribution track

Track contributions across repositories for a specified time period.

```
USAGE
  gh contribution track <repo> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO  Specify the repository to track contributions
  --from DATE                   Start date for tracking
  --to DATE                     End date for tracking

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh contribution track OWNER/REPO --from 2023-01-01 --to 2023-12-31

LEARN MORE
  Use 'gh contribution track --help' for more information about this command.
```

---

## gh contribution visualize

Generate visual reports of contributions.

```
USAGE
  gh contribution visualize <repo> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository for visualization
  --format FORMAT                Specify the output format (png, pdf)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh contribution visualize OWNER/REPO --format png

LEARN MORE
  Use 'gh contribution visualize --help' for more information about this command.
```

---

## gh contribution compare

Compare contributions between team members.

```
USAGE
  gh contribution compare <member1> <member2> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository for comparison

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh contribution compare memberA memberB -R OWNER/REPO

LEARN MORE
  Use 'gh contribution compare --help' for more information about this command.
```

---

## gh contribution export

Export contribution data for further analysis.

```
USAGE
  gh contribution export <repo> [flags]

FLAGS
  -R, --repo [HOST/]OWNER/REPO   Specify the repository to export contributions from
  --format FORMAT                Specify the export format (csv, json)

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh contribution export OWNER/REPO --format csv

LEARN MORE
  Use 'gh contribution export --help' for more information about this command.
```