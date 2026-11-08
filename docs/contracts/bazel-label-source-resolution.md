# Bazel label source resolution

The import resolver models literal `.bzl` source dependencies. An explicit
`//tools:defs.bzl` has one candidate: `tools/defs.bzl`. An absent explicit target
cannot select `tools/tools.bzl`, `tools.bzl`, or another nearby file. Normal
segments are admitted before joining paths; traversal, repeated separators,
backslashes and changed whitespace do not become alternate labels.

Bazel's [label contract](https://bazel.build/concepts/labels) defines omitted
target shorthand: `//tools/pkg` means `//tools/pkg:pkg`. It does not imply
`pkg.bzl`. Likewise, `//tools/pkg:defs` names `defs`, with no appended extension.
These configured targets remain unresolved by this source-file adapter. Valid
label punctuation outside its supported subset and unavailable apparent or
canonical repository mappings also retain explicit unresolved states.

Package ownership follows BUILD or BUILD.bazel evidence, consistent with
Bazel's [package model](https://bazel.build/concepts/build-ref). A local label
uses the nearest established package, including from a source in a directory
without its own BUILD. A file label cannot cross a nested package boundary.
Discovery entries alone establish listed BUILD witnesses, not missing packages.
When available, the invocation's owned filesystem metadata takes precedence
over stale listed witnesses. Filtered, inaccessible, unprepared or capped
coverage stays unknown. No Bazel execution, repository download or target
evaluation supplies inferred authority.

One immutable package index prepares bounded directory observations and exact
file membership for both positive resolution and unresolved classification.
Queries do not scan discovery entries or perform filesystem probes. At most
4,096 package directories and 100,000 reference entries are prepared; incomplete
coverage cannot authorize a guessed edge. Target absence is explicitly scoped
to the admitted file inventory. The existing lookup owns case policy.

Package observations, source inventory, policy and bounded-coverage state enter
the build-context fingerprint (`build-context-v6`). The resolver identity is
`import-resolution-engine-v8`; semantic importResolution advances 11 to 12. Existing
public graph shapes and reason-code contracts remain intact. Unresolved traces
carry exact candidate, package/target state and BUILD witnesses. Existing
extensionless/default queries remain negative fixtures alongside new explicit
positive labels, rather than being removed to match implementation.

Authored checks are `bazel-label-identity.test.js` and
`bazel-label-graph-replay.test.js`, plus retained language-coverage and plugin
fixtures. They cover malformed segments, nearby ghost files, package boundaries,
filtered metadata, bounded work, order, collector-to-graph serialization and
cold/warm BUILD changes. Runtime execution is pending the requested deferred
validation phase; this document does not claim Bazel runtime qualification.
