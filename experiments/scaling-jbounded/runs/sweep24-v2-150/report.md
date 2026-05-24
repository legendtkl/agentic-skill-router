# sweep24 v2-150

- variant: `J-bounded-v2`
- home: `.tmp-home-150`
- queries-source: `dci-compare`
- concurrency: 3
- started: 2026-05-24T07:55:30.987Z
- finished: 2026-05-24T07:58:29.899Z

## Aggregate

| n | accuracy | trigger | Σ turns | Σ duration | Σ cost | avg ctx_end | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 18/24 (75.0%) | 18/24 | 98 | 460.9s | $3.332 | 29.8K | 0 |

## Per-query

| query | expected | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-scan-calc | skill-079 | skill-079 | ✓ | 5 | 2 | 26.9s | $0.193 | 29.9K | ✓ |
| azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | 5 | 2 | 23.3s | $0.184 | 29.4K | ✓ |
| citation-check | skill-043 | skill-043 | ✓ | 5 | 2 | 19.9s | $0.179 | 29.1K | ✓ |
| court-form-filling | skill-003 | pdf-form-filling-court-sc100 | ✗ | 1 | 0 | 7.5s | $0.066 | 27.3K | ✗ |
| data-to-d3 | skill-037 | d3-stock-visualization | ✗ | 1 | 0 | 3.9s | $0.070 | 27.9K | ✗ |
| dialogue-parser | skill-009 | skill-creator | ✗ | 1 | 0 | 4.1s | $0.068 | 27.8K | ✗ |
| earthquake-plate-calculation | skill-135 | skill-135 | ✓ | 5 | 2 | 30.2s | $0.149 | 30.2K | ✓ |
| econ-detrending-correlation | skill-080 | skill-080 | ✓ | 5 | 2 | 30.1s | $0.143 | 30.1K | ✓ |
| enterprise-information-search | skill-049 | enterprise-data-retrieval | ✗ | 1 | 0 | 8.4s | $0.068 | 27.5K | ✗ |
| gh-repo-analytics | skill-021 | skill-router:skill-router-skills | ✗ | 1 | 0 | 6.1s | $0.069 | 27.7K | ✗ |
| jax-computing-basics | skill-042 | skill-042 | ✓ | 5 | 2 | 21.3s | $0.149 | 30.3K | ✓ |
| lab-unit-harmonization | skill-123 | skill-123 | ✓ | 5 | 2 | 17.8s | $0.145 | 30.3K | ✓ |
| offer-letter-generator | skill-116 | skill-116 | ✓ | 5 | 2 | 21.8s | $0.134 | 29.5K | ✓ |
| pddl-tpp-planning | skill-117 | skill-117 | ✓ | 5 | 2 | 25.8s | $0.158 | 30.5K | ✓ |
| pptx-reference-formatting | skill-140 | skill-140 | ✓ | 5 | 2 | 21.8s | $0.156 | 30.7K | ✓ |
| protein-expression-analysis | skill-105 | skill-105 | ✓ | 5 | 2 | 26.2s | $0.165 | 31.2K | ✓ |
| quantum-numerical-simulation | skill-033 | skill-033 | ✓ | 6 | 3 | 21.7s | $0.167 | 30.7K | ✓ |
| reserves-at-risk-calc | skill-105 | skill-105 | ✓ | 5 | 2 | 21.8s | $0.159 | 31.1K | ✓ |
| shock-analysis-demand | skill-105 | skill-105 | ✓ | 5 | 2 | 26.7s | $0.172 | 31.3K | ✓ |
| shock-analysis-supply | skill-105 | skill-105 | ✓ | 6 | 3 | 30.5s | $0.204 | 33.1K | ✓ |
| taxonomy-tree-merge | skill-068 | skill-068 | ✓ | 5 | 2 | 17.2s | $0.148 | 30.3K | ✓ |
| video-tutorial-indexer | skill-113 | mediabunny | ✗ | 1 | 0 | 4.6s | $0.070 | 27.9K | ✗ |
| virtualhome-agent-planning | skill-117 | skill-117 | ✓ | 5 | 2 | 19.2s | $0.156 | 30.6K | ✓ |
| weighted-gdp-calc | skill-105 | skill-105 | ✓ | 5 | 2 | 24.2s | $0.160 | 30.8K | ✓ |
