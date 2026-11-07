# Windows native snapshot workflow budget

Implementation checkpoints and source-bound hosted observations. Current edits
still require affected runtime verification.

CI2327 at `4f6ca626f5cbad2420caeee84547c6c5f517150a` reports21 native
index-workflow passes and one30.2-second timeout, `snapshot-remove`.
[Original job](https://github.com/doublemover/PairOfCleats/actions/runs/42338308479/job/128300737963)
and its `native-index-workflows-windows` artifact13560627113 retain the parent
failure receipt, exact invocation, phase records, events and console receipt.
The archive digest is
`f01df8ea491cc2f594662b6213726b9fc8e58ce7f16b568d6f9b46aeab35c81f`.
This is a timeout with direct child status1, not a native access violation.

The historical `ni-F7S3as` phase record puts native admission and terminal capture
at19,433/19,434 ms, native UI readiness at21,187 ms and complete seed settlement
at25,902 ms. The real seed includes parser workers, embeddings, HNSW, LanceDB and
SQLite. Snapshot preparation freezes80 files/473,766 bytes, checks78 files/387,038
bytes and reports verification success. Recorded events contain a successful
removal job; the terminal receipt reports exit0, empty stderr and restored input
and output console modes. The parent still times out before final fixture
settlement. These observations identify insufficient enclosing fixture budget;
they do not establish a product deletion failure or successful full acceptance.

The repair overlaps PowerShell/ConPTY setup and the read-only scope/catalog with
the canonical artifact-write phase, after parsing. Full seed settlement,
backend assertions and snapshot preparation still gate every preview/read/launch.
The actual keyboard, native binary, supervisor, public CLI, frozen removal and
post-removal empty list remain. Every complete seed now explicitly checks its
enabled, available and populated native LanceDB backend.

The original26-second terminal capture,18-second native lifetime and30-second
fixture deadlines remain. No retry, backend substitution, cache reuse or fixture
omission was added. Both original seed and admission-file publication promises
are observed and joined on operation and final cleanup paths; independent failures
are retained together. Snapshot-input phases were added to distinguish subsequent
setup from the build. Actual timing improvement and closure require the affected
native cases on the resulting candidate.

CI2330 at `255a96877488ff06f825dbaef372bd72dcc53610` passed snapshot removal in
20.4 seconds and20 other cases, but published search timed out at30.2 seconds.
[Original job](https://github.com/doublemover/PairOfCleats/actions/runs/42341850519/job/128311648236)
retains artifact13562002518, SHA256
`aaae34e5ae1353539e5eaa6c4dcf8d483fcc6eeb0545dfcccb11ec37c1ae93f9`.
Its seed settles at24,213 ms; native readiness is18,890 ms after stage4 admission
at16,682 ms. The search child starts at28.6 seconds and remains active when the
parent deadline expires. There is no access-violation status. This motivated
admitting only independent native/catalog initialization at the earlier
chunk-metadata output (7,999 ms in that receipt), instead of waiting for stage4.
The original build/snapshot join still fences every generation operation.
Additional catalog/publication/search phase records expose subsequent costs.
CI2334 at `7dd801e70bc62be317137e9ca89c5a1ea144a4e0` subsequently passes all22
native-index cases with zero failures, timeouts or skips. The slowest case is
build-search at20.8 seconds; total cohort time is284.8 seconds. The
[original job](https://github.com/doublemover/PairOfCleats/actions/runs/42346707341/job/128326445098)
qualifies that source checkpoint, not later edits.

CI2336 at `dd6e259c594fb999533722e6209c3ff073bec00d` passes21 cases but published
search fails its enclosing witness at28.0 seconds. The
[original job](https://github.com/doublemover/PairOfCleats/actions/runs/42348313440/job/128331382882)
retains artifact13564079285, SHA256
`4c9fcf6065b65b5db003ee6581c2afc168bc077f3514025ab8294d66686a47f1`.
The parent receipt records ordinary status1, no timeout and no native exception;
its last JavaScript log marker does not identify native fault attribution.
Native binary SHA256 is
`66df668388c0e909a6fc3b78136d28f9b1d476d1fb22b7c72beab60ed319c540`,
Node26.13.0/ABI147, Windows x64. This is historical hosted evidence; its
author-workspace copy under `.tmp/tasks/ci2336-native-search/` is not required
or promised in clean checkouts.

Its real seed takes18,467 ms and settles at19,976 ms. Native/catalog readiness
occurs at6,480/7,312 ms, publication readiness at21,273 ms, and search admission
at21,526 ms. The transparent proxy records the original `nativeWorkflowAnswer`,
code/memory/top5/ann:false request and actual search child PID6224. No terminal
settlement or successful query is inferred from that admission. Earlier terminal
overlap therefore improved this path without establishing reliable closure.

The dispatcher change loads its14 independent runtime module roots together
after the original bootstrap gate, replacing14 sequential import barriers.
ESM dependency ordering, readiness enforcement, complete real-backend seeds,
source inputs, actual child ownership and existing deadlines remain binding.

[CI2340's original Windows job](https://github.com/doublemover/PairOfCleats/actions/runs/42354776241/job/128350858962)
at `c5f4ac1e7896e7ac76140238261e5f79c8363044` passes all22 cases, zero failures,
timeouts or skips. Published search passes at22.3 seconds; the slowest case is
validate-published at25.6 seconds, within its original30-second deadline. Gate,
Windows authority, Rust TUI and all three native-inspection jobs also pass at
that checkpoint. Broad jobs are still running at this observation.

This qualifies the original normal-settings cohort at that exact source. It
does not establish a general latency improvement or qualify later edits. A
subsequent change overlaps the index entry's16 and search wrapper's3 independent
root imports after their original bootstrap gates; that change remains unrun.
