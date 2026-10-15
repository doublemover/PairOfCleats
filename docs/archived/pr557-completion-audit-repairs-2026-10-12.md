# PR 557 completion-audit repairs, 2026-10-12

Base: `6125e534ec8a2d588688c8c3b107bad268d6cd90`.
Status: local repair validation; publication recorded separately in Git history.
The [canonical roadmap](../roadmap.md) owns current status. The [original implementation record](audit-backlog-implementation-2026-10-12.md) remains historical evidence.

## Reconciliation

The follow-up audit found substantive implementation for all 45 backlog items,
then reproduced ten additional regressions and one pre-existing repeated-build
failure. On the audited commit, 34 original items had fresh bounded verification,
four had implementation with fresh integration/platform acceptance unavailable,
and seven remained partial. This was not a claim that any item had no code.

## Repairs and regression owners

- Ordered typed-array whole-value channels retain initialization/current element
  inputs while excluding overwritten values and out-of-range view elements. The
  CFG and value-slice share the same ordered authority. Existing snapshot/capture
  exclusions remain covered; changed analysis versions prevent stale replay.
- One document owner/capture inventory replaces repeated whole-file scans for
  each function. A 400-function operation-count fixture drops from 5,295,606 to
  17,608 node visits, with 1,200 checker lookups rather than 481,200. This is a
  bounded mechanism count, not a production throughput benchmark.
- Native C authority refuses alternate directive spelling and included targets
  outside its scanned extension subset rather than certifying an incomplete
  closure. The source-closure fixture does not claim real clangd execution.
- Model identity follows the selected tokenizer's actual local path/cache
  resolution. Unrelated files beside weights cannot qualify a missing tokenizer;
  changed selected bytes invalidate dense compatibility.
- Query leases return to an explicitly owned bounded warm adapter cache. TTL/LRU
  eviction and service shutdown await active sibling leases before disposal.
  Three sequential distinct queries now create one provider pipeline.
- Active process task cancellation/timeout retains IPC/input/output reservations
  until the child closes; promise rejection no longer implies storage release.
- Configured positive subprocess grace is joined through the existing process-tree
  escalation owner before SDK queue capacity is returned. Direct-child close and
  tree cleanup are separately labelled; no universal descendant-reap claim is made.
- Test discovery bounds directory visits and candidate retention while refreshing
  the bounded live inventory. Partial directory inventories are not admitted as
  arbitrary order-dependent candidate sets; unknown truncation stays explicit.
- Context call-site hydration owns one bounded verified source snapshot per
  assembly. Twenty 16-byte ranges from one 4 MiB file require one 4 MiB source
  read, rather than the audited 84 MiB. A later request verifies current bytes.
- Ordinary immutable snapshot garbage is collected after durable manifest
  publication under existing writer ownership, including when semantics are off.
  Malformed pin inventories defer the entire sweep; Stage1 objects remain intact.
- Declarative SafeRegex/native-regex identity replaces recursive inspection of
  compiled matcher internals. A pre-existing RE2 cycle no longer crashes repeated
  in-process build policy hashing, and pattern/flags/limits remain significant.

New regression fixtures include `ordered-aggregate-flow`, `ordered-storage-index`,
`native-include-closure`, `query-warm-cache-lifetime`, `sdk-descendant-grace`,
`suggest-tests-discovery-bounded`, `source-snapshot-reuse`,
`nonsemantic-snapshot-orphan-cleanup`, and `language-policy-matcher-projection`.
Existing model identity/process lifecycle fixtures gained the affected cases.
Independent review found partial-directory nondeterminism, malformed GC pins,
relative model paths, and aggregate overwrite/view negatives; those cases now
have targeted guards and tests.

## Evidence and remaining limits

Node 26.8.1 official bootstrap/native repair produced real readiness. Focused
fixtures use a 30-second per-test cap, zero retries and disabled native-status
redo. Original failing receipts remain separate from post-fix acceptance. The
previously failing runtime-source-reference integration passes after the RE2 fix.

Cold artifact-memory/LMDB enumeration still reloads metadata per fresh-process
page (SRC-010); representative provider throughput remains open (EMB-009).
SSR and strict-type whole-publication fixtures could not qualify compiler tasks
under this environment's actual scheduler byte/token admission. Admission was
not bypassed. Original authored native/browser/model receipts are not fresh runs.
Native Windows/macOS, real clangd execution here, hardware GPU, native-child RSS,
full-corpus quality/scale, and the recorded q8 cosine-threshold failure remain
explicit. No hosted CI was inspected or triggered, and no merge was performed.

## Final local acceptance

The ready-to-publish batch passed formatting/ESLint, config budget, environment
registry, generated-surface freshness, command-surface and workflow contracts,
and diff whitespace checks. Test governance refresh found no missing IDs,
duplicates, manifest mismatches or timing overruns.

- Prescribed gate: **39/39 passed**, 25.834 seconds total.
- Serial affected selection: **50/50 passed**, 99.194 seconds total.
- Combined selections cover 88 distinct fixtures. Every fixture used one attempt,
  a 30-second deadline, zero retries and disabled native-status redo; no skips,
  failures or timeouts occurred in either final run.

These author-workspace receipts are historical local acceptance, not hosted CI
or clean-checkout receipts. All product source was final before both runs.
After repair, the backlog matrix is 38 bounded-verified, five implemented with
fresh integration/platform qualification limited, two partial (SRC-010 and
EMB-009), and zero missing. No platform or full-corpus claim is implied.
