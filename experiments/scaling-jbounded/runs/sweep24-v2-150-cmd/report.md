# sweep24 v2-150-cmd

- variant: `J-bounded-v2`
- home: `.tmp-home-150`
- queries-source: `dci-compare`
- concurrency: 3
- started: 2026-05-24T08:04:14.122Z
- finished: 2026-05-24T08:08:19.751Z

## Aggregate

| n | accuracy | trigger | Σ turns | Σ duration | Σ cost | avg ctx_end | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 22/24 (91.7%) | 23/24 | 131 | 665.4s | $3.946 | 30.8K | 0 |

## Per-query

| query | expected | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-scan-calc | skill-079 | skill-079 | ✓ | 5 | 2 | 21.9s | $0.152 | 30.5K | ✓ |
| azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | 5 | 2 | 19.7s | $0.141 | 30.1K | ✓ |
| citation-check | skill-043 | skill-043 | ✓ | 5 | 2 | 21.1s | $0.137 | 29.7K | ✓ |
| court-form-filling | skill-003 | skill-003 | ✓ | 11 | 8 | 41.2s | $0.266 | 31.4K | ✓ |
| data-to-d3 | skill-037 | skill-037 | ✓ | 5 | 2 | 27.1s | $0.167 | 30.9K | ✓ |
| dialogue-parser | skill-009 | skill-router-skills | ✗ | 1 | 0 | 4.3s | $0.071 | 28.0K | ✗ |
| earthquake-plate-calculation | skill-135 | skill-135 | ✓ | 5 | 2 | 31.3s | $0.148 | 30.3K | ✓ |
| econ-detrending-correlation | skill-080 | skill-080 | ✓ | 5 | 2 | 17.6s | $0.145 | 30.3K | ✓ |
| enterprise-information-search | skill-049 | skill-049 | ✓ | 5 | 2 | 21.3s | $0.162 | 31.1K | ✓ |
| gh-repo-analytics | skill-021 | skill-046 | ✗ | 5 | 2 | 27.2s | $0.179 | 31.7K | ✓ |
| jax-computing-basics | skill-042 | skill-042 | ✓ | 5 | 2 | 18.5s | $0.150 | 30.4K | ✓ |
| lab-unit-harmonization | skill-123 | skill-123 | ✓ | 5 | 2 | 25.1s | $0.151 | 30.7K | ✓ |
| offer-letter-generator | skill-116 | skill-116 | ✓ | 5 | 2 | 17.7s | $0.137 | 29.7K | ✓ |
| pddl-tpp-planning | skill-117 | skill-117 | ✓ | 5 | 2 | 24.2s | $0.155 | 30.7K | ✓ |
| pptx-reference-formatting | skill-140 | skill-140 | ✓ | 5 | 2 | 80.0s | $0.157 | 30.9K | ✓ |
| protein-expression-analysis | skill-105 | skill-105 | ✓ | 5 | 2 | 23.5s | $0.162 | 31.3K | ✓ |
| quantum-numerical-simulation | skill-033 | skill-033 | ✓ | 6 | 3 | 24.5s | $0.170 | 31.0K | ✓ |
| reserves-at-risk-calc | skill-105 | skill-105 | ✓ | 5 | 2 | 31.2s | $0.163 | 31.3K | ✓ |
| shock-analysis-demand | skill-105 | skill-105 | ✓ | 12 | 9 | 63.5s | $0.304 | 32.8K | ✓ |
| shock-analysis-supply | skill-105 | skill-105 | ✓ | 6 | 3 | 39.2s | $0.196 | 32.4K | ✓ |
| taxonomy-tree-merge | skill-068 | skill-068 | ✓ | 5 | 2 | 18.4s | $0.151 | 30.7K | ✓ |
| video-tutorial-indexer | skill-113 | skill-113 | ✓ | 5 | 2 | 18.7s | $0.158 | 31.0K | ✓ |
| virtualhome-agent-planning | skill-117 | skill-117 | ✓ | 5 | 2 | 26.2s | $0.161 | 30.8K | ✓ |
| weighted-gdp-calc | skill-105 | skill-105 | ✓ | 5 | 2 | 22.2s | $0.163 | 31.0K | ✓ |
