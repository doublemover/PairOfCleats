# Benchmark artifact-report child repair — 2026-10-28

**UNVALIDATED source:** `b8034d9f3194a91ddd9ed8aeb480fe6d05e6ed01`, tree
`f3af123c6e75746302113b39fbcce6615e8d2510`. Branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The actual `tests/perf/bench/run.test.js` benchmark producer converted every
nonzero artifact-report child exit to `{}` and continued toward a successful
result. A native crash or operational failure at that boundary could therefore
look like missing optional observations. Its raw spawn also lacked an explicit
deadline and capture-admission receipt.

The real producer now calls `tools/bench/language/artifact-report.js`, which uses
the existing shared subprocess owner and actual fixed report CLI. It requires
successful exit, complete lossless capture, exact byte extent, supported JSON
shape and the physically selected repository. Child failures, truncated output,
malformed/unrelated JSON and mismatched roots stop result publication. Original
resource observation precedes classification. The existing corruption checks
remain, and failed display cleanup retains both causes.

The child has a 30-second bound and 32 MiB capture allowance, runs with the
selected runtime environment and hidden Windows launch, and adds no shell,
retry, alternative backend or public configuration knob. Successful result JSON
includes a command-scoped admission receipt; stderr diagnostics retain a bounded
preview and actual capture metadata rather than disappearing or automatically
becoming policy failures. This receipt is not indexing/runtime/performance
qualification.

Twelve `perf/bench/artifact-report-admission/*` controls are authored,
**unexecuted**: real captured JSON, the real artifact-report command, nonzero and
signal exits, actually truncated and encoding-loss captures, malformed/unrelated
JSON, wrong root, missing capture metadata, expected diagnostics and an original
pending result observer. The truncated case deliberately has a parseable JSON
prefix, so parsing alone cannot pass it. Expected diagnostics are asserted.

Format/ESLint, three JavaScript syntax checks, whitespace and static cycle
analysis (zero cycles) passed. No fixture, child process, native command, model
or benchmark ran now. No crash attribution or final native acceptance follows
from this source repair. #277 remains partial; #284 and all original native
failure/qualification requirements stay open. Source remains unpublished while
functional validation/front-gate execution is deferred.
