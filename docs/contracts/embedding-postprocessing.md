# Embedding postprocessing ownership

Inline and deferred embedding postprocessing use the same channel owner. Inference
and cache vectors are borrowed read-only: normalization and quantization never
mutate, detach or transfer their buffers. Each returned encoded channel owns an
independent byte buffer, including identical code/merged rows when documentation is
absent. An absent documentation channel remains empty.

Normalization preserves the established Float32 input and quotient rounding points
and scalar norm accumulation order. Quantization consumes those rounded quotients
directly. A Float32 input needs no defensive normalized float copy. A plain-array
or Float64 input still rounds through Float32 when normalization is enabled.
Without normalization, a merged row retains its historical Float32 conversion,
which can differ from the raw source-channel quantization at a boundary. The shared
owner rejects nonfinite/non-number source elements and mismatched channel widths.

Provider configuration saying `normalize: true` is not sufficient evidence to skip
consumer normalization: provider, float16 cache and boundary numerical equivalence
need qualification. The fused consumer therefore preserves normalization rather
than inferring unit norm from that flag. ANN normalization after dequantization
continues because quantized values need not retain the original norm.

This is source-only development. Exact-byte differential fixtures, float16/provider
matrix, backend mutation/detachment checks and allocation/traversal/CPU measurement
remain unexecuted. No numerical producer-meaning change or speedup is intended.
