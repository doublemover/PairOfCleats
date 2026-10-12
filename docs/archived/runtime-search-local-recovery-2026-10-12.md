# Runtime/search local recovery and Windows verification

The owner-authorized local recovery preserves all 30 implementation commits from
consolidated main `11f1556c8a71b191e090c1257cddced2b92d9ef7` through
`065930d4427eeeabe5c0a2b829a7dd2bc777adaf`, tree
`f5f8ce202e622fd327f8eb6a58c84ab463a23886`. GitHub readback confirmed PR547-555
were merged and the requested implementation branch did not yet exist.

The ZIP passed its CRC check. Its SHA256 is
`9d33045242bc813a74d530ff93341624fa5f048664ad923592fcae02c30a5685`.
The bundle SHA256 is
`972d62c7e7eaf03f0dab543ef0756951a0ad242850af2f33a406aeb03cfc5d3c`.
Bundle verification confirmed the exact main prerequisite, branch ref, head and
tree; the recovered Git objects passed strict integrity checks. Recovery used a
separate task-owned checkout, preserving the original checkout and worktrees.

## Local integration corrections

Embedding plans now select and compare repository/index roots through the
existing canonical workspace identity owner. Raw Windows path spelling no
longer conflicts with the CLI's canonical root. Actual child and queue handoff
passes; a junction alias is accepted and different canonical roots still reject.

The receipt and source-preview fixtures use Windows directory junctions so their
redirection checks run without symlink privilege. POSIX file-symlink coverage is
retained. One trailing space in a service fixture was removed.

## Bounded native Windows evidence

Node 26.8.1 `npm run bootstrap:ci` completed, including required patches, native
rebuild/verification and the readiness receipt. The inherited unavailable
trusted-config override was replaced only in validation processes with an empty
task-owned external config; production authority rules were preserved.

The exact selected fixture set comprised 37 changed cases and eight supporting
embedding/capability cases. After the environment and integration corrections,
44 distinct cases passed. Five directly affected plan/receipt/intent/service
cases passed again after the canonical-root repair. Commands used the shared
runner with `--lane all`, exact per-ID selectors, `--jobs 1`,
`--timeout-ms 30000 --retries 0 --native-status-redo=false`.

`indexing/build/stage4-explicit-index-root-no-promotion` remains failed: Windows
exit `3221225477` (`0xC0000005`, STATUS_ACCESS_VIOLATION) after 10.1 seconds.
Its last captured marker was `[cleanup] runtime.worker-pools.destroy start` after
the first tiny stage2 build. This is not a native stack or proof of the faulting
module. No retry, alternate backend or native crash campaign was used.

Local `.testLogs` receipts are historical author-workspace evidence, not promised
clean-checkout artifacts. The failure is retained at
`.testLogs/run-1791777738590-8bgt7x/indexing_build_stage4-explicit-index-root-no-promotion.attempt-1.failure.json`.
The publication gate and hosted CI are separate records in the draft PR.

Smaller Worker heap caps under a larger parent old-space cap still require the
existing Piscina tokenize/quantize inline fallback. Process isolation remains
follow-on work; provider dispatch is unchanged. No full Windows/MSIX,
SSR-corpus, real-model, performance or release-wide acceptance is claimed.
