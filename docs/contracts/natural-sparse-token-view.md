# Exact-natural sparse token view pilot

`retrieval/views/natural-sparse-tokens.js` implements an explicit, restricted
reference score target over hand-authored sparse token tensors. Weights are
nonnegative integers encoded as decimal strings; positive stored coordinates
have at most 32 digits, and omitted coordinates are zero. Products, sums, pooled
maxima and scores use BigInt. Floating point learned weights and dense signed
vectors are deliberately unsupported by this numeric profile. This provides
executable bound/reference behavior without claiming an unqualified floating
point certificate or adoption of any pretrained sentence/token model.

The identity pins source generation/context, model, tokenizer, aligned lexical
space, query/document formatting roles, all-window-token aggregation and numeric
profile. Query and document views have distinct declared roles. Original sources
are verified against their owned UTF-8 capability and reconstructed canonical
source manifest; malformed source IDs and mismatched bytes are rejected.

Windows retain UTF-16 source spans, encoded/missing status and contextual token
identities. Token spans remain inside their window or explicitly null for
synthetic tokens. Span union must cover the entire supplied source for complete
encoded coverage. Overlaps retain distinct token identities. Declared window
coverage does not prove a tokenizer/model actually encoded those bytes: the
future adapter must supply that admission. Raw source retention and encoded
coverage are separate. Incomplete query coverage rejects exact opening; incomplete
document coverage yields unknown intervals and prevents full-domain ranking.

For each query token q and coordinatewise document maximum m, the initial lower
bound is `max_l q[l]*m[l]` and the upper bound is `sum_l q[l]*m[l]`. Summing these
over query tokens bounds `sum_q max_d dot(q,d)` exactly under this integer target.
Different coordinates can have different token witnesses, so their sum is only
an upper bound. Refinement visits actual token pairs, raises sampled maxima and
sets the interval to the exact score when all pairs finish. Empty query/document
tensors score zero under this declared nonnegative target. Zero/unmatched
documents remain in full-domain ranking; ties use logical ID code-unit order.

`rankNaturalSparseTokenView` is a complete full-scan consumer. It returns decimal
scores and explicit roots, without converting large values to rounded Numbers.
`expand` returns retained source text for a token's declared mapping and preserves
synthetic/no-source cases. It does not infer semantic truth from token matches.
The reference reader does not claim a postings frontier, ANN completion, a durable
cursor, global source semantics or production adoption.

Admission bounds source bytes and tensor/manifest bytes separately, plus 256
documents, 16384 tokens and 65536 coordinates. Query views allow up to 64 tokens.
Work slices count token-pair evaluations, whose coordinate work remains bounded
by 128 coordinates per token. Metadata/index/cloning costs and retained source
strings are additional; byte counters are not heap/RSS. Closing clears reader
state and invokes its caller release once. Rejected construction retains caller
ownership. Cancellation leaves refinement progress available to the same reader.

Authored unexecuted tests use an independent dense integer oracle across tiny
two-coordinate tensors and assert interval containment at every refinement step.
They include split-coordinate witnesses, missing tails/windows, source admission,
zero scores, stale spaces/roles, negative/fractional rejection and cancellation.
Floating-point outward bounds, model adapters, actual tokenizer receipts,
postings/#1504 integration, atomically maintained pooled supports, dense bounds,
durable continuations and measured qualification remain open #1518 obligations.
