# Benchmark artifact-report admission

The benchmark's real artifact-report child uses the shared synchronous subprocess
owner: fixed repository script, selected repository/environment, hidden Windows
launch, a 30-second deadline and 32 MiB capture allowance. No shell command or
runtime retry is introduced.

Nonzero/signal/spawn/timeout failures cannot become an empty report. A zero exit
still requires complete, lossless, untruncated stdout, matching captured byte
extent, valid JSON, the artifact report envelope and the actual selected
repository. Root inspection errors remain failures with their original resource
observations. Successful child values with independently pending owners also
remain required; parsing is not settlement evidence.

Successful output records `artifactReportAdmission` with command scope,
repository and capture extent. Stderr diagnostics remain visible as a bounded
4,096-character preview plus capture/truncation metadata; warnings alone do not
change report policy. Complete command output does not establish indexed-work,
artifact generation, backend, workload or performance qualification.

Failed required artifact admission retains the already measured query summaries
and emits a `failed-required-artifact-phase` result before propagating the original
failure. Corruption remains a required failure. Display cleanup failures compose
with the original failure. Failure excerpts are bounded and redacted without
invoking opaque diagnostic getters.

The artifact snapshot joins measured per-mode build roots and build IDs. A later
publication cannot supply artifact authority to earlier queries. A mismatched
snapshot remains explicitly `currentAfterRun`; `artifacts` is null and the run
fails while preserving its query samples. This association supplies no relevance
judgments or performance qualification.
