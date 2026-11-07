# Windows native snapshot workflow budget

Implementation checkpoint; affected runtime verification remains unrun.

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
These changes remain unrun; the old workflow observations do not qualify them.
