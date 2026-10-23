# Cross-file imported member targets

Relative import narrowing identifies a source file; it does not make every
declaration in that file a candidate for every call. The resolver preserves the
member path after replacing an imported root. For example, `{ Beta as Local }`
maps `Local.run` to `Beta.run`, while `* as ns` maps `ns.Beta.run` to `Beta.run`.
The imported class `Beta` alone is not a target for `Local.run` or
`Local.missing`.

An import-narrowed candidate must match that mapped target before scoring and
candidate caps. A simple imported name can retain the existing qualified-leaf
match; a member path requires the complete mapped qualified name. A namespace
binding without a member is not treated as a callable declaration. Candidate
scoring cannot recover a nonmatching target by falling back to zero-score file
locals.

A direct default target requires a canonical `default` name or one of the
existing JavaScript default function/class declaration kinds. This also supports `ns.default()` when the
namespace import names that default declaration. A named default declaration is
not evidence for arbitrary members on the default value. Default member paths
without a matching canonical qualified declaration remain unresolved. Parser
families that do not retain default-declaration identity are not qualified by
this slice.

The existing file resolution, candidate limits and source ownership checks stay
in place. The shared call-flow producer version binds this changed cross-file
target policy. The authored controls use existing JavaScript parsers, call
indexing and chunk handoff, actual pinned return propagation and cold/warm
replay for named, namespace and default imports and their missing-member cases.
They remain **unvalidated**. Export availability/alias completeness, package or
external-module ownership, full type dispatch, native parity and runtime
qualification remain separate work.
