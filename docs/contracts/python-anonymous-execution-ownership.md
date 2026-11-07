# Python anonymous execution ownership

The CPython collector evaluates a lambda's default-expression observations in the
surrounding lexical scope. Its body has a separate source-coordinate anonymous
scope. Body calls, writes, yields and control counters therefore cannot become
facts about the surrounding function or class merely because the lambda occurs
inside that declaration.

Anonymous call details remain file-level syntactic evidence with an explicit
anonymous scope identity. They do not create a named declaration chunk or resolve
which invocation eventually executes the body. Affected named chunks carry
anonymous-call omission counts, and the file retains partial coverage with
`anonymous_python_lambda_execution_unmodeled`. Existing scoped chunk projection
keeps default expressions and named body calls under their actual owners.

This does not establish lambda dispatch, comprehension/generator-expression
semantics, native-parser parity or whole-language execution completeness. The
actual CPython transport and registered consumer controls are authored and
UNVALIDATED during the development-first wave.
