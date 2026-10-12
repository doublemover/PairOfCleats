# Runtime configuration boundaries

Configuration previews resolve a new invocation. They do not identify a live
producer. Path resolution never creates or purges cache directories, including
when `PAIROFCLEATS_CACHE_REBUILD` is inherited. The build owner consumes rebuild
intent once under the selected repository's existing index lock; the normal
build stages subsequently reacquire their existing locks. This is not a lock
held for the entire build. An explicit `--no-cache-rebuild` or
`--cache-rebuild=false` overrides inherited rebuild intent.

## Embedding selection and handoff

The shared embedding-intent resolver applies these rules:

- Environment `off` (including false/0/disabled/none) disables every embedding
  entry point. Configuration `enabled:false` or `mode:off` also disables work.
- Explicit stub/configured execution modes bypass an automatic policy's
  optional embedding disable, but never the disable rules above.
- Environment stub selects stub execution. A service worker consumes service
  intent as inline execution; it does not enqueue itself again.
- Disabled paths do not initialize a provider, create its model directory, or
  enqueue stage3 work.

New stage3 children and embedding queue jobs carry a versioned execution plan
in the existing observability context and queue payload. The plan is bounded to
32 KiB and allowlists model/provider/dimensions, normalization, quantization,
ONNX/EG2 selections, models directory, modes, pinned index root, known build ID,
thread/scheduler requests, sampling intent, and source labels. It includes the
original selection time and a resolved-plan digest. Selection time is metadata
outside the semantic digest. The digest is a consistency check, not a signature
or permission grant, and is separate from embedding cache identity.
Nested fields are validated against the existing resolver projections and the
handoff schema before application, even when a caller recomputes the digest.
Raw arbitrary config, argv, and environment fields are never copied into a plan;
selected numeric/boolean environment requests are normalized before storage.

The child rejects a changed/missing required plan, mismatched repo/root/mode, or
explicit CLI option disagreement before provider work. Model and resource CLI
options are also forwarded normally, including explicit false scheduler flags.
Queued jobs preserve submission-time selections even if model configuration is
edited before execution. The child also retains the configuration source facts
it actually examined at execution. Legacy jobs without a plan continue to
resolve configuration at execution and must not be described as pinned.

Admission is still owned by the existing scheduler. Host limits, learned
autotune recommendations, queue activity, and native runtime observations can
change at execution. The plan's resourcePolicy marks that distinction. It is
not evidence of provider loading, parallel inference, or observed native thread
counts. Prewarm text is excluded from persisted plans.

## Loader and service evidence

`loadUserConfig(repo, {env, onSources})` preserves the existing return value and
optionally reports facts from the exact reads it performed: repository and
trusted-external files, existence, content hash where safe, repository trust,
discarded authority field paths without values, trusted merge, and gated test
overlay origin. It does not persist raw config or environment. Sources containing
secret-bearing fields or credential-bearing text omit their content hash and
record `sensitive-source`, rather than hashing secrets.

The service cache's last-validation time is independent of access/LRU time.
Repository and trusted-external file identity includes device/inode/size and
nanosecond mtime/ctime, so a same-mtime replacement still invalidates the cache.
Trust-policy changes invalidate the selection immediately. Each launch resolves
startup settings against its final base environment plus job overlay; the cache
does not replay an old environment patch over explicit NODE_OPTIONS or UV input.

The stage3 scheduler accepts rawEnv separately from normalized envConfig.
Runtime logging is configured before path-decision lines; existing log context
is enriched once the build ID is known, without replaying or duplicating lines.
