# Experimental TypeScript symbolic types

`tooling.typescript.typeRepresentation` selects `legacy` (the default) or
`symbolic`. This is an explicit representation migration. It does not promise
byte-for-byte TypeScript display strings or complete TypeScript language
coverage. Unsupported required work fails with
`ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE`; it is not silently omitted,
truncated, cached as complete, or sent to an unbounded checker fallback.

## Supported meaning

The initial backend represents the denotation of closed finite-string type
annotations using immutable, shared Literal, Union and Concat nodes. It accepts
string literals, `never`, unions, parenthesized types, finite template products,
and uniquely bound type aliases. Generic alias arguments must be closed finite
strings and each parameter must have a `string` constraint. Defaults and lexical
shadowing are substituted by compiler symbol identity. TypeScript's actual
configuration, module resolution, package conditions, project references,
ambient sources and authoritative virtual snapshots remain in the Program.

The frontend asks the checker only for symbol and imported-alias identities.
It never asks it to instantiate, print or enumerate a supported type. A product
with 72 binary positions therefore remains a small shared expression instead
of allocating its 2^72 alternatives. Membership and zero/one/many classification
are exact within their computation allowance; an exhausted allowance is an
explicit incomplete computation, never a negative answer.

Every projected result is machine-labeled
`interpretation: "declared-type-denotation"`. This distinction matters at
TypeScript's complexity thresholds: for the tested 2^72 template, TypeScript
5.9.3 reports TS2590 (union too complex) and exposes its `any` fallback. The IR
still denotes the exact finite language authored by the annotation. It is not
observational parity with that checker fallback, and does not suppress or
claim to reproduce its diagnostics. Small below-threshold fixtures additionally
compare actual checker unions with symbolic membership.

Whole-function projection initially requires an ordinary, uniquely declared,
non-generic function or method with explicit supported return and parameter
annotations. Parameters must be required, simple identifiers without defaults.
Inferred returns, overloads, optional/rest/default/destructured/`this` parameters,
generic functions, async/generator functions, recursive aliases, qualified type
names and other type operations produce explicit obligations. A declared type
does not prove that the implementation body satisfies its annotation. This
backend does not add whole-program semantic-diagnostic coverage that the legacy
provider did not perform. Parse errors in consulted sources are rejected.

Non-function target kinds have no legacy type query; they are counted separately
as not applicable. Missing/mismatched targets, unavailable sources/configuration,
duplicate identities and configured document/program caps block symbolic
completion. The existing semantic-session collector eagerly queries other type
operations and cannot currently be combined with this representation.

## Where results live

Each evaluated config group has one context-scoped arena. Identical expression
nodes share immutable handles. Once its declarations are lowered, their exact
roots are serialized together as one graph with sorted `rootIds` and `nodes`.
Using a union wrapper would normalize away some individual union roots, so the
graph explicitly retains every referenced root.

The provider returns shared `symbolicTypeGraphs` entries and compact
`payload.typeExpressions` references. Each reference contains schema version,
domain, graph content hash, evaluated context key and node identity. Declaration
and consulted-alias provenance retain source identity, exact text hash and UTF-16
span separately from meaning and presentation. `display` is initially empty;
source alias spellings are not substituted for legacy `returnType`, `paramTypes`
or `signature` facts. Symbolic signature identity is explicitly namespaced
`type-expressions-v1` and includes parameter order and expression handles.

The existing artifact pipeline writes each content-addressed graph once and
retains compact references in chunk metadata. Manifest references pin generation,
content hash and byte count. Query readers verify those identities and rebuild
sharing from the graph before answering exact membership/classification requests.
See [semantic query contracts](semantic-index.md) for the query surface. The
representation carries declared-language meaning; it does not encode general
TypeScript assignability, overload selection, constraints or inference.

## Identity, budgets and remaining costs

The evaluated-context identity is deterministic. It hashes the compiler load
receipt/version, frontend version, ordered Program source paths and exact text
hashes, compiler options, roots/references, virtual-source origins, and bounded
config/package/resolution observations captured by the existing dependency
system, including negative probes. New inputs acquired during lowering block
completion. This post-evaluation identity is not sufficient preflight authority
for persistent cache reuse; provider cache and cross-file replay are bypassed in
symbolic mode pending live dependency-closure validation.

The arena has a 64 MiB logical storage allowance and 100,000-node allowance.
Frontend traversal has separate node/depth/alias/literal/source allowances;
operations and queries also account for steps, temporary allocations and states.
Serialization admits at most 16 MiB per graph and 64 MiB across all graphs.
Per-declaration metadata is bounded separately. These allowances fail explicitly
and are not claims about a hard V8 heap/RSS limit. Shared nodes can describe an
enormous language, but exact queries may still be computationally expensive.

The production symbolic route executes one whole provider invocation in a tracked
subprocess, preserving its full config groups. It inherits the existing effective
Node heap envelope and tooling timeout, with owned abort/kill-tree cleanup and
bounded streaming transport. The child-only factory capability prevents recursive
launch; repository configuration cannot select it. Heap exhaustion, timeout or
incomplete transport yields a required-computation failure. The V8 old-heap limit
is not an RSS/native-memory cap. No target-window retries or Program-root shards
are used. Final results are accepted only after the completion record and a
successful child exit.

The full TypeScript Program and its source ASTs still occupy memory. Symbolic
lowering removes expansion for supported type operations; it does not unload
source files or solve an oversized Program baseline. Context hashing scans each
loaded source once per group. The final chunk-result map and shared graph data
also remain live until existing publication owners persist them. Supporting
mixed or general TypeScript types requires additional exact operations and
bounded compatibility execution. In particular, querying an apparently
uncovered slot may still expand a supported type through an inference dependency.

## Focused verification

Run the repository's focused test owner (30-second limit per fixture):

```text
node tests/run.js --lane all --match typescript-symbolic-frontend --jobs 1 --timeout-ms 30000 --retries 0
node tests/run.js --lane all --match typescript-symbolic-provider --jobs 1 --timeout-ms 30000 --retries 0
```

The frontend fixture checks real default-library NodeNext/Bundler contexts with
development/default exports, imported aliases, generic defaults and shadowing,
small differential queries, a 2^72 product, unsupported syntax, all frontend
budgets and cancellation. Compiler type/instantiation counts must remain flat
through lowering. The provider fixture checks the production mode, shared roots,
deterministic identities, changed source/configuration, explicit blockers and
legacy-default behavior. These bounded synthetic tests are not an acceptance
run of the reported large repository or a proof of complete TypeScript coverage.
