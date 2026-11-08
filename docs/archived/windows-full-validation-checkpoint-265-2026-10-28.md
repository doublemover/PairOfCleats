# Full Windows validation at checkpoint 265

The full campaign ran on Node 26.12.1, Windows x64, at
`90d0e510af620816d338f1ff284fa2f384818853` (tree
`fdb8fe5915576f17d5d937ca2865ec530b712f8f`). It started at
20:59:58 UTC and finished at 23:05:37 UTC on 2026-10-28.

| Cohort | Passed | Failed | Total |
| --- | ---: | ---: | ---: |
| Correctness | 4,223 | 169 | 4,392 |
| Native lifecycle | 1,412 | 92 | 1,504 |
| Performance and resource contracts | 184 | 18 | 202 |
| **Total** | **5,819** | **279** | **6,098** |

Fourteen failures were runner timeouts. There were zero skips, duplicate IDs,
missing required fixtures or recorded test-process access-violation exits.
The suite is failing; the complete baseline now identifies the remaining work.

The [durable receipt](windows-full-validation-checkpoint-265-2026-10-28.json)
retains every cohort's exact fixture IDs, timestamps, results and report hash,
all 279 failures, runtime/dependency identities and all 58 exclusions. Raw logs
under `.tmp/tasks/windows-validation-265-20261028/` are historical author-workspace
evidence, unavailable in a clean checkout.

All cases used 30-second fixture deadlines, zero retries and disabled native
status redo. Native and performance cohorts ran serially; correctness cohorts
used one or four jobs. Performance observations came from a shared Windows
desktop with other workloads present, without changing thresholds. No Linux,
macOS or WSL execution was performed for this campaign.

The 58 exclusions comprise 43 optional physical-link fixtures, eight POSIX/Linux
positives with separate portable or Windows owners, four intentionally failing
runner helpers owned by their parent tests, two optional-backend positives and
one opt-in representative benchmark. The receipt names each exclusion and its
owner. These exclusions do not remove portable authority checks.

## Repairs following the baseline

- Risk selection now counts only count-cap omissions in count-cap metadata;
  earlier byte-budget omissions remain separately accounted. A mixed-budget
  regression failed before the repair and passed afterward for both full and
  partial flows, including reversed input order.
- Empty and populated field postings share safe own-key records, retaining
  reserved names and lengths-only fields. The exported-builder regression
  reproduced the empty-path prototype replacement before the repair.
- Markdown newline pieces exclude the next line's host prefix. Installed
  Micromark events demonstrated the physical end-offset/serialized-EOL
  difference. Source-chunking and comment producer versions retire old meaning;
  lexical producer versioning similarly retires the old field-postings output.
- Provisioning preserves platform metadata arrays. Missing publication pointers
  return before cache admission. The VS Code Windows command mirror now matches
  the canonical resolver, and CI schedules the graph-evidence API contract.
- Fixture repairs restore valid manifest pieces, original SQLite argument
  arity, atomic-write fault boundaries, real source timestamps, structured build
  generation selection, published TUI fixtures and complete wire comparisons.
  Original error causes and ordered cleanup failures remain asserted.

The [focused qualification receipt](windows-shared-repair-qualification-2026-10-28.json)
records 225 passes/13 failures in 238 affected checks at `79c2910cc`, then 68
passes/three failures in 71 follow-ups at `1623dd0c2`; pinned Rust passes all 152
tests. Remaining focused failures are three import-replay cases and vector-only
service validation. The writer preserves the JS extraction receipt correctly;
its legacy producer remains explicitly unqualified, so cache admission correctly
requires refresh. Parser-owned JS/CSS qualification and deferred dense publication
still need repair. Native source/editor failures now retain their safe typed
codes through the closed TUI catalog. Issue closure requires source review and
its original controls, rather than a matching test name.
Remaining native workflow failures, timeout owners, managed-tool availability,
shared-module review drift and the other catalogued failures remain open work.

The subsequent [import and TUI follow-up](windows-import-and-tui-validation-2026-10-28.md)
passes all 109 selected import/registry controls and the three original Cargo/TUI
cases. It repairs the import failures described above; queued vector-only dense
readiness and the remaining catalog are still open. Exact follow-up case/source
identities are retained separately from this frozen baseline.
