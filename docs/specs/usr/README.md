# USR Decomposed Contract Set

Status: Draft v0.1
Last updated: 2026-02-10T04:00:00Z

This directory decomposes the monolithic USR spec into focused normative contract documents.

Primary contracts:

- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-language-risk-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-rollout-and-migration-contract.md`

Per-language contracts:

- `docs/specs/usr/languages/README.md`

Governance:

- `docs/specs/unified-syntax-representation.md` remains the umbrella contract.
- Child contracts in this directory are normative decompositions and MUST stay semantically aligned with the umbrella contract.

Update workflow:

1. update child contracts in this directory
2. update umbrella USR spec references and impacted sections
3. update machine-readable matrix/schema files when contract keys change
4. update roadmap traceability links and required gates

