# Codex Routing-Only Bench (4 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-24T03:02:57.918Z
- **Finished**: 2026-05-24T03:34:01.802Z
- **Variants**: G-native (native), C-lite (router), I-meta (router), J-bounded (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, court-form-filling, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, gh-repo-analytics, jax-computing-basics, lab-unit-harmonization, offer-letter-generator, pddl-tpp-planning, pptx-reference-formatting, protein-expression-analysis, quantum-numerical-simulation, reserves-at-risk-calc, shock-analysis-demand, shock-analysis-supply, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, weighted-gdp-calc
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-native | 3d-scan-calc | skill-079 | skill-079 | ✓ | n/a | 13.0 | 0 | 1 | 19014 | 258400 | 19014 | 9088 | 82 | 67 | 0.057 |
| G-native | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | n/a | 6.3 | 0 | 1 | 19479 | 258400 | 19479 | 3456 | 121 | 106 | 0.085 |
| G-native | citation-check | skill-043 | skill-043 | ✓ | n/a | 6.6 | 0 | 1 | 19295 | 258400 | 19295 | 3456 | 83 | 68 | 0.083 |
| G-native | court-form-filling | skill-003 | skill-003 | ✓ | n/a | 6.2 | 0 | 1 | 19382 | 258400 | 19382 | 3456 | 79 | 64 | 0.084 |
| G-native | data-to-d3 | skill-037 | skill-037 | ✓ | n/a | 7.0 | 0 | 1 | 19574 | 258400 | 19574 | 3456 | 116 | 101 | 0.086 |
| G-native | dialogue-parser | skill-009 | skill-009 | ✓ | n/a | 6.0 | 0 | 1 | 19484 | 258400 | 19484 | 3456 | 76 | 61 | 0.084 |
| G-native | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | n/a | 7.0 | 0 | 1 | 19320 | 258400 | 19320 | 3456 | 126 | 111 | 0.085 |
| G-native | econ-detrending-correlation | skill-080 | skill-080 | ✓ | n/a | 7.2 | 0 | 1 | 19588 | 258400 | 19588 | 3456 | 79 | 64 | 0.085 |
| G-native | enterprise-information-search | skill-049 | skill-049 | ✓ | n/a | 8.2 | 0 | 1 | 19315 | 258400 | 19315 | 4480 | 160 | 145 | 0.081 |
| G-native | gh-repo-analytics | skill-021 | skill-021 | ✓ | n/a | 12.3 | 0 | 1 | 19494 | 258400 | 19494 | 4992 | 304 | 289 | 0.084 |
| G-native | jax-computing-basics | skill-042 | skill-042 | ✓ | n/a | 7.8 | 0 | 1 | 19302 | 258400 | 19302 | 3456 | 137 | 122 | 0.085 |
| G-native | lab-unit-harmonization | skill-123 | skill-123 | ✓ | n/a | 5.5 | 0 | 1 | 19596 | 258400 | 19596 | 3456 | 66 | 51 | 0.084 |
| G-native | offer-letter-generator | skill-116 | skill-116 | ✓ | n/a | 7.4 | 0 | 1 | 19250 | 258400 | 19250 | 4480 | 124 | 109 | 0.080 |
| G-native | pddl-tpp-planning | skill-117 | skill-117 | ✓ | n/a | 6.6 | 0 | 1 | 19489 | 258400 | 19489 | 3456 | 102 | 87 | 0.085 |
| G-native | pptx-reference-formatting | skill-140 | skill-140 | ✓ | n/a | 6.9 | 0 | 1 | 19266 | 258400 | 19266 | 9600 | 121 | 106 | 0.057 |
| G-native | protein-expression-analysis | skill-105 | skill-105 | ✓ | n/a | 6.7 | 0 | 1 | 19524 | 258400 | 19524 | 3456 | 101 | 86 | 0.085 |
| G-native | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | n/a | 10.4 | 0 | 1 | 19593 | 258400 | 19593 | 18816 | 108 | 93 | 0.017 |
| G-native | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | n/a | 7.0 | 0 | 1 | 19551 | 258400 | 19551 | 3456 | 122 | 107 | 0.086 |
| G-native | shock-analysis-demand | skill-105 | skill-105 | ✓ | n/a | 12.4 | 0 | 1 | 19555 | 258400 | 19555 | 4992 | 320 | 305 | 0.085 |
| G-native | shock-analysis-supply | skill-105 | skill-105 | ✓ | n/a | 8.2 | 0 | 1 | 19819 | 258400 | 19819 | 3456 | 201 | 186 | 0.090 |
| G-native | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | n/a | 5.8 | 0 | 1 | 19565 | 258400 | 19565 | 18816 | 79 | 64 | 0.016 |
| G-native | video-tutorial-indexer | skill-113 | skill-113 | ✓ | n/a | 6.2 | 0 | 1 | 19559 | 258400 | 19559 | 4992 | 83 | 68 | 0.078 |
| G-native | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | n/a | 8.3 | 0 | 1 | 19524 | 258400 | 19524 | 4992 | 103 | 88 | 0.078 |
| G-native | weighted-gdp-calc | skill-105 | skill-105 | ✓ | n/a | 6.5 | 0 | 1 | 19402 | 258400 | 19402 | 4992 | 92 | 77 | 0.077 |
| C-lite | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 40.0 | 9 | 1 | 19109 | 258400 | 85393 | 58752 | 1242 | 260 | 0.200 |
| C-lite | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 21.0 | 3 | 1 | 16832 | 258400 | 64278 | 40448 | 604 | 216 | 0.157 |
| C-lite | citation-check | skill-043 | skill-043 | ✓ | ✓ | 20.4 | 4 | 1 | 16625 | 258400 | 79477 | 59264 | 466 | 156 | 0.145 |
| C-lite | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 29.1 | 4 | 1 | 18251 | 258400 | 83293 | 67456 | 718 | 271 | 0.134 |
| C-lite | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 27.3 | 5 | 1 | 20425 | 258400 | 69641 | 57856 | 871 | 290 | 0.114 |
| C-lite | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 36.6 | 12 | 1 | 20974 | 258400 | 90500 | 59776 | 1448 | 180 | 0.227 |
| C-lite | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 26.9 | 6 | 1 | 17323 | 258400 | 97253 | 72448 | 593 | 135 | 0.178 |
| C-lite | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 28.9 | 8 | 1 | 18491 | 258400 | 66762 | 56832 | 1006 | 155 | 0.108 |
| C-lite | enterprise-information-search | skill-087 | skill-049 | ✗ | ✓ | 23.7 | 6 | 1 | 17101 | 258400 | 96447 | 91904 | 711 | 217 | 0.090 |
| C-lite | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 23.0 | 3 | 1 | 17738 | 258400 | 65274 | 51712 | 630 | 231 | 0.113 |
| C-lite | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 27.1 | 6 | 1 | 17409 | 258400 | 81847 | 67456 | 858 | 169 | 0.131 |
| C-lite | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 22.2 | 3 | 1 | 17535 | 258400 | 65183 | 50176 | 435 | 155 | 0.113 |
| C-lite | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 48.9 | 15 | 1 | 27149 | 258400 | 165733 | 115712 | 1606 | 367 | 0.356 |
| C-lite | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 25.4 | 4 | 1 | 17754 | 258400 | 81970 | 55168 | 764 | 277 | 0.185 |
| C-lite | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 22.1 | 4 | 1 | 18435 | 258400 | 82319 | 55680 | 696 | 210 | 0.182 |
| C-lite | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 21.9 | 3 | 1 | 17852 | 258400 | 65457 | 37376 | 748 | 205 | 0.182 |
| C-lite | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 19.5 | 3 | 1 | 16942 | 258400 | 64494 | 19968 | 519 | 117 | 0.248 |
| C-lite | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 32.1 | 8 | 1 | 19038 | 258400 | 67707 | 61440 | 1041 | 204 | 0.093 |
| C-lite | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 28.1 | 7 | 1 | 18092 | 258400 | 65999 | 45056 | 1049 | 163 | 0.159 |
| C-lite | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 40.5 | 7 | 1 | 17978 | 258400 | 66518 | 57856 | 900 | 103 | 0.099 |
| C-lite | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 22.2 | 4 | 1 | 17329 | 258400 | 64959 | 57856 | 626 | 164 | 0.083 |
| C-lite | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 18.5 | 3 | 1 | 16715 | 258400 | 64289 | 56320 | 581 | 192 | 0.085 |
| C-lite | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 23.7 | 7 | 1 | 18096 | 258400 | 65628 | 60416 | 863 | 125 | 0.082 |
| C-lite | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 29.7 | 6 | 1 | 18122 | 258400 | 84142 | 70016 | 766 | 315 | 0.129 |
| I-meta | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 25.1 | 2 | 1 | 21191 | 258400 | 72116 | 25600 | 548 | 224 | 0.262 |
| I-meta | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 15.5 | 2 | 1 | 20587 | 258400 | 51295 | 23168 | 378 | 95 | 0.164 |
| I-meta | citation-check | skill-043 | skill-043 | ✓ | ✓ | 21.4 | 2 | 1 | 21131 | 258400 | 71988 | 49664 | 505 | 187 | 0.152 |
| I-meta | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 21.3 | 2 | 1 | 21316 | 258400 | 72674 | 55296 | 573 | 253 | 0.132 |
| I-meta | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 20.9 | 2 | 1 | 21437 | 258400 | 73292 | 60416 | 592 | 274 | 0.112 |
| I-meta | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 17.6 | 2 | 1 | 20652 | 258400 | 51373 | 33920 | 385 | 100 | 0.116 |
| I-meta | earthquake-plate-calculation | skill-092 | skill-135 | ✗ | ✓ | 16.4 | 2 | 1 | 20197 | 258400 | 50536 | 33920 | 416 | 204 | 0.113 |
| I-meta | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 14.1 | 2 | 1 | 20851 | 258400 | 51708 | 44160 | 267 | 61 | 0.068 |
| I-meta | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 24.6 | 2 | 1 | 21160 | 258400 | 70690 | 52736 | 583 | 259 | 0.134 |
| I-meta | gh-repo-analytics | skill-046 | skill-021 | ✗ | ✓ | 27.6 | 2 | 1 | 21287 | 258400 | 72295 | 53248 | 655 | 339 | 0.142 |
| I-meta | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 21.2 | 2 | 1 | 20858 | 258400 | 51406 | 35456 | 712 | 427 | 0.119 |
| I-meta | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 20.2 | 2 | 1 | 21393 | 258400 | 73257 | 45056 | 456 | 140 | 0.177 |
| I-meta | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 20.4 | 2 | 1 | 21004 | 258400 | 71908 | 59392 | 439 | 111 | 0.105 |
| I-meta | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 19.7 | 2 | 1 | 21361 | 258400 | 72596 | 45056 | 586 | 256 | 0.178 |
| I-meta | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 21.7 | 2 | 1 | 21143 | 258400 | 72256 | 41984 | 653 | 329 | 0.192 |
| I-meta | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 22.0 | 2 | 1 | 21394 | 258400 | 73219 | 65024 | 577 | 255 | 0.091 |
| I-meta | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 28.9 | 2 | 1 | 21412 | 258400 | 73234 | 65024 | 542 | 218 | 0.090 |
| I-meta | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 15.1 | 2 | 1 | 20493 | 258400 | 51282 | 22656 | 309 | 104 | 0.164 |
| I-meta | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 17.0 | 2 | 1 | 20852 | 258400 | 51699 | 33920 | 383 | 182 | 0.117 |
| I-meta | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 23.2 | 4 | 1 | 21670 | 258400 | 74046 | 61440 | 634 | 303 | 0.113 |
| I-meta | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 21.0 | 2 | 1 | 21347 | 258400 | 73317 | 50176 | 438 | 114 | 0.154 |
| I-meta | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 22.2 | 2 | 1 | 21064 | 258400 | 52017 | 30336 | 532 | 253 | 0.140 |
| I-meta | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 22.0 | 2 | 1 | 21450 | 258400 | 73391 | 53760 | 569 | 253 | 0.142 |
| I-meta | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 16.1 | 2 | 1 | 20574 | 258400 | 51136 | 29312 | 405 | 126 | 0.136 |
| J-bounded | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 21.3 | 2 | 1 | 16429 | 258400 | 46791 | 39552 | 394 | 199 | 0.068 |
| J-bounded | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 14.8 | 2 | 1 | 15975 | 258400 | 46639 | 33408 | 343 | 146 | 0.093 |
| J-bounded | citation-check | skill-043 | skill-043 | ✓ | ✓ | 15.1 | 2 | 1 | 16097 | 258400 | 46428 | 34944 | 443 | 169 | 0.088 |
| J-bounded | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 16.5 | 2 | 1 | 17471 | 258400 | 47964 | 34944 | 380 | 182 | 0.094 |
| J-bounded | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 15.9 | 2 | 1 | 17420 | 258400 | 48288 | 27776 | 420 | 145 | 0.129 |
| J-bounded | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 18.0 | 2 | 1 | 17041 | 258400 | 47790 | 21632 | 477 | 203 | 0.156 |
| J-bounded | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 16.6 | 2 | 1 | 16641 | 258400 | 46989 | 33408 | 413 | 136 | 0.097 |
| J-bounded | econ-detrending-correlation | skill-105 | skill-080 | ✗ | ✓ | 25.5 | 3 | 1 | 17065 | 258400 | 64604 | 38912 | 644 | 238 | 0.167 |
| J-bounded | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 14.6 | 2 | 1 | 17390 | 258400 | 47698 | 33408 | 382 | 189 | 0.100 |
| J-bounded | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 80.6 | 6 | 1 | 20646 | 258400 | 88799 | 54656 | 1414 | 726 | 0.240 |
| J-bounded | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 17.9 | 2 | 1 | 16183 | 258400 | 46541 | 43648 | 454 | 178 | 0.050 |
| J-bounded | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 23.3 | 2 | 1 | 16582 | 258400 | 47505 | 33920 | 358 | 163 | 0.096 |
| J-bounded | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 14.1 | 2 | 1 | 16885 | 258400 | 47006 | 28288 | 300 | 102 | 0.117 |
| J-bounded | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 15.9 | 2 | 1 | 16438 | 258400 | 47222 | 34432 | 475 | 280 | 0.095 |
| J-bounded | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 16.9 | 2 | 1 | 16845 | 258400 | 47188 | 39552 | 479 | 285 | 0.072 |
| J-bounded | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 16.5 | 2 | 1 | 16439 | 258400 | 47144 | 39552 | 259 | 69 | 0.066 |
| J-bounded | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 13.9 | 2 | 1 | 16608 | 258400 | 47518 | 44160 | 420 | 142 | 0.051 |
| J-bounded | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 16.2 | 2 | 1 | 16555 | 258400 | 47334 | 33920 | 381 | 107 | 0.095 |
| J-bounded | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 13.9 | 2 | 1 | 16734 | 258400 | 47585 | 34944 | 458 | 175 | 0.094 |
| J-bounded | shock-analysis-supply | skill-080 | skill-105 | ✗ | ✓ | 20.3 | 2 | 1 | 16854 | 258400 | 48299 | 44672 | 644 | 367 | 0.060 |
| J-bounded | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 16.8 | 2 | 1 | 16547 | 258400 | 47491 | 40064 | 491 | 215 | 0.072 |
| J-bounded | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 16.4 | 2 | 1 | 16671 | 258400 | 47483 | 27776 | 398 | 121 | 0.124 |
| J-bounded | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 17.3 | 2 | 1 | 16474 | 258400 | 47287 | 34944 | 474 | 201 | 0.093 |
| J-bounded | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 15.6 | 2 | 1 | 16423 | 258400 | 46949 | 33408 | 385 | 113 | 0.096 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G-native | 24/24 | n/a | 185.4 | 0 | 24 | 19456 | 19819 | 19456 | 135168 | 2985 | 2625 | 1.816 |
| C-lite | 23/24 | 24/24 | 658.5 | 140 | 24 | 18388 | 27149 | 78523 | 1426944 | 19741 | 4877 | 3.594 |
| I-meta | 22/24 | 24/24 | 495.0 | 50 | 24 | 21076 | 21670 | 64697 | 1070720 | 12137 | 5067 | 3.310 |
| J-bounded | 22/24 | 24/24 | 473.9 | 53 | 24 | 16851 | 20646 | 49773 | 865920 | 11286 | 4851 | 2.415 |

## Column definitions

- **match / exp / ok**: routed skill id vs. ground-truth, ✓/✗
- **router**: whether the router variant actually loaded `skill-router-skills/SKILL.md`; native mode is n/a.
- **dur(s)**: wall-clock duration of `codex exec`
- **tools**: count of `command_execution` items (shell calls). G-native uses no router so this is 0.
- **msgs**: count of `agent_message` items (model-emitted text turns)
- **ctx_end**: real prompt size of the FINAL internal Responses API call, read from rollout `event_msg/token_count.info.last_token_usage.input_tokens` (requires --ephemeral OFF). This is the conventional "context size at session end" comparable to Claude Code's per-turn input.
- **ctx_win**: `info.model_context_window` — the model's hard ctx limit (gpt-5.5 reports 258400).
- **cum_in**: `turn.completed.usage.input_tokens` — CUMULATIVE input tokens billed across every internal Responses API call in the agentic loop (= `info.total_token_usage.input_tokens`). Useful for cost, NOT for ctx-saturation.
- **cached**: cached input tokens (server-side prompt-cache reuse)
- **out**: output tokens (visible)
- **reason**: reasoning output tokens (high-effort thinking budget; displayed separately, not added again to $est)
- **$est**: estimated USD using gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M)

## Notes

- Completed cells: 96/96; exit failures: 0; timeouts: 0.
- Full-query run; compare against the Claude Code 9x24 table before drawing cross-host conclusions.
- Codex has no per-turn input-token breakdown like Claude Code's stream-json, so we cannot report ctx_start. The ctx_end value is the final internal Responses API call's prompt size from rollout token_count.
