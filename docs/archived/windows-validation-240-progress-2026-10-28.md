# Windows validation after checkpoint 240

Implementation froze at `7fd9190860201f8e726c128f1f7878d1cb4c1fe5`.
The first repair batch ends at source
`96e7d44407e0e64f958270db5e90f32ad88743d1`, tree
`b51d0211ffcbf10d872807d28a8c7b041b3ee831` (249 local commits).
This is an in-progress campaign, not whole-suite acceptance or issue closure.

## Completed observations

- All required front-gate commands pass at `d8221fb07e5babf3d09a2c9e8aba7c19e98769b9`,
  including **40/40 ordered gate cases**, zero failures/timeouts/skips and zero
  retries/native-status redo. Format/config/env/generated/command/workflow and
  whitespace checks are included. Later edits are the focused fixture and Rust
  presentation repairs below; they do not inherit a new full-gate execution.
- Actual SQLite search publication: **six cases pass** at that candidate,
  including simultaneous frozen work/close failures, pending close/cache results,
  ordinary optional cache failure and success. Generic disposal, settlement,
  prepared JSON/human output and branch-publication controls also pass.
- The new search projection, original child ownership, supervisor cause/success
  and pending-resource controls have passing focused observations after the
  fixture corrections below. Their original interrupted fail-fast selections
  retain explicit unrun entries; those entries are not accepted skips.
- Rust **1.88.0**, the repository pin: **152/152 tests pass**, no ignored tests or
  compiler warnings; the production debug binary builds successfully. An earlier
  available-toolchain (1.93.1) pass is separate, not pinned-toolchain proof.
- Actual production binary/supervisor ConPTY failure → correction → indexed-hit
  → quit flows pass at **80×24** before the narrow presentation repair and
  **32×24** afterward. Each preserves real failure/result assertions, child and
  supervisor reaping, final job states, layout privacy and terminal restoration.
  Both run under 30 seconds without retries or crash-status redo. Other native
  search/lifetime cases still require current qualification.
- Fresh native/patch verify exits **0** without warning/error diagnostics and
  changes no patched file. The prepared package/lock inputs remain unchanged;
  all eight patch packages, 26 targets and 61 hunks are already applied. Activation
  readiness remains distinct from runtime/native-crash qualification.

## Failures repaired

1. Config inventory omitted the collector's internal child-transport variable.
   It is now registered as internal, unset by default; public budgets are intact.
2. Generated artifact-schema hash and roadmap audit/reconciliation/CRLF size
   drift were refreshed through their owners. Roadmap remains below 20 KB in LF
   and CRLF forms; no drift assertion was relaxed.
3. The first gate had 38 passes/two failures: a nonexistent trusted-config path
   inherited from this author launch and a physical-link manifest retaining four
   fixtures already converted to portable controls. Only this validation process
   clears the missing environment pin; no user configuration/security setting is
   changed. The physical manifest now matches its actual 43 source owners. All
   four converted fixtures remain required ordinary coverage.
4. A projection fixture put a megabyte message inside its supposedly admissible
   envelope. The real 768 KiB bound correctly rejected it. Valid bounded and
   oversized hostile envelopes now have separate positive/negative assertions.
5. New real-supervisor fixtures lacked canonical publication and lexical content.
   They now publish through the existing generation helper with an actual indexed
   alpha source; positive hits are still mandatory. Missing branch capability uses
   an isolated unborn Git checkout, since production intentionally strips ambient
   `GIT_*` overrides rather than trusting a test-provided ceiling.
6. The narrow terminal fixture waited for full-width welcome/footer text. It now
   checks visible welcome text and actual overlay closure, retaining real quit
   and cleanup assertions. Failure reasons occupy their own readable row; a new
   native model control asserts an intact repository reason at 28 content columns.

Original failure logs remain historical evidence. No native crash was observed
in these passing checks; unresolved SQLite/Stage3 crash attribution is not closed.

## Full inventory and next execution

Read-only discovery lists **6,153 cases**. The explicit plan accounts for **6,095
required Windows cases in 142 cohorts** and **58 exclusions**: 43 optional physical
link qualifications, eight POSIX/Linux positives, four parent-owned intentional
skip/timeout/redo targets, two optional native backend positives and one opt-in
representative benchmark workload. The POSIX shell-wrapper exclusion has an
ordinary required Windows no-Bash/WSL-launch control. Other portable/Windows
authority, unsupported-platform and backend contract cases remain required.

Correctness has 4,389 cases with bounded concurrency four; native/lifecycle has
1,504 and performance 202, both serial. Every fixture retains its 30-second bound,
zero retries and disabled native-status redo. The uninstall fixture's actual
source verifies every dry-run deletion target remains inside its marked disposable
roots before mutation. Current source changes require affected rechecks; final
coverage cannot be manufactured from old mixed-tree green observations.

## Historical author-workspace evidence

Receipts under `.tmp/tasks/windows-validation-240-20261028/` are not promised in
clean checkouts. Exact SHA-256 values:

| Receipt | SHA-256 |
| --- | --- |
| `final-front-gate-report.json` | `a3945a1bac0eb05c02ad3d37cf65aafc4f95751a9177ccd22488a1540dda7d15` |
| `native-verify.log` | `605e28a7b4d6cdc1b6b33ef0379d779b10ffb34bb52fa5eb8da627a4d8d1d523` |
| `rust-final-test.log` | `bd92ec50feead401e0ef31ab78bd92c6f68cadbaaecb3192c44cb2291f949a7d` |
| `native-narrow-final-report.json` | `e4f969f1028bc6a5b3060de2d373e83f4b913be579963fa616fc7c30ef7ee522` |

The verified 86,564-byte recovery bundle `native-search-settlement-through249.bundle`
requires checkpoint 220 (`54fe6d0b120b307f735ab2db7f8d75ae466a39c1`) and contains
source 249. SHA-256:
`b50c3c72a4e3d2a8c47743dd749d1cbbcb7a5633bf6a8fd709f7f0e1ff6d160b`.
The bundle is historical task recovery, not a remote publication receipt.
