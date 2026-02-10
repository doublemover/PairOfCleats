# SKYMAP

## Purpose
This document defines the recommended execution order for FUTUREROADMAP work so phases land in a dependency-safe sequence with minimal rework.

## Scope normalization
- Canonical execution phases are:
  - Phase 14
  - Phase 15
  - Phase 16
  - Phase 17
  - Phase 18
  - Phase 19
  - Phase 20
- New cross-cutting engine tracks added by SKYMAP:
  - Track IQ: Retrieval quality and intelligence loop
  - Track OP: Performance, throughput, and reliability/SLO enforcement
- `Phase 14 Augmentations` is treated as the authoritative breakdown for Phase 14.
- `WHAT IF WE DIDNT NEED SHOES` (Subphases A-E) is an optional acceleration track.
- Appendix content (`LEXI`, `HAWKTUI`, old Phase 1-6) is historical/reference material and should not be executed as separate roadmap streams.

## Phase goals (why each exists)
- Phase 14: snapshot + diff primitives (`as-of` querying, deterministic change artifacts).
- Phase 15: multi-repo federation (workspace identity, manifests, gated federated search, cache model).
- Phase 16: document ingestion + prose routing correctness (PDF/DOCX extraction, chunking, FTS-safe routing).
- Phase 17: vector-only profile (build/search contract without sparse artifacts).
- Phase 18: distribution/platform hardening (release matrix, path safety, packaging, optional Python behavior).
- Phase 19: lexicon-aware indexing/retrieval enrichment (relation filtering, boosts, chargram/ANN safety).
- Phase 20: terminal-owned TUI + supervisor architecture (protocol v2, orchestration, cancellation guarantees).
- Track IQ: intent-aware retrieval, multi-hop expansion, trust/confidence, and bundle-style result assembly.
- Track OP: deterministic SLOs, failure injection, adaptive performance policies, and release blocking reliability gates.

## Recommended execution order

### Wave 1: Snapshot and federation foundation
1. Phase 14.1.1-14.1.5
2. Phase 14.2
3. Phase 14.3
4. Phase 14.4
5. Phase 14.5
6. Phase 14.6 (only if API parity is required now)
7. Phase 15.1
8. Phase 15.2
9. Phase 15.4
10. Phase 15.3
11. Phase 15.5
12. Phase 15.6
13. Phase 15.7

Why first:
- Phase 14 + 15 establish identity, manifests, cache invalidation, and deterministic multi-repo retrieval surfaces other phases can rely on.

### Wave 2: Retrieval correctness and profile specialization
14. Phase 16.1
15. Phase 16.2
16. Phase 16.3
17. Phase 16.4
18. Phase 16.5
19. Phase 16.6
20. Phase 16.7
21. Phase 16.8
22. Phase 17.1
23. Phase 17.2
24. Phase 17.3
25. Phase 17.4 (optional stretch)

Why this order:
- Phase 16 provides correctness and routing behavior that Phase 17 depends on.
- Phase 17 then codifies strict vector-only behavior on top of stable retrieval/build contracts.

### Wave 3: Lexicon enrichment before UI orchestration
26. Phase 19.0
27. Phase 19.1
28. Phase 19.2
29. Phase 19.4
30. Phase 19.3
31. Phase 19.5

Why before Phase 20:
- If TUI/explain surfaces include lexicon signals, Phase 19 should stabilize output contracts first.

### Wave 4: Supervisor and TUI
32. Phase 20.0.2 + 20.1.1 + 20.1.2 + 20.1.3 + 20.0.7
33. Phase 20.0.3 + 20.0.4 + 20.0.5 + 20.0.6
34. Phase 20.2.1
35. Phase 20.2.2
36. Phase 20.2.3
37. Phase 20.2.4
38. Phase 20.3.1
39. Phase 20.3.2
40. Phase 20.3.3
41. Phase 20.4.1-20.4.3
42. Phase 20.5.1
43. Phase 20.5.2

Why:
- This follows the built-in dependency matrix in Phase 20 and avoids rework from protocol/dispatcher drift.

### Wave 5: Distribution hardening and release closure
44. Phase 18.1
45. Phase 18.2
46. Phase 18.3
47. Phase 18.4
48. Phase 18.5
49. Phase 18.6

Why at the end:
- Phase 18 should package and harden the final integrated system, including any TUI binaries and finalized behavior.

### Wave 6: Intelligence and operational excellence
50. Track IQ.1 query-intent policy engine (routing/ranking policy by intent class)
51. Track IQ.2 multi-hop graph expansion with bounded novelty-aware reranking
52. Track IQ.3 task-pack assembly mode (entrypoint + call chain + tests + config/docs)
53. Track IQ.4 trust/confidence scoring and explain confidence surfaces
54. Track IQ.5 retrieval quality replay suite from real-world query logs
55. Track OP.1 search/index SLO contracts (latency, success rate, determinism, cache hit-rate)
56. Track OP.2 failure-aware degradation policy and backend failover contracts
57. Track OP.3 fault injection and chaos tests for index/search/service/supervisor paths
58. Track OP.4 adaptive provider orchestration and auto-tuning with hard safety bounds
59. Track OP.5 release gates that block on quality/perf/reliability budgets

Why this wave:
- It turns the platform from “feature-complete index/search tooling” into a durable codebase intelligence engine with measurable quality and reliability guarantees.

## Optional performance acceleration track (run after Wave 2 baseline)
- Subphase A
- Subphase B
- Subphase C
- Subphase D
- Subphase E

Placement guidance:
- Start only after Phase 16/17 correctness baselines and parity tests are stable.
- Keep behind capability detection and strict JS fallback parity.
- Fold distribution concerns into Phase 18 and/or Subphase E outputs.
- Require objective perf gates before default enablement:
  - p50/p95 query latency improvement
  - build throughput improvement
  - no quality regression in replay suite

## Cross-phase gates (do not skip)
- Deterministic identity:
  - Repo/path identity, index refs, manifest hashing, and cache keys must be canonical before adding higher-level orchestration.
- Contract-first:
  - Any schema/config/explain surface change must ship with docs/contracts updates in the same phase.
- Compatibility gating:
  - Cohort/profile compatibility checks must be in place before mixed-repo/mixed-profile federation is treated as production-ready.
- Bounded behavior:
  - Concurrency, cancellation, and cache growth must remain bounded as federation/TUI layers are introduced.
- Quality loop:
  - Every major retrieval/indexing change must be validated against a replay suite with tracked quality metrics.
- SLO discipline:
  - Every lane/release must enforce budgets for latency, error rate, and determinism drift.
- Release closeout:
  - Full release packaging should occur after core behavior settles to avoid churn in artifact/release contracts.

## Track IQ: Codebase Intelligence Enhancements

### IQ.1 Intent-aware routing and scoring
- Add query intent classes (`api-discovery`, `bugfix`, `refactor`, `test-impact`, `ownership`, `security`).
- Route backend/weights/candidate strategy by intent.
- Require explain output to include intent and route decision.

### IQ.2 Multi-hop retrieval
- Add bounded second-hop expansion from symbol/call/import graph.
- Add novelty/citation-aware reranking so repeated chunks are down-ranked.
- Keep deterministic tie-breakers and hard hop/candidate caps.

### IQ.3 Task-pack results
- Add a pack mode that groups related outputs:
  - code entrypoints
  - dependent call chain
  - impacted tests
  - relevant configs/docs
- Emit stable pack schema in JSON output.

### IQ.4 Confidence and trust signals
- Add confidence score per result and per response.
- Include signal agreement factors (sparse/dense/graph/metadata consistency).
- Surface low-confidence reasons in explain output.

### IQ.5 Quality feedback loop
- Build replay benchmark from anonymized real queries.
- Track precision/coverage metrics and regression thresholds.
- Make quality gates mandatory for retrieval/ranking changes.

## Track OP: Throughput, Reliability, Robustness

### OP.1 SLO contracts
- Define SLOs for:
  - index build throughput
  - query p50/p95 latency
  - query success/error rates
  - deterministic output drift
- Wire SLO checks into CI and release checks.

### OP.2 Failure-aware degradation
- Define deterministic fallback ladder when providers/backends fail.
- Ensure degrade path preserves correctness and emits explicit warnings.

### OP.3 Fault injection
- Add tests for partial writes, lock contention, cancellation races, backend unavailability, and stale/corrupt artifacts.
- Require recovery behavior contracts and crash-safe resumption.

### OP.4 Adaptive orchestration
- Add bounded auto-tuning for provider order, ANN caps, and candidate limits using live telemetry.
- Keep deterministic policy snapshots to avoid uncontrolled drift.

### OP.5 Release gating
- Block release on:
  - quality replay regressions
  - SLO budget breaches
  - unresolved reliability/fault-injection failures

## Practical execution notes
- Use this SKYMAP ordering when scheduling batches; do not run appendix phases as separate workstreams.
- If parallelizing, split along independent tracks noted in Phase 20 and keep contract-owning changes serialized.
- Re-run docs/config inventory sync checks at each wave boundary to prevent drift.
- Use FAST.md opportunities as implementation backlog for Track OP, prioritized by impact/risk and protected by replay + SLO gates.
