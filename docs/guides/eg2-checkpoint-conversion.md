# Explicit EG2 checkpoint copy conversion

This tool converts a **closed, separately selected v1 checkpoint** to the current
v2 schema. It performs no inference. Do not select the active CPU index while its
writer is running. A refresh timeout does not establish that native inference or
the writer stopped.

1. Obtain explicit authorization to stop the selected writer. Wait for native work
   and disposal to settle, close SQLite, and record a stopped-writer receipt. The
   source must have no WAL, SHM or rollback-journal sidecars; do not delete these to
   bypass the guard. Create a clean closed checkpoint through the writer's approved
   checkpoint procedure instead.
2. Hash the closed source database, its checkpoint receipt and the verified model
   artifact receipt. Prepare an evidence JSON with the fields below. Receipt hashes
   bind the retained evidence files; the caller's attestation binds them to this
   checkpoint's provenance. This tool does not infer that arbitrary receipt contents
   prove writer shutdown.
3. Select a distinct, nonexistent destination in the approved task directory.
   The source is opened read-only and copied with SQLite backup. Conversion is
   atomic in the destination. Source SHA256 must match before and after backup
   and after conversion. All non-embedding table contents, archive generation,
   original unit IDs and snapshot/citation references are fingerprinted and preserved.
4. Review the destination's adjacent `.conversion.json` receipt before authorizing
   a runner to select it. Changing an active runner or its manifest is a separate action.

Example evidence (replace all paths and source/receipt hashes with verified values):

```json
{
  "schema": "history-eg2-conversion-evidence.v1",
  "writerStopped": true,
  "stoppedWriterReceipt": "Reference and explanation of the confirmed closed writer",
  "sourceSha256": "<closed database SHA256>",
  "checkpointReceipt": {"path": "<checkpoint receipt>", "sha256": "<receipt SHA256>"},
  "modelArtifactReceipt": {"path": "<model artifact receipt>", "sha256": "<receipt SHA256>"},
  "graphSha256": "bc47de15f81208a5c99e5ab10f746d5e33b51ea228b7dc0bef9c133a94f1c1c3",
  "tokenizerSha256": "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4",
  "numericalRecipe": "published-fp32"
}
```

```powershell
& 'C:\nvm4w\nodejs\node.exe' tools/history/eg2-convert-checkpoint.js --source '<closed.sqlite>' --destination '<new.sqlite>' --evidence '<evidence.json>' --models-dir '<approved model cache>' --writer-stopped
```

Only the immutable `onnx-community/embeddinggemma-2-ONNX` revision
`daa72c51243991dfcaf9f9137d2c573d8f7790c0`, Transformers.js 4.3.1, published
fp32 full-768 vectors qualify. The tool verifies the v1 identity hash, exact
profile/prompts/chunker, unit text hashes, span geometry, finite normalized vectors,
and completeness. It derives document identity using the current resolver and
complete effective passage input using the exact prefix plus span text. Stored
vectors are copied byte-for-byte, never truncated or recomputed.

Every source occurrence retains its unit ID and span offsets. Complete units remain
complete; partial units remain partial with their expected span counts. Identical
effective inputs reuse a full vector only when their stored bytes agree. Conflicting
vectors are rejected rather than discarded: inspect them and choose an explicitly
authorized recovery approach separately.

A failure after backup leaves the destination for inspection; never treat it as
accepted without a successful receipt. Failed conversion rolls back its schema
transaction. No source, model, log or failed destination is deleted. No runtime
v1 fallback is installed. The focused test uses synthetic vectors and fresh databases
only: `node tests/integrations/inference-history/eg2-checkpoint-conversion.test.js`.
