# USR Decomposed Contract Set

Status: Draft v0.8
Last updated: 2026-02-10T08:35:00Z

This directory decomposes the monolithic USR spec into focused normative contract documents.

Primary contracts:

- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-language-risk-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-embedding-bridge-contract.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-security-and-data-governance-contract.md`

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
5. run decomposed-contract drift checks and attach evidence artifact links
6. update per-language contracts impacted by changed keys or conformance rules

Drift enforcement expectations:

- every contract file with prefix `usr-` under `docs/specs/` MUST be represented in roadmap traceability (`TES_LAYN_ROADMAP.md` Appendix H)
- machine-readable matrix files referenced by child contracts MUST exist in Phase 1 registry inventory
- language version/embedding policy matrices MUST stay key-synchronized with `usr-language-profiles.json`
- parser/runtime lock matrix MUST stay synchronized with parser sources referenced by profiles and mappings
- SLO/alert and redaction/security matrices MUST stay synchronized with blocking gate policies in roadmap and CI


