# Source-owned JavaScript documentation — 2026-10-27

Source `18a11375463acdf2ed74dfa6ab2451c8a8703972`, tree
`07aa6ab1346dd621ada42ffc7699100ab3de9438`, branch
`codex/pr557-audit-repairs-20261012`. Functional checks are deferred.

The former whole-chunk tag regex accepted tags in literals, lost optional names
and truncated nested record types. Babel/Acorn/Esprima now privately capture
immutable parser comment ranges at source admission. A bounded declaration-owned
adapter associates actual leading comments, including comments outside a function
chunk, and parses them using the already locked jsdoccomment and type-pratt
libraries. The documented dialect is JSDoc; original validated type text remains.

Optional/default/rest and dotted names, nested records, generics/unions and return
hints are retained separately from stronger source AST metadata. Explicit empty
AST parameter arrays retain precedence. Absent, malformed, unavailable and valid
empty documentation have distinct states. Intervening comments/statements fence
association; body comments and string/template contents cannot supply tags.
Public AST comment mutation cannot replace privately admitted source ranges.
Embedded source ranges are rebased. Prototype-like parameter names remain data.

Comment count, per-block/aggregate bytes, tag count, type length/depth and fallback
traversal/queue bounds apply before oversized dispatch where possible. Parsing is
lazy and cached per admitted block. Required-library load failures remain setup
failures. JavaScript relation producer version changes from 1 to 2; no dependency,
Node pin, public option or artifact format changed. The behavior and bounds are
specified in [the documentation contract](../contracts/javascript-documentation.md).

Twenty-one `lang/javascript/jsdoc-comment-ownership/*` cases are authored but
**have not run**. They include the reported positives/false positives, all three
actual source parsers, artifact assembly, AST precedence, embedded offsets,
budgets and public-comment tampering. Existing declaration/flow/replay, language
contract and import-budget checks remain required. No passing functional or
performance qualification is claimed; #668 remains open.

Format/ESLint, changed-JavaScript syntax, config budget, generated command
inventory and whitespace checks passed before the source checkpoint. Shared
module analysis reported zero cycles. These static observations do not establish
consumer correctness or a final-tree suite pass.
