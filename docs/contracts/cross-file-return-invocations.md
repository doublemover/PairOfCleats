# Parser-owned JS/TS return invocation propagation

Language-tagged JavaScript, JSX, TypeScript and TSX chunks admit cross-file return
types from the existing relation parser's direct-return invocation evidence.
The relation traversal copies a frozen plain `returnedValue` fact onto an ordinary
call detail. A private parser-source association must recognize the exact source
text; a supplied stale or unowned AST does not authorize these facts. It includes
version 1, call/construct role, exact UTF-16 invocation
range, supported callable owner ranges and await/async/generator flags. It holds
no parser or native handles and requires no additional source parse. Parser
recovery errors withhold these facts.

Only a complete direct call or construction, including transparent parentheses,
qualifies. An expression-bodied arrow may provide the same direct syntax. A call
inside a comment, string, template text, regular expression, argument, nested
callable, member access, comparison or sequence does not provide the enclosing
callable's return type. Returning a function binding is not an invocation.
Optional calls, type assertions and async/generator/await conversions remain
unsupported for this projection. Their ordinary call evidence is retained.

The consumer requires an exact supplied callable range and invocation range.
It joins return call types to the admitted call summary at that exact occurrence,
not to every same-spelling call in the chunk. It does not recreate missing or
budget-omitted summaries through name fallback. Direct constructions retain their
ordinary constructor occurrence and the nominal type spelling. Existing source
byte verification, relation limits, omission coverage and replay limits remain.
The cross-file fingerprint also binds the language that selects this admission.

Other languages and legacy chunks without a canonical language tag retain the
existing heuristic projection; their raw-text and bare-call precision is not
qualified by this change. Unsupported parser/chunk coordinate transformations,
native/Babel callable range differences and embedded segment rebasing fail to
admit the JS/TS fact; they do not use arbitrary source-line or raw-text fallback.
This is a syntactic may-result projection, not proof of feasible execution,
callee binding completeness, finalizer completion or source-language type rules.

The authored controls exercise existing JS/TS parser reuse, lexicon filtering,
call indexing, chunk handoff, actual cold propagation and qualified warm replay,
including quoted/nested/bare negatives and distinct same-spelling occurrences.
All remain **unvalidated** in the development-first workspace. No measured
performance, native qualification or whole-language completeness is claimed.
