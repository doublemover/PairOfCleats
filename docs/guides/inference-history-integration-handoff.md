# Inference-history source integration handoff

Prepared 2026-10-08. Source checkpoint only; no push, PR creation or merge is authorized.
The [reader specification](../specs/inference-history.md#reader-invocation-examples)
contains the current context/search/reference invocation examples.

## Repository and route

Repository: `doublemover/PairOfCleats`.
Original pilot base: `2529d718db780da22c49f188202b6f1550a1833d`.
Verified current destination base: `main` at
`5bcc2b061019068553eaa2c441735af76b0c3917`.
Accepted reader checkpoint: `42b6c5a705c8f333d213dc829774400c6f974809`, tree
`3d2a2d6d283903356e10c9f29c58a7ebb4c95a17`.

The supplied source handoff assigns no publication branch or PR. Its local history
is detached. PR545 is already merged and cannot serve as an open integration route;
Sagnac PR22 belongs to another repository. An exact new branch/PR route and publication
approval are required from the owner before any remote mutation. Do not republish an
old branch or infer a target from a private export task name.

Current main contains the original pilot base: GitHub's comparison reports main
four commits ahead and zero behind, with merge base `2529d718...`. Its changed files
are closeout/security/roadmap documentation and subprocess/helper test owners, not
inference-history source. The inference-history directory is absent on main. None
of the eight pilot/reader commits below is integrated there. Do not replace current
main with the older pilot snapshot: replay the source commits on the then-approved
current main and review/validate the resulting integration separately.

## Ordered unique source commits

Apply in this order if the owner authorizes integration from current main:

1. `296f70cb8721c30e2bd630f216df5faff75cdb81` — lossless archive graph normalizer.
2. `ae88c7b8f0f8f02a9e84fe35125359ba2dc88bd6` — policy-bound vault and exact evidence joins.
3. `8d9aa964819a21ca5c977d58829ebb5d250900fb` — parent-only graph normalization.
4. `25462d1b958de671acad9d09b0e57872a0644f15` — bounded projection provenance.
5. `b25082f356da783c7479963bc7224f622dc77a0a` — Codex records and declared member evidence.
6. `52ad2db0536271582ce5a7a61f84f79fde9a8f6e` — nullable Codex item arrays.
7. `e87390d4daf879d849221629af08c8383e0a1a67` — omitted Codex item arrays.
8. `42b6c5a705c8f333d213dc829774400c6f974809` — visible context, snippets, filters,
   exact shared-message groups, paginated provenance, and the Git-for-Windows null-name fix.

The documentation follow-up containing this handoff is a separate descendant of the
accepted reader checkpoint. Preserve it with the source when preparing integration.

## P-G2 independence

P-G2 commit `41f30ca0fc2e32afe14f85928d1851d17b4324ae`, parent `5bcc2b0...`,
classifies SourceKit package-preflight cache provenance. It changes the SourceKit
producer, generated-artifact/cache owners, their tests, generated-object documentation
and roadmap. It shares no changed files with the inference-history chain. Reader/vault
source does not import that producer or its new policy. P-G2 is not a prerequisite
for this handoff; its separate source/validation/publication disposition remains separate.

## Evidence and privacy boundary

The reader checkpoint passed scoped formatting/lint/diff checks and four focused
reader/service/security/correlation tests on Windows Node 26.8.1. The correlation
failure was isolated to Git rejecting Node's Windows null-device name; the corrected
Windows `NUL` name passed the affected rerun. Completed checks are reused for this
text-only follow-up. They do not establish integrated-main or hosted release acceptance.

Only authored source, synthetic regressions and project documentation belong in Git.
Keep the private vault, export/corpus, manifests containing private identifiers,
query outputs, model reviews and machine-local receipts outside tracked source.
No import, reindex, embedding, raw-original or model query rerun is needed to prepare
this handoff. Future integrated validation must honor the owner's exact requested scope.