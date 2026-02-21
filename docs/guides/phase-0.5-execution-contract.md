# Phase 0.5 Execution Contract

This guide defines the mandatory implementation contract for `AINTKNOWMAP.md` subphase `0.5.0` and all `0.5.x` language/framework passes.

## Canonical sequence

Execute Phase 0.5 in this strict order:

1. `0.5.40` descriptor + manifest canonicalization
2. `0.5.41` caps telemetry + calibration
3. `0.5.1..0.5.39e` language/framework implementation passes
4. `0.5.42` performance optimization program

## Shared-file workstreams

Use three shared-file workstreams to avoid repeated churn in core shared touchpoints.

1. Routing/descriptor workstream
2. Caps workstream
3. Fixture/test workstream

Each shared file should be patched once per workstream, not once per language.

## Per-subphase deliverable contract

Every `0.5.x` subphase must ship all three deliverables in the same commit series:

1. Descriptor/spec patch
2. Code-path patch
3. Fixture/test patch

## Required artifact outputs per subphase

Each subphase commit series must include explicit artifacts:

1. Descriptor diff artifact
2. Caps profile diff artifact
3. Fixture/test diff artifact

A subphase is not complete until all three artifacts exist in the commit history.