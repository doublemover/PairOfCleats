# Windows CI fixture follow-up — November 4, 2026

Hosted source `1d53c5262` passes **1952 correctness cases, zero failures and zero
timeouts**, with three explicit optional/platform exclusions. Windows subprocess,
LSP, crash-log and authority cohorts pass; separate native inspection passes 70
cases. The main Windows job subsequently fails its serial SQLite cancellation
fixture. The [machine receipt](windows-ci-fixture-followup-2026-11-04.json)
retains original hosted/local failure, exact commands and focused repair proof.
This is an assertion failure, not an access violation.

## Actual parser-worker cancellation

The fixture requested bundleThreads 2 but supplied only fileConcurrency 1. The
current CPU budget correctly treats a file window as distinct from a CPU grant,
so it admitted one CPU and used the direct parser. The build completed normally;
the unchanged assertion that a real worker must start rejected that result.
The same failure reproduces locally in 3.09 s.

The fixture now obtains an explicit two-CPU grant from the canonical runtime
envelope and keeps its one-file input window. Production scheduling, memory
bounds, fallbacks and lifecycle owners are unchanged. Its real worker starts
at 420 ms, abort is requested at 421 ms, rejection settles at 424 ms, and the no-late-
work witness passes at 777 ms. The entire fixture passes 3.66 s. Real row writes,
event-loop/precommit cancellation, rollback, original handle closure, prior
publication bytes, staged-output refusal and promotion rollback all remain.

## Installer storage isolation

A hosted installer fixture separately reports admission-owner-busy. A Windows
control holds a real admission lock in a task-owned launch home, then runs the
original SDK-pin fixture under that home: it fails 797 ms with that exact reason.
The SDK payload was isolated but its storage coordinator still used launch
state. The fixture now temporarily selects its own home through the existing
helper, keeping the unchanged inert SDK and actual admission/settlement owner.
The same held-parent-lock control passes 753 ms; production contention rejection
is unchanged. Normal SDK-pin and genuine settlement-contention cases both pass.

The first counterfactual used an invalid match expression and selected no case;
its corrected runner control passed because the runner scrubs inherited homes.
Neither observation was counted as a reproduction. The direct, bootstrap-
verified fixture control above establishes the actual failure and repair.
Those construction/control receipts are preserved. No user storage lock was
acquired and no active index was touched.

Only two fixture owners change. SQLite 324-child qualification and 70 hosted
native passes retain their exact 1d53c5262 source; no repeat broad local campaign
is needed. Other hosted platform failures are recorded separately and remain
outside local Windows execution. New-head hosted CI acceptance remains pending.

Final formatted source passes all four affected controls and all eight
publication checks, including 41 gate cases. Config inventory records the new
fixture-owned home occurrence; no public knob or budget changes. The receipt
identifies the three hosted exclusions and their replacement coverage owners.
