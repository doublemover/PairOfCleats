# Cold prerequisite discovery repair — 2026-11-04

Hosted [CI41905467499](https://github.com/doublemover/PairOfCleats/actions/runs/41905467499)
at `20e274f99` passes gate, Rust TUI, Windows authority and Ubuntu/macOS native
inspection. Windows native inspection stops in locked-bootstrap preflight:
the explicitly selected setup-python3.15.2 executable is reported unavailable
or incompatible after roughly3.15s. The prior hosted macOS Make discovery
failure has the same near3-second boundary. Those old messages discard the
probe result, so their precise exit/error/timeout cannot be established.

A real bounded child control demonstrates the source defect: an explicitly
selected fixture interpreter produces valid identity JSON after3.5s. Original
preflight's3-second budget kills it and reports missing/incompatible Python;
the regression fails3.71s. Missing commands and unsupported identities are
different failures and retain their strict admission.

Discovery now gives each command one bounded10-second probe, with no retries.
Timeout, launch error code, exit status and signal survive in diagnostics;
mandatory Git/Python/Make errors identify that cause. Explicit Python still
rejects without launcher/PATH fallback. Successful prerequisite discovery
still requires the normal native build, patches, activation and lifecycle
verification. Ordinary tests retain30-second deadlines and zero retries.

The focused control includes the original delayed launch, timeout, ENOENT and
exit17 negatives. Its simulated tool selection is explicit and local; it does
not claim a real Python installation or native compiler qualification. No links,
elevation, security settings, alternate runtime or machine installation is used.
Fresh native/patch verification refreshes the already prepared dependencies.
Hosted qualification of the repaired source remains pending.

The repaired cold-probe control passes3.68s with all three refusal negatives,
and all eight original M3/E5 formatting, identity, cache, validity and output
controls pass5.64s in total. Native/patch verification passes without warnings
or errors. Ordered CI now includes239 cases; ci-lite remains1,989.
The [machine receipt](windows-cold-prerequisite-repair-2026-11-04.json) retains
the original hosted message, failing/passing regression and native verification.
