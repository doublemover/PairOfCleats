# Symbolic enrichment integration record

Date: 2026-10-11. Status: end-to-end milestone validated; repository front gate passed; not a completed NuSSR acceptance run.

## Scope and evidence boundary

The working checkout starts from `bee75cc882f81988b34340451d261c1cefa936b7`. The first diagnosis/fix batch ends at `679573bd885bb0047f5760db0608ff13a7590020`. This record concerns the subsequent finite-string representation and publication work. Cloud tests use Node 26.11.1 and the repository's prepared dependencies. No user indexing process is involved.

The original run exhausted its roughly 4 GiB V8 heap during TypeScript enrichment. The 16 GiB retry was deliberately cleaned up after a long silent transition; it did not provide evidence of another OOM. Neither observation identifies an arbitrary TypeScript semantic expansion as that retry's cause. The patch-queue ownership race and duplicate compiler roots have separate reproductions and separate fixes.

## Implemented contract

The opt-in `tooling.typescript.typeRepresentation: "symbolic"` backend preserves the declared denotation of supported closed finite-string annotations as a shared Literal/Union/Concat DAG. It does not claim observational equivalence to every TypeScript checker query, nor complete analysis of arbitrary programs. Query results expose their interpretation explicitly. Unsupported required work, budget exhaustion, transport failure, and integrity failure abort rather than become an empty or complete answer.

The path under test is source files → existing parsing/chunk identities → canonical tooling config → owned compiler subprocess → symbolic frontend → shared graph and chunk references → existing artifact queue/piece registry → validated generation publication → generation-pinned exact membership/classification.

## Integration experiment

Fixture: `tests/indexing/artifacts/symbolic-types-build-publication.test.js`.

Two TypeScript files define `Bit = "a" | "b"`, a template product with 72 independent positions, and a function with that parameter/return annotation. A Bundler tsconfig supplies ordinary compiler context. Semantic indexing is disabled to exercise the original legacy cross-file enrichment path. The represented language has 2^72 members; the test requests membership of explicit 72-character words and zero/one/many classification rather than enumeration.

Command:

```sh
node tests/run.js --lane all --match symbolic-types-build-publication --jobs 1 --timeout-ms 30000 --retries 0
```

The fixture retains the normal test deadline. It explicitly supplies a 10-second provider deadline because the shared test environment's 1-second provider default is shorter than cold compiler startup on this cloud host.

### Failures discovered and addressed

1. Canonical config loading projected a fixed set of TypeScript properties and discarded the new representation choice. Direct-provider tests therefore passed while the real index silently used legacy execution. The canonical loader now preserves and validates the choice; a loader regression covers it.
2. The owned subprocess assembler defines a non-writable top-level provider property. Orchestration assigned `output.provider` in place and threw a read-only-property error. Orchestration now creates a shallow wrapper with its identity rather than mutating provider ownership.
3. That unexpected error entered existing optional-provider fail-open handling. Explicitly required symbolic execution now wraps unexpected errors with their original cause and propagates required-incomplete status. Optional legacy provider degradation remains unchanged. All 16 tooling-provider fixtures passed in 6.58 seconds after this change.
4. Real publication reached an older metadata validator that interpreted every `metaV2.types` subtree as inferred string-type records. Symbolic expression envelopes require their own authoritative schema validation rather than that walker.
5. The graph content identifier uses SHA-256. The existing piece-validation path initially reported that algorithm as unsupported; content addressing and publication checksums must both be verified through their actual owners.

Items 4–5 were corrected and covered by the actual piece-writer/strict-validator fixture. A further failure identified canonical JSON ordering: the stable serializer skipped null-prototype dictionaries, so an in-memory reference and its JSON-decoded copy compared differently despite identical fields. The shared canonicalizer now handles both dictionary prototypes and preserves prototype-named own keys; its regression passes in 76 ms. Failed runs are evidence of integration defects, not successful publication. Test-cache paths are author-workspace historical receipts and are not promised in a clean checkout.

### Successful end-to-end result

The final fixture passed in **8.58 seconds**. It published the graph, answered positive and negative explicit-word membership and `many` classification, then changed the source to a required unsupported numeric annotation. That second build rejected; the current index directory and manifest remained identical, and the pinned previous graph still answered correctly. Historical author-workspace receipt: `.testLogs/run-1791711347510-qfr87y`.

An initial fixture assertion assumed that disabling semantic indexing meant no semantic manifest file could exist. The existing publication path can write a skeleton manifest, so that unrelated absence assertion was removed. Required graph publication and generation preservation are tested directly.

## Decisions and rejected shortcuts

- Do not split compiler context by arbitrary target windows: shared type dependencies can make every window reconstruct essentially the same graph.
- Do not enumerate a template-product language and spool it: finite source can denote physically infeasible output cardinality.
- Do not pass an uncovered inferred query blindly to the checker: a return expression referring to a covered parameter can force that parameter's expansion.
- Do not equate compact representation with cheap arbitrary semantic questions. Membership of an explicit word is the implemented query; arbitrary language equivalence and distinct cardinality have different complexity.
- Do not relabel missing computation as complete. Resource caps are explicit failures; they are not semantic truncation.
- Keep legacy default behavior unchanged while the new interpretation and supported domain are explicit. This means the milestone is not yet a general replacement for all existing enrichment.

## Open obligations

- The bounded complete publication/query path and failed-build generation preservation are now verified; extend that evidence to additional supported contexts and operations as they are implemented.
- Final formatting, config budget, environment usage, generated-surface freshness, command surface, workflow contract and all 39 gate fixtures passed (8.49 seconds for the gate lane). The first freshness check identified a stale doc-contract drift report; its canonical generator refreshed it, then the check passed. Final feature regression and commit receipts accompany the batch.
- Extend inference through dependency-aware summaries with explicit path coverage and unresolved obligations. The 2008 demand-driven compositional symbolic-execution paper motivates that discipline but is not implemented merely by storing a DAG.
- Establish broader TypeScript contract coverage without importing unbounded compiler expansion through fallback queries.
- Establish practical workload capacity independently from these bounded adversarial fixtures. No user rerun is requested as a substitute for these obligations.

## References

- Anand, Godefroid, Tillmann, *Demand-Driven Compositional Symbolic Execution* (2008): https://www.microsoft.com/en-us/research/wp-content/uploads/2008/01/fulltext.pdf
- User-supplied equality-saturation paper, version 1: https://arxiv.org/pdf/2602.16707v1
- Kernel measurements and reproduction harness: `typescript-type-ir-scaling-2026-10-11.json`, `typescript-type-ir-scaling-conservative-2026-10-11.json`, and `tests/tooling/fixtures/typescript-type-ir-scaling.js`.
