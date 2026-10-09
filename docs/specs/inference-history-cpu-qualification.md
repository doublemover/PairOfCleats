# Archive EG2 CPU graph qualification

These tools operate on a dedicated trial directory and its own qualification.sqlite
receipt ledger. They never open an archive collection or write live embeddings.
The ongoing pinned FP32 CPU index keeps its checkpoint, 768d vectors, prompts and
original chunk coverage.

## Evidence and numerical recipe

Pinned export revision: daa72c51243991dfcaf9f9137d2c573d8f7790c0 in
[onnx-community/embeddinggemma-2-ONNX](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/tree/daa72c51243991dfcaf9f9137d2c573d8f7790c0).

The audited published q8/q4 graphs have com.microsoft::MatMulNBits, block size32,
and no accuracy_level attribute. ORT1.30 defaults that attribute to zero.
Source predicts unchanged W8 can fall back to unpacked FP32 computation, while
level4 requests an available activation-quantized kernel. This is **source
inference, not measured dispatch or a speedup**.
[CPU implementation](https://github.com/microsoft/onnxruntime/blob/v1.30.0/onnxruntime/contrib_ops/cpu/quantization/matmul_nbits.cc),
[MLAS variants](https://github.com/microsoft/onnxruntime/blob/v1.30.0/onnxruntime/core/mlas/lib/qnbitgemm.cpp).

A separately hashed q8 derivative with accuracy_level=4 requests W8A8.
A q4 derivative requests W4A8. Both change the numerical recipe; neither may reuse
FP32 vectors by assumption. Start with one W8A8 pilot; W4A8 requires a subsequent
decision informed by quality/profile. Ordinary FP16 is unsuitable for EG2 activation
range. Lower output dimensions are a separate storage/search experiment.

## Offline/source commands

Run from the repository with existing Node/dependencies. These commands never
download or run inference. Use approved task roots; retain sources/receipts.

- node tools/history/eg2-qualify.js init --trial-root <NEW-directory> --identity <JSON>
- node tools/history/eg2-qualify.js inspect --trial-root <dir> --graph <dir>/model/onnx/model_quantized.onnx --output <dir>/q8-graph-report.json
- node tools/history/eg2-qualify.js patch-nbits --trial-root <dir> --graph <dir>/model/onnx/model_quantized.onnx --output <dir>/model/onnx/model_w8a8.onnx --expected-sha256 <pinned-source-hash> --receipt <dir>/verified-external-data.json

Identity fields: provider:"cpu", modelRevision (40hex), modelSha256 (the single pinned
external-weight SHA256 for the first pilot), tokenizerSha256, graphSha256,
runtimeVersion, dtype (e.g. w8a8-nbits-level4), dimensions:768, maxLength:8192,
exact documentPrefix, exact queryPrefix and chunkerIdentity.
Runtime identity: transformers.js@4.3.1/onnxruntime-node@1.30.0.

Stage official pinned q8 graph and every file named by TensorProto.external_data.location,
verified against official pinned metadata size/hash. Stage canonical tokenizer/config
files with hashes. Do not infer external filenames solely from dtype and do not
replace the active FP32 model cache. External receipt:
{"externalData":[{"location":"exact-graph-location","bytes":123,"sha256":"64hex"}]}.

The derivative accepts only W4/W8 NBits nodes, changes only the accuracy attribute,
preserves unknown protobuf fields and external-weight references, streams weight
hash checks, and refuses source overwrite, missing verified weights, path escape
and symlinks. Receipt records source/derivative graph hashes. The execution
trial marker must identify the actual derivative; create a new execution directory
if source discovery preceded its hash.

The wire inspector supports ModelProto/GraphProto/NodeProto, nested attribute graphs
and tensor external metadata. Limits:64MiB graph,16 nested graphs,100,000 nodes.
It preserves unknown wire fields, but is not a full ONNX semantic validator.
It never loads tensor payloads or implements quantization conversion. Classic
dynamic INT8/QDQ requires a separately authorized declared toolchain and quality work.

## One explicitly coordinated CPU pilot

node --max-old-space-size=8192 tools/history/eg2-qualify-run.js --run --trial-root <dir> --manifest <dir>/cpu-execution.json

Without --run this only prints help. Coordinate resource headroom before running;
do not interrupt the active index. Fixed first pilot:CPU,2 intra-op/1 inter-op
threads,sequential,no spinning,one inference call at a time,batch4,cooperative
budget at most120seconds. No GPU fallback, worker fan-out, software install or retry.

Execution manifest:
{"schema":"eg2.cpu-execution.v1","modelDirectory":"<absolute-trial-model-dir>","samples":"<absolute-samples-JSON>","artifacts":[{"path":"config.json","sha256":"..."}],"batchSize":4,"maxMillis":120000}

Artifacts enumerate exact staged config/tokenizer/derivative/external files and hashes.
Checks happen before loading. First pilot requires one .onnx_data file matching
modelSha256; tokenizer/graph hashes must match the marker. Actual Transformers.js
and ORT versions are checked and recorded.

Local/offline,text-only AutoModel uses model_file_name:"model_w8a8", loader
dtype:"fp32". Here fp32 controls the empty filename suffix; **it does not convert
the verified W8A8 graph to FP32**. use_external_data_format:false prevents the
wrapper inventing a renamed weight file. Node loads the graph from its local path
and ORT resolves its original adjacent external references. Existing prepared
encoder preserves canonical pooling/projection and normalized sentence output.

Choose32-64 representative spans initially under live CPU load; hard bounds are
192documents,24queries,4,000characters per text. Inputs over8,192 actual tokens
are rejected before truncation. Include prose/code/metadata,short/typical/long
inputs,dense identifiers,multilingual text and difficult negatives. Preserve source
occurrence IDs/citations; do not drop generated content to improve timing.

Sample fields:

- documents:[{id,text}], queries:[{id,text}], k, judgments:{queryId:{documentId:grade}} (grades0..4).
- reference:{identity,documents:[{id,effectiveInput,vector}],queries:[{id,effectiveInput,vector}]} with qualified FP32 outputs.
- Reference exact effective text,prompts,tokenizer,revision,max length and768d must match candidate. Query vectors are required; saved hit scores are insufficient.
- Candidate query/document backend pairing is evaluated together. Do not compare candidate documents only against reference queries.

Reuse existing qualified vectors rather than repeating the corpus. Receipt is
saved before load and updated at each batch/lifecycle stage:exact configuration,
artifact hashes,token/padding/inference/output metrics,finite vectors,quality,
completion and clean disposal. Successful paired outputs are cpu-trial-outputs.json;
receipts append only to dedicated qualification.sqlite. Timing with live indexing
is explicitly **contended**, not evidence of uncontended speedup.

## Optimized operators and quality

Session creation enables profiling with a private prefix and saves optimized-model.onnx.
After bounded work the encoder calls session.endProfiling(). Preserve the profile
even if Node returns no filename. Logs may contain sensitive inputs; keep them private.

- node tools/history/eg2-qualify.js inspect --trial-root <dir> --graph <dir>/optimized-model.onnx --output <dir>/optimized-operators.json
- node tools/history/eg2-qualify.js profile --trial-root <dir> --profile <dir>/<ORT-profile>.json --logs <dir>/<private-log> --output <dir>/profile-summary.json
- node tools/history/eg2-qualify.js quality --trial-root <dir> --samples <dir>/cpu-trial-outputs.json --output <dir>/quality-summary.json

Profile summary groups observed Node operators/providers,calls,durations.
Durations can overlap; their sum is not wall time. NBits unpacking/dequantization
fallback messages remain diagnostics. A MatMulNBits event does not prove W8A8;
absence of fallback messages is inconclusive. Inspect optimized graph,provider
and source-specific INFO logs together. Profiling has overhead; disable it in
separately authorized timing runs.

Quality reports norm ranges,document/query cosine drift median/p95/max,top-k
overlap and judged Recall@k,MRR@k,nDCG@k. Unjudged metrics are null, not fabricated
scores. Reject nonfinite/zero vectors,dimension/coverage mismatches and excessive
comparison work. Product thresholds and held-out judgments must govern promotion;
no automatic live-index switch exists.

## Cancellation and durability

Deadlines are checked at native batch boundaries. Late native results do not
commit accepted samples. Timeout/cancelled Promise does not prove native work
stopped. Never retry automatically, admit overlapping work,kill unrelated processes
or change drivers/security/TDR settings. Disposal is not a driver recovery guarantee.

Failed receipts preserve error/disposal-start/completion markers where possible.
Missing completion is inconclusive; diagnose before retry. Trial ledger retains
DELETE journaling and secure deletion. This is not a live checkpoint migration.

Focused tests use tiny wire fixtures,synthetic vectors and a mocked model loader
for hash/field preservation,metrics,exact input pairing,CPU settings,lifecycle
and trial isolation. They **do not establish** real W8A8 speed,dispatch,relevance
or stability. See docs/roadmap.md for execution status.

## First Windows CPU pilot (October 9, 2026)

The isolated pinned q8 graph derivative SHA256 is 903fc9c1df518dc50e0f2c12765203e31386754a3c6afd3c231c463e9af6ac0e;
146 MatMulNBits nodes request accuracy_level=4.
A single real run used the exact locked runtime, CPU 2 intra-op / 1 inter-op,
sequential, spinning off, batch four, concurrency one. It encoded 32 document
spans from the closed 11-unit acceptance database and two exact-input query pairs.
All outputs were finite normalized full768 vectors. Maximum cosine drift against
FP32 was 0.0001551049298166296 for documents and 0.00014406730064486784 for queries;
top-10 overlap was 100%. There were zero held-out judged queries, so relevance
metrics remain null and no production promotion is established.

Elapsed candidate time was 66.1669 seconds under live CPU indexing load and with
profiling enabled; it is not an uncontended performance result. The optimized
graph and CPUExecutionProvider trace retained MatMulNBits and MatMul. Operator
labels and absent fallback log messages do not prove a specific integer kernel.
No W4, GPU, LM Studio load or full-index restart occurred.

The initial reference-query loader stopped before inference because offline
model-ID cache resolution failed. That failure receipt was retained. Loading the
verified absolute local model directory then completed the reference query phase;
no native candidate retry occurred. Original source DBs and pinned cache were
unchanged; trial outputs and ledger reside in the separate named task directory.
