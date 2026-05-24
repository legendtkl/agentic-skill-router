# sweep24 v3-full-cmd

- variant: `J-bounded-v3`
- home: `.tmp-home-full`
- queries-source: `paper`
- concurrency: 3
- started: 2026-05-24T10:02:23.161Z
- finished: 2026-05-24T10:13:53.461Z

## Aggregate

| n | accuracy | trigger | Σ turns | Σ duration | Σ cost | avg ctx_end | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 12/24 (50.0%) | 24/24 | 140 | 1865.5s | $5.803 | 37.4K | 0 |

## Per-query

| query | expected | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-scan-calc | gt__mesh-analysis | gt__mesh-analysis | ✓ | 5 | 2 | 52.0s | $0.154 | 30.8K | ✓ |
| azure-bgp-oscillation-route-leak | gt__azure-bgp | gt__azure-bgp | ✓ | 5 | 2 | 52.1s | $0.164 | 31.7K | ✓ |
| citation-check | gt__citation-management | data__bib-managing | ✗ | 6 | 3 | 96.3s | $0.245 | 38.1K | ✓ |
| court-form-filling | gt__pdf | other__form-filler-dkyazzentwatwa-chatgpt-skills | ✗ | 9 | 6 | 192.8s | $0.452 | 48.4K | ✓ |
| data-to-d3 | gt__d3-visualization | gt__d3-visualization | ✓ | 5 | 2 | 49.8s | $0.210 | 36.5K | ✓ |
| dialogue-parser | gt__dialogue_graph | gt__dialogue_graph | ✓ | 6 | 3 | 71.0s | $0.179 | 32.0K | ✓ |
| earthquake-plate-calculation | gt__geospatial-analysis | gt__geospatial-analysis | ✓ | 6 | 3 | 65.8s | $0.179 | 31.9K | ✓ |
| econ-detrending-correlation | gt__timeseries-detrending | gt__timeseries-detrending | ✓ | 7 | 4 | 73.0s | $0.292 | 38.0K | ✓ |
| enterprise-information-search | gt__enterprise-artifact-search | documents__herb-enterprise-context | ✗ | 6 | 3 | 75.1s | $0.244 | 38.8K | ✓ |
| gh-repo-analytics | gt__gh-cli | other__gh-activity-report-ericmjl-skills-b3b929cb | ✗ | 6 | 3 | 86.9s | $0.354 | 48.0K | ✓ |
| jax-computing-basics | gt__jax-skills | gt__jax-skills | ✓ | 5 | 2 | 59.0s | $0.202 | 35.1K | ✓ |
| lab-unit-harmonization | gt__lab-unit-harmonization | gt__lab-unit-harmonization | ✓ | 6 | 3 | 68.2s | $0.192 | 32.8K | ✓ |
| offer-letter-generator | gt__docx | docx-template-filling | ✗ | 5 | 2 | 52.0s | $0.188 | 33.7K | ✓ |
| pddl-tpp-planning | gt__pddl-skills | gt__pddl-skills | ✓ | 5 | 2 | 52.2s | $0.168 | 31.8K | ✓ |
| pptx-reference-formatting | gt__pptx | other__anthropic-pptx | ✗ | 6 | 3 | 106.1s | $0.344 | 49.3K | ✓ |
| protein-expression-analysis | gt__xlsx | other__xlsx-anthropics-skills | ✗ | 6 | 3 | 77.1s | $0.254 | 38.7K | ✓ |
| quantum-numerical-simulation | gt__qutip | gt__qutip | ✓ | 5 | 2 | 57.9s | $0.210 | 33.3K | ✓ |
| reserves-at-risk-calc | gt__xlsx | xlsx-anthropics-skills | ✗ | 6 | 3 | 104.0s | $0.396 | 52.3K | ✓ |
| shock-analysis-demand | gt__xlsx | other__xlsx-samhvw8-dot-claude | ✗ | 5 | 2 | 47.5s | $0.182 | 32.7K | ✓ |
| shock-analysis-supply | gt__xlsx | timeseries-detrending | ✗ | 8 | 5 | 143.0s | $0.276 | 35.7K | ✓ |
| taxonomy-tree-merge | gt__hierarchical-taxonomy-clustering | gt__hierarchical-taxonomy-clustering | ✓ | 5 | 2 | 51.9s | $0.205 | 35.2K | ✓ |
| video-tutorial-indexer | gt__speech-to-text | data__youtube-chapters | ✗ | 6 | 3 | 86.4s | $0.211 | 33.1K | ✓ |
| virtualhome-agent-planning | gt__pddl-skills | gt__pddl-skills | ✓ | 5 | 2 | 58.0s | $0.164 | 31.6K | ✓ |
| weighted-gdp-calc | gt__xlsx | xlsx-processing-anthropic | ✗ | 6 | 3 | 87.1s | $0.339 | 46.8K | ✓ |
