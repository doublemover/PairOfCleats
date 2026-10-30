# Native call scope roles

The native parser-owned call-fact traversal uses declaration ranges to select
ordinary body callers. An unowned callable, lambda, closure or nested type scope
cannot inherit its enclosing function's caller identity. Known descendant
declarations still establish their own owners. Groovy's `function_definition`
body is itself named `closure`; its exact recorded body range preserves that
body's owner while a nested standalone closure is a barrier.

Julia signatures contain `call_expression` nodes without representing a body
invocation. Signature subtrees therefore do not produce body-call adjacency.
Their evaluation/default roles remain explicitly partial. Julia's grammar has no
callee field on an ordinary call; its first named child supplies the declared
grammar position. Groovy's parenthesis-free `juxt_function_call` uses its existing
name field. Repeated calls and recursion retain separate canonical occurrences.

Per-owner `syntaxCallOmissions` counts observed calls in excluded callable and
header scopes. Partial coverage preserves those reasons rather than reporting
every incomplete result as a traversal budget. Traversal-budget returns freeze
the admitted facts and diagnostics just like normal completion. Counts cover
only visited syntax; they are not the size of an unvisited tail. Anonymous calls
without their own declaration chunks remain omitted, never false outer calls.
The existing chunk relation projection retains coverage and declaration omission
counts, so serialization/inference does not lose the reason when a partial
declaration has no retained calls. Fallback file coverage retains its file scope;
it does not certify a declaration's complete occurrence set.

The syntax-call producer version is2 and participates in existing native chunk
cache signatures. Shared call-flow/source-extraction replay identities must also
advance for changed output. No native handles cross an owner boundary, no quality
cap is raised and no parallel occurrence store is introduced.

Authored actual registered Julia/Groovy adapter, default lexicon, call index,
chunk projection and canonical call-site controls cover signatures, independent
methods, recursion, nested callbacks, qualified names and repeated occurrences.
Validation is deferred. Full default/anonymous/macro/operator/nullary execution
semantics and runtime target completeness remain open; parser recovery retains
its existing partial status.
