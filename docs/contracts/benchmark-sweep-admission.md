# A/B sweep admission and report ownership

The A/B sweep report is version 2. Its version 1 composite score could trade a
failed run against a sufficiently slow success and treated missing diagnostics
as zero. Historical reports keep their original meaning. Version 2 first admits
completed comparable work, then minimizes the sum of admitted durations. Stall
and utilization remain diagnostics; token occupancy does not measure hardware
CPU efficiency. No finite failure penalty participates in selection.

## Eligibility

The existing benchmark runner resolves scripts, arguments, suite expectations,
required/optional policy and `${repoRoot}`/`${indexDir}` substitutions through one
workload owner shared with the sweep. Entry source hashes and the resolved
contract form a versioned SHA-256 fingerprint. Entry bytes are checked again
after execution. Git boundary observations must identify the same clean revision.
These checks qualify the recorded source boundary, not the complete native,
dependency or operating-system environment.

A candidate needs a clean child exit, the exact invocation/workload receipt,
complete script coverage, successful required outcomes, complete measurement
capture, and a qualified observation for every measured script. Unknown,
truncated, malformed, failed, timed-out and required-skipped work is ineligible.
All otherwise eligible candidates must report the same completed work and host
identity. A mismatch rejects that comparison instead of choosing an arbitrary
reference group. The measured denominator and every exclusion remain visible.

Optional suite work may leave the denominator only when the suite declares it
optional and every variant records the same supported terminal skip reason.
Its command identity and clean process result are still checked. One-sided
missing work cannot win. The policy is explicit in the versioned objective.

Measured producers supply `benchmarkObservation` in their existing JSON output:

```json
{
  "version": 1,
  "scope": "benchmark",
  "workload": {
    "id": "producer-workload",
    "producerVersion": "1",
    "units": 1000,
    "dataIdentity": "sha256:<64 lowercase hexadecimal characters>",
    "configurationIdentity": "sha256:<64 lowercase hexadecimal characters>"
  },
  "correctness": { "state": "passed", "checks": ["content-parity"] },
  "metrics": { "durationMs": 12.5 },
  "knobs": {
    "cpuTokens": { "state": "applied", "value": 4 },
    "workerCounts": { "state": "unsupported" }
  }
}
```

The producer owns those observations: positive integer completed units, bounded
correctness witnesses, exact data/configuration identities and positive finite
duration. Configuration identity describes equal-work semantics; tuning choices
have separate consumption receipts. Merely forwarding an environment variable
does not prove application. Each requested knob must be explicitly applied with
the requested value or unsupported by each measured producer, and actually
applied by at least one. Missing/unverified consumption and entirely unsupported
dimensions cannot support a recommendation. Existing producers without this
evidence retain their raw reports and receive explicit exclusion reasons.

`scope: "fixture"` identifies deterministic protocol/ranking controls. It cannot
qualify production latency. A benchmark recommendation is limited to the same
observed host/workload; release and representative performance remain separate.
No eligible candidate produces `recommendation: null`, an insufficient-work
outcome and nonzero CLI status. Cancellation or an incomplete matrix also
produces no recommendation, even if earlier variants completed successfully.

## Immutable evidence and bounds

Each invocation creates an exclusive compact directory beneath
`.testLogs/bench-ab-sweep/`, with a UUID experiment ID, an owner marker and a
create-only final receipt. Child reports have distinct ordinal variant IDs and
carry the experiment, request and workload fingerprints through the existing
observability context. Parent admission checks the complete child receipt.
Shared `run-001.json` names across invocations are no longer used.

The parent reads the actual contained UTF-8 report file even after nonzero child
exit. Failed rows, exit/signal facts and bounded diagnostic tails survive. It
never substitutes an empty synthetic report or selects stdout over the file.
Each advertised raw path retains its byte length and SHA-256 digest. Publication
uses the existing atomic writer with exclusive creation for owned raw/final
files. A later invocation cannot overwrite those historical paths. An explicit
`--json` summary remains an atomically replaced convenience output.

The matrix is bounded to 256 distinct variants. Raw reports have a fixed 64 MiB
per-file and 512 MiB total invocation allowance; child limits shrink with the
remaining allowance. Oversized reports retain actual terminal statuses with an
explicit incomplete-report marker and bounded tails when that envelope fits.
The runner fails if even that envelope cannot fit. Storage failure, cancellation
or exhausted allowance leaves explicit not-run rows for remaining variants.
Large raw logs are not duplicated into the sweep summary or retained in memory
across every variant. Sync and async subprocess owners expose capture truncation
and encoding receipts using the same bounded collector.

Settled-run retention/cleanup across A/B and bakeoff remains tracked by #1663.
This slice performs no global history deletion and does not qualify indefinite
evidence retention as complete. New regressions cover hard admission, known
fixture ranking, real nonzero child reports, interleaved invocations, sequential
history, malformed/foreign reports and cancellation without models or corpora.
Their functional execution is deferred with the current implementation wave.
