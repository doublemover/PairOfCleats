# Workspace JSONC descriptor lifetime

Status: UNVALIDATED source implementation and authored controls.

`readJsoncFile` borrows the existing contained descriptor resource owner through
the shared bounded text reader. It captures original numeric read/stat/close
operations, verifies the opened file before and after its positioned reads, and
parses JSONC only after standard void close confirmation. Comments, trailing
commas and ordinary JSONC parse diagnostics keep their existing behavior.

`loadWorkspaceConfig` preserves an unsettled actual descriptor failure instead
of converting it into `ERR_WORKSPACE_PARSE_FAILED`. The returned error retains
the actual descriptor capability. Original native observations are captured
before message projection and checked again afterward. A throwing message getter
retains the original and independent inspection failure. Completed ordinary read
and syntax failures still become workspace parse issues, with the exact original
thrown value in `cause` and without arbitrary diagnostic coercion.

The actual-consumer fixture is
`tests/workspace/config-resource-lifetime.test.js`. It authors comment/trailing
comma compatibility, ordinary workspace resolution and missing/syntax issues,
failed/false close, falsey/frozen causes, independent read prerequisites, original
observer/method replacement and explicit first-close recovery without rereading.
No fixture has run. After an attempted synchronous close fails or returns a
nonvoid value, numeric descriptor generation remains unknown; disposable fixture
cleanup is not settlement evidence. Recovery never reparses or resolves a
workspace automatically.

Other JSONC callers may still translate errors without preserving ownership.
Existence and workspace repo identity probes, raw atomic writes, parse-only import
coupling budgets, cross-process authority and runtime/native acceptance are
separate work. This change grants no storage/category, trust or deletion rights.
