# Stage3 cache-only execution

Stage3 can avoid constructing a model when its asynchronous artifact verification
has established the complete selected graph/tokenizer or qualified immutable
profile identity, processing/format/quantization identity and exact dimensions,
and every selected input in every requested mode has complete matching cache
coverage. The preflight reads current canonical chunk artifacts, exact manifest
source hashes and ordered chunk signatures. It decodes file cache rows and, for
reference entries, verifies the referenced channel lengths and content digests
under the existing cache coordination owner. A matching index pointer or file
timestamp alone is insufficient.

The preflight retains one mode's compact metadata and one decoded file at a time.
It stops conservatively above 2,048 files, 131,072 selected chunks or 64 MiB of
verified vector payload. Bundle-only fallback, absent source hashes, unknown
dimensions/artifacts, malformed payloads, partial required channels and budget
overflow select the ordinary provider probe. Documentation absence is permitted
only when the corresponding chunk has no nonblank documentation; a present
all-zero vector remains present. Canonical artifact loading and the ordinary
bootstrap/readiness rules remain in force.

A non-stub attempt that cannot prove all-cache coverage probes before choosing
cache directories or accepting cached rows. Effective provider fallback and
dimensions then rebuild the complete cache identity for every mode. Successfully
planned rows are never mixed with vectors selected under a late fallback.

The cache-only runtime has no native constructor, tokenizer, session or loading
getter. If a cache entry or input changes between preflight and consumption, the
attempt fails with `ERR_EMBEDDING_CACHE_ONLY_INVALIDATED`; the next explicit
attempt re-plans coverage and probes if needed. Cancellation remains cancellation.
This fail-closed race handling prevents a late provider change after some cache
rows have been accepted. It does not claim a filesystem snapshot across modes.

Durable runtime receipts use `cache-only` / `validated-cache-reuse`, retain the
selected identity, and leave current provider/dimensions observations unset.
`providerMeasurement.execution` reports `loaded:false`, `cacheOnly:true`, and no
effective native-thread observation. `stage3.cachePreflight` records eligibility,
refusal reason and checked modes/files/chunks/vector bytes. This evidence does
not establish current native availability or a successful model load.

Source-authored inert-provider fixtures cover zero constructor/inference calls,
single misses, unknown dimensions, tokenizer changes, fallback identity, exact
channel absence and cancellation. They have not been executed for this change.
Real-model cold-process latency, verification IO, peak RSS and disposal/native
qualification remain open; no measured startup improvement is claimed.
