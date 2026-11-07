# ONNX execution-profile experiments

The normal ONNX configuration and conservative defaults remain unchanged.
`tools/bench/embeddings/onnx-execution-profile.js --qualify` is an explicitly
requested, bounded real-provider experiment. It runs one candidate case in the
existing subprocess supervisor with a 28s child deadline, zero retries and no
in-process fallback. It requires normal bootstrap readiness and locally verified
model/tokenizer bytes; its tokenizer acquisition does not download missing assets.

A candidate can choose `--intra-op`, `--graph`, `--arena`, `--mem-pattern` and
`--sessions` (one or two), with `--threads` selecting the existing effective CPU
envelope. Inter-op stays1 and execution stays sequential. The product of requested
intra-op threads and independent sessions cannot exceed that envelope. This is a
requested admission bound, not a claim that native thread count was observed.
Large graph or external-weight closures retain conservative arena/pattern and
basic/disabled graph safeguards; an unaccepted experiment cannot weaken them.

The process-local qualification capability binds exact artifact closure, model
path, ONNX package/Node/ABI/platform, source hashes, normalized session settings,
normalization/pooling/truncation, workload digest/batch shape and CPU/memory policy.
It cannot be deserialized as a production profile. Every experimental session has
a distinct native cache key, queue and scratch owner. Candidate construction errors
fail the case rather than silently measuring a retried conservative session.

Trying two sessions additionally needs `--memory-evidence` from a completed real
single-session experiment of the same model/runtime/source/settings/workload and
resource policy. The checksummed evidence must confirm disposal, be at most30min
old, and charge both measured session footprints within one quarter of current
headroom. Unknown, stale, modified, mismatching or nonpositive evidence refuses
the pool before native construction. Inert fixtures cannot mint this evidence.
Sampled process RSS also limits a running case against current headroom; the child
supervisor owns termination when an in-flight native call cannot cooperate.

Each case measures a fresh conservative reference session followed by the
candidate, using mixed-length/empty/Unicode/code texts and bounded batches/rounds.
It checks stable batch association, finite dimensions, coordinate error and
sampled top-k/score drift. It records construction, warmup, end-to-end inference,
queue/provider work, process CPU, sampled peak RSS, process-lifetime high-water
RSS, post-disposal retained RSS and process thread inventories. Candidate OS page
cache is explicitly uncontrolled after the reference; sampled peaks are not an
exact native allocation bound. Provider thread attribution can remain unavailable
on Windows or other unsupported hosts.

Output is `observed-unaccepted`, `accepted:false`, `activation:none`, including
negative performance/parity results. No profile is written into normal config or
autotune recommendations. `--out` writes a new explicit report file. Changing a
default requires separate reviewed evidence; synthetic timings, requested thread
counts and a successful constructor alone do not qualify a profile. Longer models
that cannot complete within the existing case limit remain unqualified.

Startup and teardown release acquired session then tokenizer ownership in reverse
order and preserve primary errors while attempting every cleanup. An unconfirmed
release retains the actual session owner and qualification capability on the error;
it does not free an admission slot or claim disposal success. The subprocess
supervisor's pending termination evidence remains authoritative across timeout.

The source-authored capability and inert lifecycle fixtures are unrun. Actual
native memory, numerical/recall, process cancellation and profile throughput
qualification remain open; no new default or measured optimization is claimed.
