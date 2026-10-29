# LSP exit ownership and Windows CI follow-up

This batch fixes the next demonstrated failures at PR head `5366b344d`, retaining
their original receipts and strict contracts. The [machine receipt](windows-lsp-exit-repair-2026-10-29.json)
records source hashes, focused checks, setup, GYP evaluation and hosted witnesses.
The [preceding qualification](windows-ci-qualification-followup-2026-10-29.md)
retains earlier delivery, launch-authority and native inspection results.

## Graceful exit is owned by the original child

Ubuntu's approved PHPactor installs, initializes and acknowledges shutdown, then
exits by SIGTERM. Its stderr contains only the expected startup information.
macOS completes the same real session naturally, exposing a timing-dependent
shutdown race rather than an unsupported vendor protocol.

The LSP client previously reaped a still-running child immediately when its
stdio closed. A server can close its pipes before its native exit is observed.
That stale-transport path bypassed the existing 2.5-second graceful wait and
could kill the server after successful shutdown. An actual Node protocol child
reproduces premature reaping before repair; on Windows it can exit naturally
while the unnecessary taskkill is still starting. That control fails its
original no-forced-reap assertion.

The client now records shutdown intent against the exact child. Ordinary EOF
retains that child's existing wait; exit/close, tree cleanup and managed-install
settlement remain independent prerequisites. New work cannot enter or restart
that transport. Explicit cancellation and actual stream errors retain immediate
cleanup; a child that never exits is still killed at the original bound.
Replacement-generation, trust, timeout, unknown-resource and shutdown negatives
remain covered. Qualification receipts now also retain bounded lifecycle reasons.

The 26-case affected group passes; final focused checks add stream-error coverage
and recheck all four native-child variants plus PHPactor's expected-info path.
No failure is accepted as a clean exit, and no deadline/retry policy changes.

## Platform fixture and effective macOS build settings

The Windows authority cohort advances through 17 cases, then its nested-command
positive fixture selects a POSIX launcher. Binary admission correctly blocks it.
The fixture now selects the existing `.cmd` counterpart on Windows. Its original
untrusted nested-repository and explicit-grant assertions remain unchanged; the
case fails before this selection repair and passes afterward. No local symlink
is created; POSIX retains its original physical alias negative.

The preceding Tree-sitter deployment-floor edit still emits a macOS linker
warning. Actual Windows-hosted GYP evaluation for a macOS ARM target demonstrates
why: node-addon-api's dependent settings overwrite the binding's early setting.
The merged Debug/Release binding floors are 10.7 while its static runtime uses
13.5; Apple clamps the former to 11.0 in the observed link.

The binding now applies Node 26's 13.5 floor in GYP's final `target_conditions`
pass. The same real GYP graph evaluates all four binding/static configurations
to 13.5 afterward. Its exact build-adapter digest and complete nine-file patch
roundtrip are updated together. This is graph evaluation on Windows, not local
macOS execution; hosted compiler/linker verification remains required.

## Preserve native artifact coverage within existing bounds

The next Windows native run passes 31/32 cases. The retained failing `actions`
case completes open, copy, export and overwrite refusal; it reaches the final
traversal input with its shared 14-second witness window exhausted. The terminal
screens show startup consumed most of that window. Its request log contains four
completed operations and no fifth traversal request, preserving the actual
failure boundary instead of attributing a backend failure from the last label.

The wrapper is partitioned by operation, using the same source fixture, actual
binary/supervisor, UI interaction and source-job/inventory/artifact identities:

| Original assertions | Current case |
| --- | --- |
| Cancel confirmation, then actual editor open with exact source arguments | `actions` |
| Actual clipboard process receives the exact source path | `copy` |
| Exported bytes, overwrite refusal with unchanged bytes, traversal refusal and missing escaped file | `export` |
| Stale identity, missing source, untrusted command and abrupt cancellation | Original four cases |

All seven cases retain native exit status, descendant reaping, terminal
restoration, selected-job identity, final job status and unexpected-warning
assertions. Each keeps the existing 14-second witness, 22-second capture and
30-second runner bounds. The existing CI prefix and ordered-lane rules discover
both new cases. No wrapper or assertion is removed. Seven native cases plus the
full patch roundtrip pass together; the slowest native case is 6.9 seconds.

## Acceptance status

Fresh locked Windows setup verifies 37 packages, 33 language routes and all seven
patches/25 files/59 hunks. The upstream npm `prebuild-install` deprecation remains
explicit. The publication gate and affected final checks are in the machine
receipt. Hosted real-server startup, the complete Windows authority cohort,
final macOS linking and the partitioned native cases require the next candidate.

Integration now advances beyond startup: macOS reports 1,311 passes, 49 failures
and one exclusion. Those failures form the next repair batch; this source does
not claim to fix them. Windows integration is still running at this checkpoint.
The three P1s and historical failures remain open. The separately measured
[crash-log qualification](crash-log-latency-qualification-2026-10-29.md) still needs
its hosted POSIX execution. No WSL, elevation or machine configuration changes
were used. `.tmp/` author-workspace paths are historical, not clean-checkout inputs.
