# ONNX output and pooling qualification

The ordinary ONNX runtime inspects output metadata from its exact loaded session.
For an unambiguous preferred floating tensor of rank2 or rank3 it requests only
that named output using the pinned `InferenceSession.run(feeds, fetches)` API.
Preference remains sentence_embedding, embeddings, pooler_output,
last_hidden_state, then output_0. Unknown names, metadata, ranks or dtypes retain
the generic all-output path. A selected-fetch failure propagates unchanged and
never triggers a second inference. The session lease already binds graph and
tokenizer bytes; this selection does not introduce a different embedding space.

Rank2 sentence outputs remain the fast baseline. Rank3 host pooling retains the
existing sequential Float32 assignments, counts nonzero attention-mask positions
equally, excludes masked values, and produces zero vectors for zero-mask rows.
Output arrays own their storage. Shape, width/count and unsupported explicit
dtypes fail before publication rather than silently fabricating a vector.

Session measurements separate logical fetched tensor bytes/output counts,
selective versus generic runs, values read by conversion, rank2 versus host-pooled
rows, conversion wall time and process CPU deltas. Logical bytes do not establish
actual host/device transfer. Process CPU deltas can include concurrent process
work. End-to-end time still includes token preparation, queue wait, native work
and conversion; `session.run` time alone is insufficient.

`tools/experiments/embeddings/fuse-onnx-pooling.py` authors a separate, explicitly
unqualified graph prototype. It requires a caller-supplied exact source SHA256,
new output files, an embedded FP32 graph below 256MiB, supported opset13..17,
rank3 preferred output and rank2 attention mask. It uses boolean mask selection,
token reduction/counting, a safe zero-mask divisor and optional L2 normalization.
It preserves the original graph outputs and adds a preferred sentence output.
It refuses existing rank2 fast paths and unqualified external-data rewriting.
It does not install Python packages or activate a model.

Its sidecar binds source and transformed graph SHA256, processing version,
mask/normalization/reduction semantics and explicit not-run qualification fields.
Runtime reductions can differ from the host's sequential rounding. Any accepted
deployment therefore needs a different graph/processing identity and a separate
qualification receipt covering padding/truncation, zero masks, dtype/dimensions,
normalization=false, score/top-k drift and available CPU/accelerator execution.
This producer alone grants no activation or cache-compatibility authority.

The source-authored inert-session parity assertions and graph prototype are
unrun. No real-model speedup, transfer reduction or fused numerical qualification
has been established. Native/runtime/provider/resource identities, cold and warm
state, peak RSS and post-disposal memory remain required experiment evidence.
