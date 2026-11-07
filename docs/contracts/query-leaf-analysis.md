# Cold query leaf analysis

Status: source implementation and authored controls are UNVALIDATED.

Each cold `buildQueryPlan` owns one synchronous `createQueryLeafAnalysis`. For a
plain native Set dictionary with original methods and only known numeric length
metadata, and passive primitive consumed options/ngram values with no configured
token hook or custom match coercion, the owner reuses
pure core term analysis by raw string and effective case mode. It reuses literal
phrase analysis separately. Dictionary, options and cache references belong only
to this plan; there is no process cache, generation reuse or public selector.
The owner is not returned in the plan or its cache/API/artifact representation.

AST annotation and flattened positive/negative projections share those original
core results. Every query-tokenizer boundary still performs its original aggregate
language projection with the same raw terms and effective options, preserving
context-sensitive CJK detection/expansion limits, stemming, order and duplicates.
Phrase scoring retains its separate case-insensitive term representation.
Returned arrays are independent of private memoized arrays. Original parsed
AST/source ownership, Boolean groups/polarity and literal/ngram behavior remain.

The profile's first language is captured from a passive ordinary array; unused
dictionary inventory arrays and adaptive segmentation schedules remain outside
the consumed tokenization options. Normalized postings may likewise retain their
unrelated field/token-classification containers. Custom dictionary methods or
other properties, variants/subclasses/proxies, hooks, non-primitive consumed
option/ngram values and interleaved ngram getters retain the
original tokenizer call path. Hook
results are never memoized, and aggregate callbacks are not replaced by per-leaf
results. Existing cache serialization, parser/tokenizer identities and generation/
configuration invalidation are unchanged because successful meaning is intended
to remain identical. Retained core work is proportional to distinct original
leaf strings and the two existing case modes, and ends with this synchronous
owner; this is not a claim about prompt GC or total process allocation.

Authored controls compare the actual planner and original tokenizer sequence for
Boolean/NOT/repeated/fallback queries, CJK, stemming, segmentation, case and cache
round trips. A default 24-term/two-phrase control authors 25 unique core term
analyses (including positive phrase scoring) and two literal phrase analyses,
without recomputing the AST leaves for flattened projections. Separate controls
retain stateful hook calls/rawTerms/profiles and custom dictionary behavior.
They have not run. Internal counters describe completed core invocations, not
measured CPU, allocation, latency or full-search speedup. Supported Node26 cold
planning/allocation benchmarks and runtime/quality acceptance remain outstanding.
