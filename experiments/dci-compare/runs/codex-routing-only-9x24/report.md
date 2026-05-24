# Codex Routing-Only Bench (9 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-24T03:02:57.918Z
- **Finished**: 2026-05-24T07:06:49.436Z
- **Variants**: G-native (native), A-router (router), B-cc (router), C-lite (router), D-agentic (router), E-digest (router), H-bounded (router), I-meta (router), J-bounded (router)
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
| A-router | 3d-scan-calc | skill-043 | skill-079 | ✗ | ✓ | 33.4 | 2 | 1 | 24126 | 258400 | 53984 | 23680 | 1008 | 395 | 0.194 |
| A-router | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 26.4 | 2 | 1 | 27116 | 258400 | 57851 | 30336 | 984 | 156 | 0.182 |
| A-router | citation-check | skill-043 | skill-043 | ✓ | ✓ | 49.0 | 3 | 1 | 26748 | 258400 | 75443 | 49152 | 1405 | 346 | 0.198 |
| A-router | court-form-filling | skill-140 | skill-003 | ✗ | ✓ | 100.0 | 3 | 1 | 37588 | 258400 | 97911 | 52736 | 4384 | 342 | 0.384 |
| A-router | data-to-d3 | skill-140 | skill-037 | ✗ | ✓ | 32.3 | 2 | 1 | 20568 | 258400 | 51472 | 21632 | 1039 | 173 | 0.191 |
| A-router | dialogue-parser | skill-140 | skill-009 | ✗ | ✓ | 30.3 | 2 | 1 | 20555 | 258400 | 51259 | 30336 | 1000 | 282 | 0.150 |
| A-router | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 55.4 | 3 | 1 | 31757 | 258400 | 127876 | 94464 | 1699 | 761 | 0.265 |
| A-router | econ-detrending-correlation | skill-043 | skill-080 | ✗ | ✓ | 35.9 | 2 | 1 | 26890 | 258400 | 57979 | 44160 | 1371 | 474 | 0.132 |
| A-router | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 35.3 | 3 | 1 | 26461 | 258400 | 77287 | 59904 | 1338 | 471 | 0.157 |
| A-router | gh-repo-analytics | skill-043 | skill-021 | ✗ | ✓ | 30.0 | 2 | 1 | 23264 | 258400 | 54076 | 44160 | 1218 | 392 | 0.108 |
| A-router | jax-computing-basics | skill-043 | skill-042 | ✗ | ✓ | 22.8 | 2 | 1 | 24040 | 258400 | 54481 | 39552 | 877 | 277 | 0.121 |
| A-router | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 36.3 | 2 | 1 | 25985 | 258400 | 56948 | 40064 | 1172 | 267 | 0.140 |
| A-router | offer-letter-generator | skill-140 | skill-116 | ✗ | ✓ | 34.9 | 2 | 1 | 22761 | 258400 | 53007 | 34432 | 894 | 357 | 0.137 |
| A-router | pddl-tpp-planning | skill-140 | skill-117 | ✗ | ✓ | 29.9 | 2 | 2 | 27439 | 258400 | 58169 | 40064 | 1016 | 273 | 0.141 |
| A-router | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 25.6 | 2 | 1 | 23403 | 258400 | 53605 | 39552 | 635 | 153 | 0.109 |
| A-router | protein-expression-analysis | skill-140 | skill-105 | ✗ | ✓ | 32.0 | 2 | 1 | 26660 | 258400 | 57507 | 32896 | 1073 | 231 | 0.172 |
| A-router | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 51.3 | 4 | 1 | 28921 | 258400 | 103907 | 87424 | 1971 | 702 | 0.185 |
| A-router | reserves-at-risk-calc | skill-043 | skill-105 | ✗ | ✓ | 29.3 | 2 | 1 | 27117 | 258400 | 58015 | 33920 | 1177 | 328 | 0.173 |
| A-router | shock-analysis-demand | skill-043 | skill-105 | ✗ | ✓ | 35.9 | 2 | 1 | 20839 | 258400 | 51756 | 33920 | 1283 | 432 | 0.145 |
| A-router | shock-analysis-supply | skill-043 | skill-105 | ✗ | ✓ | 37.5 | 2 | 1 | 27274 | 258400 | 58627 | 25728 | 1385 | 330 | 0.219 |
| A-router | taxonomy-tree-merge | skill-140 | skill-068 | ✗ | ✓ | 28.2 | 2 | 1 | 26176 | 258400 | 57070 | 28800 | 1127 | 264 | 0.190 |
| A-router | video-tutorial-indexer | skill-140 | skill-113 | ✗ | ✓ | 28.9 | 2 | 1 | 27301 | 258400 | 58175 | 24704 | 1077 | 192 | 0.212 |
| A-router | virtualhome-agent-planning | skill-037 | skill-117 | ✗ | ✓ | 79.9 | 6 | 1 | 48645 | 258400 | 231750 | 191104 | 3148 | 1295 | 0.393 |
| A-router | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 45.0 | 3 | 1 | 24103 | 258400 | 75370 | 53760 | 1765 | 650 | 0.188 |
| B-cc | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 36.4 | 5 | 1 | 36657 | 258400 | 159718 | 121600 | 936 | 282 | 0.279 |
| B-cc | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 15.5 | 2 | 1 | 26574 | 258400 | 57195 | 28288 | 386 | 194 | 0.170 |
| B-cc | citation-check | skill-043 | skill-043 | ✓ | ✓ | 21.0 | 4 | 1 | 35093 | 258400 | 122499 | 80256 | 571 | 201 | 0.268 |
| B-cc | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 36.9 | 4 | 1 | 30739 | 258400 | 113885 | 92032 | 1039 | 445 | 0.186 |
| B-cc | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 127.3 | 3 | 1 | 26412 | 258400 | 80802 | 58368 | 684 | 233 | 0.162 |
| B-cc | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 21.0 | 3 | 1 | 30344 | 258400 | 84341 | 49152 | 538 | 243 | 0.217 |
| B-cc | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 16.8 | 2 | 1 | 26805 | 258400 | 57105 | 39552 | 481 | 182 | 0.122 |
| B-cc | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 24.4 | 3 | 1 | 33312 | 258400 | 64254 | 40064 | 674 | 276 | 0.161 |
| B-cc | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 21.4 | 4 | 1 | 44132 | 258400 | 130436 | 84864 | 531 | 165 | 0.286 |
| B-cc | gh-repo-analytics | skill-046 | skill-021 | ✗ | ✓ | 35.0 | 4 | 1 | 30335 | 258400 | 96457 | 76160 | 1153 | 573 | 0.174 |
| B-cc | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 26.1 | 3 | 1 | 26220 | 258400 | 79892 | 57344 | 883 | 394 | 0.168 |
| B-cc | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 38.3 | 3 | 1 | 26621 | 258400 | 81101 | 47616 | 662 | 234 | 0.211 |
| B-cc | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 29.9 | 4 | 1 | 41488 | 258400 | 129744 | 66944 | 909 | 392 | 0.375 |
| B-cc | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 21.1 | 3 | 1 | 31105 | 258400 | 85280 | 57344 | 625 | 260 | 0.187 |
| B-cc | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 33.0 | 5 | 1 | 46765 | 258400 | 146788 | 108416 | 1058 | 355 | 0.278 |
| B-cc | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 20.2 | 3 | 1 | 24714 | 258400 | 78882 | 67072 | 579 | 255 | 0.110 |
| B-cc | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 13.5 | 2 | 1 | 22439 | 258400 | 53253 | 32896 | 338 | 133 | 0.128 |
| B-cc | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 24.7 | 4 | 1 | 24648 | 258400 | 103048 | 86400 | 610 | 223 | 0.145 |
| B-cc | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 28.2 | 4 | 1 | 33776 | 258400 | 115522 | 84352 | 848 | 384 | 0.223 |
| B-cc | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 32.0 | 3 | 1 | 33653 | 258400 | 91819 | 62976 | 780 | 371 | 0.199 |
| B-cc | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 21.0 | 3 | 1 | 34630 | 258400 | 88923 | 63488 | 541 | 171 | 0.175 |
| B-cc | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 32.2 | 7 | 1 | 25147 | 258400 | 103751 | 64384 | 1106 | 290 | 0.262 |
| B-cc | virtualhome-agent-planning | skill-110 | skill-117 | ✗ | ✓ | 15.6 | 2 | 1 | 26648 | 258400 | 57380 | 25216 | 416 | 150 | 0.186 |
| B-cc | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 26.5 | 4 | 1 | 21174 | 258400 | 89366 | 65408 | 879 | 265 | 0.179 |
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
| D-agentic | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 21.6 | 2 | 1 | 18849 | 258400 | 49562 | 40064 | 472 | 173 | 0.082 |
| D-agentic | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 20.8 | 2 | 1 | 19123 | 258400 | 50139 | 28800 | 510 | 206 | 0.136 |
| D-agentic | citation-check | skill-043 | skill-043 | ✓ | ✓ | 21.2 | 3 | 1 | 19301 | 258400 | 68643 | 58368 | 578 | 255 | 0.098 |
| D-agentic | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 28.3 | 2 | 1 | 19141 | 258400 | 49997 | 39040 | 508 | 211 | 0.090 |
| D-agentic | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 20.1 | 2 | 1 | 19385 | 258400 | 50664 | 27776 | 567 | 256 | 0.145 |
| D-agentic | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 18.9 | 2 | 1 | 19163 | 258400 | 50123 | 40064 | 423 | 116 | 0.083 |
| D-agentic | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 20.8 | 2 | 1 | 18846 | 258400 | 49572 | 40064 | 472 | 170 | 0.082 |
| D-agentic | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 23.6 | 4 | 1 | 20508 | 258400 | 91081 | 68992 | 675 | 238 | 0.165 |
| D-agentic | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 18.9 | 2 | 1 | 19109 | 258400 | 49760 | 40064 | 485 | 181 | 0.083 |
| D-agentic | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 23.4 | 3 | 1 | 22450 | 258400 | 72610 | 45056 | 776 | 323 | 0.184 |
| D-agentic | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 19.9 | 2 | 1 | 18874 | 258400 | 49656 | 32384 | 582 | 281 | 0.120 |
| D-agentic | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 17.1 | 2 | 1 | 19411 | 258400 | 50643 | 23168 | 434 | 132 | 0.162 |
| D-agentic | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 22.5 | 3 | 1 | 21646 | 258400 | 70855 | 57856 | 719 | 276 | 0.115 |
| D-agentic | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 26.8 | 3 | 1 | 19378 | 258400 | 69196 | 48640 | 614 | 167 | 0.146 |
| D-agentic | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 13.7 | 2 | 1 | 18935 | 258400 | 49438 | 44160 | 343 | 62 | 0.059 |
| D-agentic | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 23.6 | 2 | 1 | 19070 | 258400 | 50252 | 40064 | 568 | 269 | 0.088 |
| D-agentic | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 22.0 | 3 | 2 | 20381 | 258400 | 71238 | 44544 | 617 | 135 | 0.174 |
| D-agentic | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 21.2 | 3 | 1 | 19558 | 258400 | 69562 | 60928 | 537 | 214 | 0.090 |
| D-agentic | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 38.3 | 3 | 1 | 20186 | 258400 | 70785 | 37376 | 644 | 191 | 0.205 |
| D-agentic | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 19.1 | 3 | 1 | 20145 | 258400 | 71403 | 55808 | 580 | 247 | 0.123 |
| D-agentic | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 20.2 | 2 | 1 | 19041 | 258400 | 50201 | 30336 | 451 | 145 | 0.128 |
| D-agentic | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 20.9 | 2 | 1 | 19054 | 258400 | 50341 | 44672 | 602 | 302 | 0.069 |
| D-agentic | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 31.2 | 3 | 1 | 21814 | 258400 | 71699 | 52736 | 537 | 209 | 0.137 |
| D-agentic | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 24.4 | 2 | 1 | 18895 | 258400 | 49750 | 34944 | 483 | 178 | 0.106 |
| E-digest | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 23.2 | 2 | 1 | 20885 | 258400 | 69782 | 38912 | 460 | 166 | 0.188 |
| E-digest | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 17.3 | 2 | 1 | 19229 | 258400 | 50046 | 34944 | 366 | 113 | 0.104 |
| E-digest | citation-check | skill-043 | skill-043 | ✓ | ✓ | 28.0 | 2 | 1 | 20807 | 258400 | 70259 | 52736 | 422 | 208 | 0.127 |
| E-digest | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 22.8 | 2 | 1 | 18816 | 258400 | 49484 | 40064 | 445 | 190 | 0.080 |
| E-digest | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 22.6 | 2 | 1 | 21142 | 258400 | 71455 | 44032 | 519 | 225 | 0.175 |
| E-digest | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 28.2 | 2 | 1 | 18957 | 258400 | 49768 | 28800 | 371 | 110 | 0.130 |
| E-digest | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 19.8 | 2 | 1 | 21003 | 258400 | 70605 | 52736 | 573 | 281 | 0.133 |
| E-digest | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 17.7 | 2 | 1 | 19210 | 258400 | 50255 | 27776 | 376 | 117 | 0.138 |
| E-digest | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 74.0 | 2 | 1 | 19115 | 258400 | 49606 | 34432 | 407 | 154 | 0.105 |
| E-digest | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 19.0 | 2 | 1 | 18978 | 258400 | 49818 | 40064 | 441 | 186 | 0.082 |
| E-digest | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 20.1 | 2 | 1 | 18666 | 258400 | 49176 | 43648 | 372 | 199 | 0.061 |
| E-digest | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 90.1 | 2 | 1 | 21303 | 258400 | 71817 | 61440 | 595 | 303 | 0.100 |
| E-digest | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 18.3 | 2 | 1 | 20746 | 258400 | 70027 | 42496 | 422 | 124 | 0.172 |
| E-digest | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 23.6 | 2 | 1 | 20995 | 258400 | 70912 | 46592 | 455 | 163 | 0.159 |
| E-digest | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 21.5 | 2 | 1 | 20866 | 258400 | 70024 | 41984 | 542 | 248 | 0.177 |
| E-digest | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 24.7 | 2 | 1 | 21243 | 258400 | 71594 | 58880 | 671 | 377 | 0.113 |
| E-digest | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 16.8 | 2 | 1 | 19553 | 258400 | 50594 | 33920 | 379 | 120 | 0.112 |
| E-digest | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 21.8 | 2 | 2 | 21035 | 258400 | 70829 | 58880 | 419 | 179 | 0.102 |
| E-digest | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 21.5 | 2 | 1 | 21201 | 258400 | 71263 | 60928 | 607 | 313 | 0.100 |
| E-digest | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 23.0 | 2 | 1 | 21339 | 258400 | 72459 | 43008 | 732 | 440 | 0.191 |
| E-digest | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 20.3 | 2 | 1 | 19552 | 258400 | 50686 | 40064 | 523 | 268 | 0.089 |
| E-digest | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 27.1 | 2 | 1 | 21104 | 258400 | 71640 | 59392 | 566 | 352 | 0.108 |
| E-digest | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 19.0 | 2 | 1 | 21104 | 258400 | 71808 | 53248 | 511 | 219 | 0.135 |
| E-digest | weighted-gdp-calc | skill-026 | skill-105 | ✗ | ✓ | 17.5 | 2 | 1 | 19249 | 258400 | 49878 | 43136 | 389 | 136 | 0.067 |
| H-bounded | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 38.2 | 5 | 1 | 22666 | 258400 | 106058 | 84736 | 900 | 236 | 0.176 |
| H-bounded | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 20.6 | 3 | 1 | 17354 | 258400 | 64393 | 49664 | 410 | 108 | 0.111 |
| H-bounded | citation-check | skill-043 | skill-043 | ✓ | ✓ | 26.5 | 6 | 1 | 18020 | 258400 | 82332 | 44416 | 764 | 282 | 0.235 |
| H-bounded | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 27.9 | 5 | 1 | 18109 | 258400 | 83252 | 67968 | 830 | 245 | 0.135 |
| H-bounded | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 29.5 | 5 | 1 | 18962 | 258400 | 103361 | 92416 | 935 | 262 | 0.129 |
| H-bounded | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 34.0 | 6 | 1 | 18917 | 258400 | 84929 | 62336 | 988 | 303 | 0.174 |
| H-bounded | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 44.3 | 11 | 1 | 19457 | 258400 | 102167 | 72448 | 1467 | 301 | 0.229 |
| H-bounded | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 22.2 | 3 | 1 | 18564 | 258400 | 67216 | 51200 | 615 | 180 | 0.124 |
| H-bounded | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 35.0 | 4 | 1 | 22126 | 258400 | 92716 | 73088 | 1191 | 660 | 0.170 |
| H-bounded | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 29.6 | 5 | 1 | 21361 | 258400 | 108434 | 95488 | 963 | 351 | 0.141 |
| H-bounded | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 26.7 | 4 | 1 | 18714 | 258400 | 85101 | 60800 | 778 | 254 | 0.175 |
| H-bounded | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 33.4 | 6 | 1 | 19861 | 258400 | 87703 | 57216 | 865 | 170 | 0.207 |
| H-bounded | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 41.5 | 6 | 1 | 31237 | 258400 | 158844 | 116352 | 983 | 257 | 0.300 |
| H-bounded | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 27.3 | 4 | 1 | 18108 | 258400 | 83286 | 65920 | 962 | 310 | 0.149 |
| H-bounded | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 36.3 | 8 | 1 | 21398 | 258400 | 124770 | 105600 | 1272 | 380 | 0.187 |
| H-bounded | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 35.0 | 5 | 1 | 18690 | 258400 | 101789 | 79616 | 848 | 186 | 0.176 |
| H-bounded | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 18.4 | 3 | 1 | 17307 | 258400 | 64721 | 27136 | 529 | 134 | 0.217 |
| H-bounded | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 33.2 | 4 | 1 | 20267 | 258400 | 85990 | 61824 | 796 | 243 | 0.176 |
| H-bounded | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 27.1 | 4 | 1 | 18698 | 258400 | 84267 | 69504 | 843 | 165 | 0.134 |
| H-bounded | shock-analysis-supply | skill-080 | skill-105 | ✗ | ✓ | 51.3 | 16 | 1 | 22371 | 258400 | 171078 | 133504 | 1709 | 632 | 0.306 |
| H-bounded | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 33.8 | 4 | 1 | 19751 | 258400 | 87804 | 67456 | 706 | 342 | 0.157 |
| H-bounded | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 32.3 | 6 | 1 | 19035 | 258400 | 85141 | 59776 | 1107 | 286 | 0.190 |
| H-bounded | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 22.4 | 4 | 1 | 18874 | 258400 | 84787 | 58752 | 610 | 238 | 0.178 |
| H-bounded | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 24.7 | 3 | 1 | 18073 | 258400 | 65761 | 38912 | 636 | 214 | 0.173 |
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
| A-router | 8/24 | 24/24 | 945.6 | 59 | 25 | 26906 | 48645 | 72230 | 1156480 | 34046 | 9543 | 4.485 |
| B-cc | 22/24 | 24/24 | 718.0 | 84 | 24 | 30810 | 46765 | 94643 | 1560192 | 17227 | 6671 | 4.853 |
| C-lite | 23/24 | 24/24 | 658.5 | 140 | 24 | 18388 | 27149 | 78523 | 1426944 | 19741 | 4877 | 3.594 |
| D-agentic | 24/24 | 24/24 | 538.6 | 59 | 25 | 19678 | 22450 | 59465 | 1035904 | 13177 | 4937 | 2.870 |
| E-digest | 23/24 | 24/24 | 637.7 | 48 | 25 | 20254 | 21339 | 62241 | 1082112 | 11563 | 5191 | 2.946 |
| H-bounded | 23/24 | 24/24 | 751.0 | 130 | 24 | 19913 | 31237 | 94413 | 1696128 | 21707 | 6739 | 4.348 |
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

- Completed cells: 216/216; exit failures: 0; timeouts: 0.
- Full-query run; compare against the Claude Code 9x24 table before drawing cross-host conclusions.
- Codex has no per-turn input-token breakdown like Claude Code's stream-json, so we cannot report ctx_start. The ctx_end value is the final internal Responses API call's prompt size from rollout token_count.
