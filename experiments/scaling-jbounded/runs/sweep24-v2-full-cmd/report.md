# sweep24 v2-full-cmd

- variant: `J-bounded-v2`
- home: `.tmp-home-full`
- queries-source: `paper`
- concurrency: 3
- started: 2026-05-24T08:11:51.031Z
- finished: 2026-05-24T08:21:20.445Z

## Aggregate

| n | accuracy | trigger | Σ turns | Σ duration | Σ cost | avg ctx_end | timeouts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 12/24 (50.0%) | 23/24 | 140 | 1577.2s | $5.329 | 36.6K | 0 |

## Per-query

| query | expected | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-scan-calc | gt__mesh-analysis | gt__mesh-analysis | ✓ | 9 | 6 | 138.5s | $0.297 | 37.9K | ✓ |
| azure-bgp-oscillation-route-leak | gt__azure-bgp | gt__azure-bgp | ✓ | 5 | 2 | 43.7s | $0.160 | 32.7K | ✓ |
| citation-check | gt__citation-management | bib-managing | ✗ | 6 | 3 | 81.7s | $0.248 | 40.2K | ✓ |
| court-form-filling | gt__pdf | documents__filling-pdf-forms | ✗ | 6 | 3 | 66.4s | $0.246 | 40.4K | ✓ |
| data-to-d3 | gt__d3-visualization | design__d3-layouts-hierarchies-zacharyr0th-next-starter | ✗ | 8 | 5 | 100.5s | $0.300 | 37.3K | ✓ |
| dialogue-parser | gt__dialogue_graph | gt__dialogue_graph | ✓ | 7 | 4 | 85.5s | $0.276 | 41.3K | ✓ |
| earthquake-plate-calculation | gt__geospatial-analysis | gt__geospatial-analysis | ✓ | 5 | 2 | 39.7s | $0.161 | 32.0K | ✓ |
| econ-detrending-correlation | gt__timeseries-detrending | gt__timeseries-detrending | ✓ | 5 | 2 | 45.9s | $0.172 | 31.9K | ✓ |
| enterprise-information-search | gt__enterprise-artifact-search | gt__enterprise-artifact-search | ✓ | 6 | 3 | 89.8s | $0.203 | 35.7K | ✓ |
| gh-repo-analytics | gt__gh-cli | development__github-insights | ✗ | 7 | 4 | 74.2s | $0.229 | 34.1K | ✓ |
| jax-computing-basics | gt__jax-skills | gt__jax-skills | ✓ | 5 | 2 | 41.0s | $0.179 | 34.4K | ✓ |
| lab-unit-harmonization | gt__lab-unit-harmonization | gt__lab-unit-harmonization | ✓ | 5 | 2 | 50.7s | $0.187 | 35.7K | ✓ |
| offer-letter-generator | gt__docx | other__docx-template-filling | ✗ | 6 | 3 | 84.1s | $0.216 | 37.3K | ✓ |
| pddl-tpp-planning | gt__pddl-skills | gt__pddl-skills | ✓ | 5 | 2 | 42.7s | $0.159 | 31.2K | ✓ |
| pptx-reference-formatting | gt__pptx | other__anthropic-pptx | ✗ | 6 | 3 | 66.4s | $0.257 | 40.6K | ✓ |
| protein-expression-analysis | gt__xlsx | other__spreadsheet | ✗ | 6 | 3 | 79.6s | $0.297 | 42.9K | ✓ |
| quantum-numerical-simulation | gt__qutip | gt__qutip | ✓ | 5 | 2 | 44.9s | $0.161 | 31.7K | ✓ |
| reserves-at-risk-calc | gt__xlsx | development__excel | ✗ | 6 | 3 | 71.8s | $0.257 | 40.8K | ✓ |
| shock-analysis-demand | gt__xlsx | other__06-office-excel | ✗ | 6 | 3 | 75.0s | $0.294 | 42.4K | ✓ |
| shock-analysis-supply | gt__xlsx | xlsx | ✗ | 1 | 0 | 4.6s | $0.074 | 28.5K | ✗ |
| taxonomy-tree-merge | gt__hierarchical-taxonomy-clustering | gt__hierarchical-taxonomy-clustering | ✓ | 7 | 4 | 52.8s | $0.255 | 39.3K | ✓ |
| video-tutorial-indexer | gt__speech-to-text | marketing__gemini-video-understanding | ✗ | 7 | 4 | 83.2s | $0.256 | 37.0K | ✓ |
| virtualhome-agent-planning | gt__pddl-skills | gt__pddl-skills | ✓ | 5 | 2 | 43.0s | $0.157 | 31.1K | ✓ |
| weighted-gdp-calc | gt__xlsx | development__excel | ✗ | 6 | 3 | 71.5s | $0.286 | 42.7K | ✓ |
