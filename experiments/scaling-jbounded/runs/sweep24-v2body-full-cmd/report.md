# sweep24 v2body-full-cmd

- variant: `J-bounded-v2-body`
- home: `.tmp-home-full`
- queries-source: `paper`
- concurrency: 3
- started: 2026-05-24T09:41:54.390Z
- finished: 2026-05-24T09:57:21.768Z

## Aggregate

| n | accuracy | trigger | Σ turns | Σ duration | Σ cost | avg ctx_end | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 13/24 (54.2%) | 24/24 | 192 | 2601.5s | $8.146 | 45.0K | 0 |

## Per-query

| query | expected | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-scan-calc | gt__mesh-analysis | gt__mesh-analysis | ✓ | 7 | 4 | 94.8s | $0.325 | 46.8K | ✓ |
| azure-bgp-oscillation-route-leak | gt__azure-bgp | gt__azure-bgp | ✓ | 5 | 2 | 49.7s | $0.181 | 35.3K | ✓ |
| citation-check | gt__citation-management | data__bib-managing | ✗ | 7 | 4 | 114.7s | $0.373 | 53.3K | ✓ |
| court-form-filling | gt__pdf | other__pdf-processing-en-anthropic | ✗ | 17 | 14 | 353.7s | $0.586 | 52.4K | ✓ |
| data-to-d3 | gt__d3-visualization | gt__d3-visualization | ✓ | 9 | 6 | 158.8s | $0.370 | 45.9K | ✓ |
| dialogue-parser | gt__dialogue_graph | gt__dialogue_graph | ✓ | 7 | 4 | 94.2s | $0.244 | 38.6K | ✓ |
| earthquake-plate-calculation | gt__geospatial-analysis | gt__geospatial-analysis | ✓ | 5 | 2 | 59.5s | $0.184 | 35.5K | ✓ |
| econ-detrending-correlation | gt__timeseries-detrending | gt__timeseries-detrending | ✓ | 5 | 2 | 49.3s | $0.188 | 34.5K | ✓ |
| enterprise-information-search | gt__enterprise-artifact-search | documents__herb-enterprise-context | ✗ | 35 | 32 | 392.0s | $1.355 | 71.8K | ✓ |
| gh-repo-analytics | gt__gh-cli | product__repo-recap-him0-him0-claude-marketpl | ✗ | 7 | 4 | 107.7s | $0.289 | 40.5K | ✓ |
| jax-computing-basics | gt__jax-skills | gt__jax-skills | ✓ | 6 | 3 | 87.3s | $0.274 | 42.9K | ✓ |
| lab-unit-harmonization | gt__lab-unit-harmonization | gt__lab-unit-harmonization | ✓ | 7 | 4 | 67.1s | $0.290 | 44.0K | ✓ |
| offer-letter-generator | gt__docx | documents__docx-contracts | ✗ | 6 | 3 | 69.6s | $0.256 | 40.1K | ✓ |
| pddl-tpp-planning | gt__pddl-skills | gt__pddl-skills | ✓ | 5 | 2 | 47.5s | $0.183 | 35.3K | ✓ |
| pptx-reference-formatting | gt__pptx | gt__pptx | ✓ | 6 | 3 | 82.4s | $0.304 | 48.1K | ✓ |
| protein-expression-analysis | gt__xlsx | other__xlsx-anthropics-skills | ✗ | 7 | 4 | 108.6s | $0.411 | 57.3K | ✓ |
| quantum-numerical-simulation | gt__qutip | gt__qutip | ✓ | 5 | 2 | 40.8s | $0.173 | 33.6K | ✓ |
| reserves-at-risk-calc | gt__xlsx | other__xlsx-anthropics-skills | ✗ | 5 | 2 | 77.9s | $0.214 | 40.2K | ✓ |
| shock-analysis-demand | gt__xlsx | data__financial-data-template-populator | ✗ | 9 | 6 | 156.9s | $0.427 | 53.3K | ✓ |
| shock-analysis-supply | gt__xlsx | other__xlsx-anthropics-skills | ✗ | 6 | 3 | 96.8s | $0.400 | 58.2K | ✓ |
| taxonomy-tree-merge | gt__hierarchical-taxonomy-clustering | gt__hierarchical-taxonomy-clustering | ✓ | 6 | 3 | 59.8s | $0.265 | 42.7K | ✓ |
| video-tutorial-indexer | gt__speech-to-text | other__gemini-video-understanding-alex-tgk-saasquatch | ✗ | 8 | 5 | 83.0s | $0.305 | 42.7K | ✓ |
| virtualhome-agent-planning | gt__pddl-skills | gt__pddl-skills | ✓ | 6 | 3 | 70.3s | $0.211 | 36.4K | ✓ |
| weighted-gdp-calc | gt__xlsx | other__xlsx-anthropics-skills | ✗ | 6 | 3 | 79.1s | $0.338 | 50.6K | ✓ |
