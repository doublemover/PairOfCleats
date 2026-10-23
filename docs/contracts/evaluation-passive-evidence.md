# Passive original evaluation evidence

The cohort, judgment, matching and metric helpers admit dense own data slots
before reading evidence. Inherited and accessor array entries cannot supply
labels, hits or ranks. Metric computations use privately captured rank values;
caller-provided array methods and a second live rank read cannot change an
already admitted value. Recall/NDCG require their explicit valid denominator and
positive cutoff. MRR retains its existing distinct positive rank semantics.

The selected response's optional success flag, selected cohort and optional
output-retention receipt must also be passive own data. Explicit zero omitted
hits and a boolean truncation observation remain required when a budget receipt
is present. Selection preserves existing returned hit references for callers;
the actual metric owner captures its own relevant evidence before invoking any
matcher. An explicit empty array remains observed zero hits.

Judged hits capture only existing matching and stable identity fields: file,
chunk identity (including its metadata alias), repository/mode scope, range and
string name/kind. Identity fields require passive scalar data, and ranges require
valid integer coordinates. Non-string names/kinds cannot supply matching or
distinct-document evidence through coercion. Extra metadata cannot become
relevance evidence. Accessor/inherited identity or matcher fields make judged
input unavailable instead of invoking them as an oracle.

Every hit and predicate supplied to the matcher is an immutable original
snapshot. Mutating caller hit arrays/rows/metadata or label objects during a
matching callback cannot change another admitted slot. The first returned
boolean for each hit/predicate pair is retained through augmenting assignment;
truthy objects, numbers, strings and missing decisions cannot mint relevance.
Unavailable nonboolean decisions remain the exact returned value in the failure's
cause without observer adoption or diagnostic getter inspection. Thrown values
propagate exactly, including falsey failures. These changes keep
the existing distinct-document-one-to-one.v1 policy and deterministic rank
ordering. They do not add judgments, change a matching predicate or assign a
quality penalty to unavailable evidence.

The additional direct actual helper controls are **UNVALIDATED**. No tests,
syntax/lint/format, bootstrap, search/runner/native/child/model/browser execution
or benchmark was performed. Object introspection may itself fail and that exact
failure propagates; this is not a claim that arbitrary Proxy traps cannot run.
Canonical producer/source/generation provenance, independent relevance labels,
whole-dataset allocation bounds, real retrieval quality and performance
acceptance remain separate. Root-owned runner/cache/resource scope is unchanged.
