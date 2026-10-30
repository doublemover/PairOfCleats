# Parser-owned import shadowing in cross-file calls

The existing Babel constant-reference traversal also captures a compact frozen
call-root fact: version, root spelling, import/local/unbound kind, and whether a
local binding shadows the program's import binding. It uses Babel's lexical
scope owner and copies no AST or binding handles. The JS/TS relation owner emits
it only for its exact source-owned, unrecovered AST and only when the final
callee spelling still has that root. Existing constant-alias rewrites are not
relabelled with another root's proof.

A parameter, block local or nested declaration that shadows an import cannot
borrow that import's target through file-level name resolution. Its ordinary
call summary stays unresolved with `lexical-import-shadow`; an existing stronger
compiler-owned detail binding still takes precedence. Direct returned
construction through a shadowed import name does not create a nominal imported
type from that spelling. Legacy return-name fallback cannot recreate a shadowed
name's omitted resolution.

Name-only aggregate call links are checked once against the existing occurrence
inventory. If shadowed occurrences exist, an aggregate import target requires an
actual unshadowed import occurrence for the same callee. A mixed chunk may keep
that aggregate edge while its individual shadowed call summaries stay unresolved.
This avoids rescanning all details per call. The full relation payload and shared
call-flow producer version bind the new facts/admission in replay identity.

Authored JS/TS controls use existing parser/scope reuse, lexicon filtering, call
indexing and chunk handoff, source-pinned cold propagation and qualified warm
replay. Parameters, namespace roots, constructors, block locals, nested local
functions and mixed same-spelling occurrences are included. They remain
**unvalidated**.

This slice does not resolve the local callable itself, qualify every lexical
binding or package/alias/export route, complete TypeScript import-binding
metadata, or replace compiler dispatch. Unowned/recovered and ESTree parser
fallbacks have no new scope proof; broader legacy, native/embedded, async/type,
runtime and performance qualification remains open. No parser, subprocess,
native library or source code was executed during this development increment.
