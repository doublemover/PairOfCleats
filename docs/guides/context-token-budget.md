# Exact rendered context token budgets

`renderedTokenBudget` is an optional CLI/HTTP/MCP context-pack request field.
The CLI accepts it as one JSON string, `--renderedTokenBudget '<json>'`.
Absent preserves existing behavior. Example (replace the two hashes with the
SHA-256 identities of your actual, local files):

```json
{
  "schemaVersion": 1,
  "maxTokens": 8192,
  "reservedTokens": 512,
  "rendering": "context-text-v1",
  "profile": {
    "id": "my-target-tokenizer",
    "revision": "0123456789012345678901234567890123456789",
    "directory": "models/my-tokenizer",
    "tokenizerSha256": "<64 lowercase hex digits>",
    "configSha256": "<64 lowercase hex digits>",
    "addSpecialTokens": true,
    "engine": "huggingface-tokenizers-0.2.0-v1"
  }
}
```

The request requires an explicit selected repository. The profile directory must
be inside that repository; fixed `tokenizer.json` and `tokenizer_config.json`
inputs are verified through the contained-file owner against their actual
descriptor bytes and expected hashes on every invocation, including cache hits.
Profile ID/revision identify the caller's declared target; the hashes identify
the bytes actually used. No model inference, download or executable tokenizer
code is loaded. Shared/external profile directories are unsupported.

The pinned pure JavaScript `@huggingface/tokenizers` 0.2.0 engine encodes the
response's `renderedContext` string. This is the existing context text renderer
plus exactly one final newline, including labels, provenance, delimiters and
verbatim source. Special tokens follow the profile's explicit setting (default
true). Explicit WordPiece, BPE and Unigram JSON pipelines are supported; unknown pipelines,
invalid IDs, padding, truncation and sampling configurations fail explicitly.
There is no chat-template expansion. This envelope excludes the token receipt,
JSON/SARIF transport decoration, semantic records available only in JSON, and
external system prompts/tool wrappers. Callers that send additional content must
reserve its independently known overhead. Counts are exact for this declared
engine/envelope, not a claim of equivalence with every target service tokenizer.

`tokenAccounting` reports the profile, engine, rendering, source-payload hash,
rendered hash/byte count, rendered tokens, reserved tokens, admitted total and
limit. Payload or rendered-text mutations invalidate that receipt. Both exact
tokens and the independent 128 KiB complete-response limit must fit. The byte
limit includes the attached string/receipt and CLI JSON decoration. Counted
responses are never pruned afterward. The existing `maxTokens` option continues
to govern approximate excerpt admission; it is not this exact final-envelope cap.

An intact file/function unit remains intact. If the selected context cannot fit,
`ERR_CONTEXT_PACK_TOKEN_BUDGET` (413) is returned. Byte overflow uses
`ERR_CONTEXT_PACK_RESPONSE_BUDGET` (413). Invalid request/profile fields use
`ERR_CONTEXT_PACK_INVALID_REQUEST` (400); unavailable/unknown profiles or bounded
counting use `ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE` (422). There is no estimated
fallback or successful partial count. Caller cancellation retains its abort
contract and original resource obligations.

One worker counts at a time with at most four active/queued calls. Input limits
are 128 KiB rendered text, 16 MiB tokenizer JSON and 512 KiB configuration JSON;
profile traversal admits at most 262,144 values and 65,536 pending fields;
the worker requests 256 MiB old/32 MiB young V8 generations and acknowledges the
existing heap contract. Incompatible parent heap flags fail explicitly. These
are input/V8 bounds, not a measured peak-RSS guarantee. The count deadline is
at most 10 seconds (also bounded by remaining request time), with bounded
destruction/termination. Unconfirmed original reads/workers remain retained and
block later counting until their actual observations settle. No inline fallback
or crash-status retry runs.

An internal invocation may count at most 128 serial envelopes, with one verified
profile and one lazily initialized worker. Identical local counts reuse bounded
scalar scratch; the tokenizer stays only in that invocation's worker and is
disposed before publication. Ignored accepted operations are joined, failures
remain failures, early publication/retired/nested invocations reject explicitly,
and cancellation starts original worker teardown. The ten-second deadline bounds
the entire invocation. This supports bounded selection trials without repeated
profile loading; it makes no measured latency claim.

The in-process cache holds at most 512 scalar counts and SHA-256 keys, without
source strings or tokenizer objects. Keys cover exact rendered bytes, profile
hashes/settings/revision, engine/rendering and task/budget policy. Publication
requires completed counting, confirmed worker exit, final fit, validation and
uncancelled request. No failed or incomplete request publishes a count.

Source implementation and authored controls are recorded separately from actual
qualification. Cold/warm latency, assembly p95 and supported-profile/corpus
qualification remain pending; no speed or model-quality improvement is claimed.
