# scaling-jbounded sweep — 3d-scan-calc

- query: `3d-scan-calc`
- gt: `gt/mesh-analysis` (dir: `gt__mesh-analysis`)
- force-included: 3 ids
- variants: J-bounded-v2, J-bounded
- scales: 1k, 5k, 20k, full

## Accuracy & cost matrix

| variant \ scale | 1k | 5k | 20k | full |
| --- | --- | --- | --- | --- |
| **J-bounded-v2** acc/turns/cost/dur/ctx | ✓ / 7T / $0.173 / 31.3s / 29.6K | ✓ / 5T / $0.143 / 29.5s / 30.1K | ✓ / 6T / $0.209 / 33.3s / 35.4K | ✓ / 8T / $0.225 / 91.5s / 37.4K |
| **J-bounded** acc/turns/cost/dur/ctx | ✓ / 4T / $0.276 / 17.7s / 30.7K | ✓ / 5T / $0.221 / 18.7s / 35.1K | ✗ / 12T / $0.482 / 256.1s / 46.8K | ✗ / 23T / $0.586 / 391.7s / 39.5K |

## Per-cell detail

| variant | scale | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-bounded | 1k | gt__mesh-analysis | ✓ | 4 | 1 | 17.7s | $0.276 | 30.7K | ✓ |
| J-bounded | 5k | gt__mesh-analysis | ✓ | 5 | 2 | 18.7s | $0.221 | 35.1K | ✓ |
| J-bounded | 20k | design__build123d-rawwerks-vibecad | ✗ | 12 | 9 | 256.1s | $0.482 | 46.8K | ✓ |
| J-bounded | full | design__build123d-rawwerks-vibecad | ✗ | 23 | 18 | 391.7s | $0.586 | 39.5K | ✓ |
| J-bounded-v2 | 1k | gt__mesh-analysis | ✓ | 7 | 4 | 31.3s | $0.173 | 29.6K | ✓ |
| J-bounded-v2 | 5k | gt__mesh-analysis | ✓ | 5 | 2 | 29.5s | $0.143 | 30.1K | ✓ |
| J-bounded-v2 | 20k | gt__mesh-analysis | ✓ | 6 | 3 | 33.3s | $0.209 | 35.4K | ✓ |
| J-bounded-v2 | full | gt__mesh-analysis | ✓ | 8 | 5 | 91.5s | $0.225 | 37.4K | ✓ |

## Bash result sizes (first 3 per cell)

### J-bounded @ 1k

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 13 | 6366 | /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-1k/.claude/skills/design__beads-issue-tracking-shaneholloman-beads-59f3df10/SKILL.md.skill |

### J-bounded @ 5k

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 20 | 9436 | /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-5k/.claude/skills/design__3d-composition-visualization/SKILL.md.skill-router-disabled:desc |
| 2 | 15 | 7176 | /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-5k/.claude/skills/design__analyzing-liquidity-pools/SKILL.md.skill-router-disabled:descrip |

### J-bounded @ 20k

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 1 | 38 | (eval):1: argument list too long: grep |
| 2 | 41 | 8093 | description: "CAD modeling with build123d Python library. Use when creating 3D models, exporting to GLB/STEP/STL, or doing boolean operations (union, difference, intersection). Triggers on: CAD, 3D mo |
| 3 | 41 | 6933 | description: "Analyze DEX liquidity pools to understand TVL, trading volume, fee income, and impermanent loss risk. Compare pools across protocols (Uniswap, Curve, Balancer) and chains to identify opt |
| 4 | 11 | 2553 | description: "Extracts hidden or encoded text from GCODE files by analyzing toolpath geometry and coordinate data. This skill should be used when tasks involve decoding text from 3D printing files, re |

### J-bounded @ full

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 1 | 38 | (eval):1: argument list too long: grep |
| 2 | 1 | 490 | Command running in background with ID: bodrfaw02. Output is being written to: /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-full/tmp/cla |
| 3 | 1 | 490 | Command running in background with ID: b2k6e4qs2. Output is being written to: /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-full/tmp/cla |
| 4 | 1 | 126 | <system-reminder>Warning: the file exists but is shorter than the provided offset (1). The file has 1 lines.</system-reminder> |

### J-bounded-v2 @ 1k

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 1 | 13 | Exit code 123 |
| 2 | 2 | 190 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-1k/.claude/skills/gt__mesh-analysis/SKILL.md.skill-router-disabled |
| 3 | 2 | 190 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-1k/.claude/skills/gt__mesh-analysis/SKILL.md.skill-router-disabled |
| 4 | 12 | 423 | --- ↵ name: gt__mesh-analysis ↵ description: "Analyzes 3D mesh files (STL) to calculate geometric properties (volume, components) and extract attribute data. Use this skill to process noisy 3D scan da |

### J-bounded-v2 @ 5k

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 10 | 1806 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-5k/.claude/skills/devops__collective-intelligence-nikhilvallishayee-univer |
| 2 | 3 | 545 | gt__mesh-analysis	description: "Analyzes 3D mesh files (STL) to calculate geometric properties (volume, components) and extract attribute data. Use this skill to process noisy 3D scan data and filter  |

### J-bounded-v2 @ 20k

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 55 | 10039 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-20k/.claude/skills/design__istio/SKILL.md.skill-router-disabled ↵ /Users/b |
| 2 | 6 | 971 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-20k/.claude/skills/design__gcode-to-text-letta-ai-skills-fa019add/SKILL.md |
| 3 | 13 | 2020 | gt__mesh-analysis	description: "Analyzes 3D mesh files (STL) to calculate geometric properties (volume, components) and extract attribute data. Use this skill to process noisy 3D scan data and filter  |

### J-bounded-v2 @ full

| idx | lines | bytes | preview |
| --- | --- | --- | --- |
| 0 | 1 | 49 | Launching skill: skill-router:skill-router-skills |
| 1 | 56 | 10040 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-full/.claude/skills/design__istio/SKILL.md.skill-router-disabled ↵ /Users/ |
| 2 | 5 | 781 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-full/.claude/skills/devops__manyfold/SKILL.md.skill-router-disabled ↵ /Use |
| 3 | 7 | 1242 | devops__manyfold	description: "Self-hosted 3D model library manager for organizing, viewing, and managing 3D print files. Use when the user asks about deploying, configuring, or using Manyfold for man |
| 4 | 4 | 568 | Exit code 123 ↵ /Users/bytedance/github/skill-router/.claude/worktrees/large-skill-set/experiments/scaling-jbounded/.tmp-home-full/.claude/skills/other__unit-converter/SKILL.md.skill-router-disabled ↵ |

