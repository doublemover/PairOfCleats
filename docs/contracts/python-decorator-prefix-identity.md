# Python decorator prefix identity

AST decorator expressions can start after grouping parentheses, including on a
later line than their `@` token. Their expression column minus one therefore
cannot establish the declaration's complete source prefix.

The CPython producer now streams the standard lexical token iterator once per
source and retains only decorator-prefix associations. Logical statement
boundaries and matching declaration indentation associate consecutive decorators
with their following function, async function or class. Blank lines and comments
do not absorb unrelated statements; parentheses and interior matrix operators do
not create extra prefix markers. Token character columns are converted to UTF-8
byte columns before matching AST coordinates.

Chunks retain full prefix source coverage and separate definition coordinates.
A tokenization mismatch keeps definition-only coverage with
`python_decorator_prefix_unavailable`; it does not guess an earlier range. This
does not change execution ownership of decorator expressions, resolve decorator
dispatch, or qualify native grammar parity. Registered CPython/CRLF/Unicode and
unavailable-proof projection controls are authored but UNVALIDATED this wave.
