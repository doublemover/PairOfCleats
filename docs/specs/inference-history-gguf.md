# Qualified EG2 GGUF archive preparation

This adapter is an explicit, separately qualified runtime, not a replacement for the
active CPU ONNX archive. The factory is in
`src/integrations/inference-history/gguf-embedding-runtime.js`. It never loads a model,
downloads a runtime, changes devices, starts a server, or writes an index. Use a separate
trial database and reference-quality receipt before integration or promotion.
Canonical status and remaining work belong in [the roadmap](../roadmap.md).

## Compatibility gate (research checked 2026-10-09)

[llama.cpp PR30054](https://github.com/ggml-org/llama.cpp/pull/30054) merged EG2 support
as upstream `4fbc76d` on October 6. The
[model implementation](https://github.com/ggml-org/llama.cpp/blob/master/src/models/gemma-embedding2.cpp)
sets noncausal attention and implements the learned output projection. This establishes
architecture availability, not runtime parity, speed or Windows GPU stability.

The [LM Studio 0.4.26 changelog](https://lmstudio.ai/changelog/lmstudio) advertises
llama.cpp 2.50.0 / upstream b11337; it does not establish a later compatible engine.
Require evidence that the selected exact Windows runtime contains the EG2 merge
or an identified equivalent backport. An application version, generic GGUF support,
or a first-generation EmbeddingGemma model listing is insufficient.

No `lms` executable was discovered in the approved task paths. The installed app,
CLI and actual runtime compatibility remain unverified. Personal installation/config
directories were not searched. No real LM Studio embeddings, loads, downloads,
server changes or GPU probes were performed.

The [SDK embedding array implementation](https://github.com/lmstudio-ai/lmstudio-js/blob/main/packages/lms-client/src/embedding/EmbeddingDynamicHandle.ts)
fans out separate requests and its dynamic handle can resolve to another instance
after reload. This adapter instead admits one string per HTTP request and one
embedding request at a time. It never calls SDK `embed(array)`.

## Qualification contract

`resolveGgufQualification(manifest)` requires every field below and rejects unknown
fields. A real receipt is required; do not fill unsupported facts with placeholders.

| Field | Required evidence/value |
| --- | --- |
| schema | `history-eg2-gguf.v1` |
| endpoint | Explicit numeric loopback HTTP origin, e.g. `http://127.0.0.1:1234`; no credentials, path, query or redirects |
| alias, instanceId | Exact owned, exclusively reserved loaded model alias and instance |
| deviceIdentifier | Explicit `null`, verified locally; rejects LM Link/remote identity |
| ggufSha256, tokenizerSha256 | Verified artifact and exact tokenizer SHA256 |
| engineBuild, engineCommit | Exact engine build and full upstream/backport commit |
| supportEvidenceSha256 | Hash of retained engine support/lineage evidence |
| qualificationReceiptSha256 | Hash of retained reference parity and retrieval-quality receipt |
| precision | Qualified `bf16-fp32-accumulation` or `q8_0-qualified` |
| backend | Actual verified backend; CPU/GPU cannot be inferred from URL |
| architecture | `gemma-embedding2` |
| pooling | Verified `native-eg2-mask-aware-pooling` |
| projection | Verified `native-eg2-learned-768` |
| dimensions | Full `768`, never raw 512d hidden states |
| passagePrefix | Exact `title: none | text: ` |
| queryPrefix | Exact supported search/code/question-answering prefix |
| tokenizerPolicy | `exact-prefixed-input-with-special-tokens-no-truncation` |

`createQualifiedGgufEmbeddingRuntime(manifest, dependencies)` requires:

- `verifyLoadedInstance({signal})`: a trusted local verifier returning all pinned
  manifest fields from hash/engine/instance evidence. Check immediately before and
  after each request. An alias listing or `/v1/models` alone cannot prove this.
- `countTokens(input)`: a synchronous qualified local tokenizer, including the
  prefix and special tokens. A character estimate and remote dynamic-model tokenizer
  are insufficient. Do not silently truncate long source text.
- Optional `fetchImpl` and narrower `bounds`, chiefly for deterministic fixture tests.

The host must reserve the alias, prevent concurrent reload/rebinding during a request,
and establish endpoint ownership. Pre/post checks detect a changed instance but cannot
prevent a malicious or concurrent swap-and-restore. Loopback alone does not establish
local inference because LM Link can relay work remotely.

`encodeBatch(texts, {signal})` returns one full Float32 vector per input in original order.
`encodeQuery(text, {signal})` returns one full Float32 vector. Whitespace and Unicode
are preserved exactly; only the configured prefix is added. No chat template, newline
replacement or `dimensions` parameter is sent. Responses must match alias, contain
exactly one index-zero vector, be finite, 768d and normalized within 0.001 of unit norm.

Config separates `documentIdentityKey`, `queryIdentityKey` and
`representationIdentityKey`. Query-prefix changes retain document computation identity.
GGUF/backend/engine/tokenizer/precision/pooling/projection changes create a distinct
document space. It cannot append to ONNX vectors merely because dimensions agree.
All evidence/source occurrence mapping, authorization, generation checks and atomic
durable writes remain responsibilities of the archive host.

## Admission and uncertain execution

Defaults, which can only be narrowed:

| Bound | Value |
| --- | ---: |
| Inputs including active and queued | 64 |
| Prefixed queued characters | 65,536 |
| Queued tokens including special tokens | 32,768 |
| Tokens per complete input | 2,048 |
| UTF-8 JSON body | 65,536 bytes |
| Response stream | 65,536 bytes |
| Request/preflight/output deadline | 60,000 ms |
| Embedding requests in flight | 1 |

Response streaming is bounded before JSON parsing. Redirects are rejected. Cancellation,
transport errors, malformed outputs or instance changes after dispatch stop further
admission. Timeout is explicitly uncertain native execution: the HTTP abort does not
prove server/GPU inference stopped. A timed-out request is never automatically retried
and queued requests are rejected. There is no automatic reset method; diagnose and
prove the previous request is no longer active before constructing another runtime.
`admissionStatus()` reports poisoned state and queue reservations; `active:false`
after an uncertain timeout refers to client work, not a claim about native termination.

## Future operator flow, not commands executed by this change

The active indexing run stays CPU-only. These preparation commands are read-only,
but locating/reading an installed CLI outside approved paths needs owner authorization:

```powershell
lms version
lms get --help
lms load --help
lms runtime ls
lms runtime get llama.cpp --list --channel stable
lms ps --json
```

Use the exact installed help and runtime catalog. Stop if engine support cannot be
proven. [Runtime CLI](https://lmstudio.ai/docs/cli/runtime/runtime) and
[catalog source](https://github.com/lmstudio-ai/lms/blob/main/src/subcommands/runtime/get.ts)
document the listing flow. Do not select `--latest` indiscriminately.

After separate download/runtime-selection approval, copy an exact compatible
`name@version` from the catalog and select that runtime. Verify the GGUF artifact
against an explicit repository revision and SHA256 before import/load. The known
[ggml-org EG2 conversion revision](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/tree/bfcd298762cc34d0357ece5ebdd31791a3a374d8)
contains text-only BF16 and Q8_0 candidates; it is a maintained conversion, not
a Google-published GGUF. Do not claim an `lms get` convenience URL pins a revision.
Text-only use does not require mmproj media weights.

After compatibility and a separate execution window are approved, a CPU-only initial
estimate/load flow is:

```powershell
# Obtain the exact model key and verify artifact/engine evidence first.
lms ls --embedding --variants
# Substitute the verified model key; do not paste an invented key.
lms load '<verified-model-key>' --local --gpu off --context-length 2048 --estimate-only
# Stop on failure. Only after load authorization:
lms load '<verified-model-key>' --local --gpu off --context-length 2048 --identifier 'poc-eg2-trial' --ttl 3600
lms ps --json
```

`--local` is supported by the audited current CLI source but may be hidden from help;
verify its availability in the actual installed version. If unavailable, resolve
local-only identity explicitly before sending archive text. Context allocation is
not permission to truncate; token admission must enforce coverage-preserving spans.

[Load documentation](https://lmstudio.ai/docs/cli/local-models/load) exposes GPU offload,
context, identifier, TTL and estimates. No verified embedding `--threads` or
`--batch-size` CLI flags are introduced here. Advanced engine settings may exist;
inspect the selected engine/effective settings rather than borrowing LLM KV recipes.

Only after server ownership and execution authorization, start an exclusively owned
loopback endpoint, retain private runtime logs and use one short public input with
[POST /v1/embeddings](https://lmstudio.ai/docs/developer/openai-compat/embeddings).
Preserve existing authentication policy; this preparatory adapter deliberately does
not discover credentials. Authenticated deployment needs an explicitly reviewed host
integration, not personal-config reads.

Verify full projected output, reference cosine/ranking quality, actual local backend,
safe unloading and recovery before private corpus work. One finite vector is not
qualification. Use a separate trial database. Future GPU work is not authorized by
this CPU-only preparation: no DirectML/WebGPU fallback, driver/TDR/security change,
or automatic retry after native timeout/device loss.
