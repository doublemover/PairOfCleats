# ECMAScript lexical declaration boundaries

The shared lexical declaration and brace-body owners accept an internal
`ecmaScriptLineTerminators` grammar policy. TypeScript signature, class metadata,
fallback chunk, relation and heuristic flow consumers select it through their
existing helpers. Native JavaScript/JSX/TypeScript/TSX signature extraction selects
the same policy from the registered grammar configuration.

In those consumers, CR, LF, CRLF, U+2028 and U+2029 end line comments. Signature
and body scans therefore agree when a comment precedes an actual opening or
closing brace. CRLF consumes one line of the existing bounded signature scan;
lone CR and the ECMAScript separators also consume a line. Other grammar
policies retain their previous terminators rather than inheriting a global
language assumption. Source text and protocol LSP line indexes stay unchanged.

The native chunk cache producer version is7; shared source-chunking and call-flow
identities also retire the changed metadata and fallback relation meaning.
The authored actual TypeScript/registered-policy regressions remain unrun.
This lexical fallback does not establish exhaustive ECMAScript regex/template,
native grammar, full indexing or runtime analysis coverage.
