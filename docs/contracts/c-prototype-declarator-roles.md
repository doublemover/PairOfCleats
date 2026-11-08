# C-family prototype declarator roles

Prototype admission unwraps bounded parenthesized and attributed declarator
wrappers before deciding whether a function declarator introduces a callable.
Redundant parentheses around a declared function name do not turn it into an
unbound function type or erase its chunk. The original enclosing declaration
continues to own the source range and bodyless signature.

A pointer, reference, array or other binding-changing declarator encountered
before the declared name prevents that function-declarator node from becoming a
prototype. A function-pointer variable, parameter, typedef or field therefore
does not become a callable declaration merely because it contains a parameter
list. A function returning a function pointer can still expose its inner
function declarator through the existing owner walk, once.

The name walk uses grammar children and at most 32 wrapper levels. Existing
lexical scope and member classification remain responsible for namespace and
class ownership. This changes syntax admission and requires the shared
source-chunking producer increment before replay reuse.

Authored registered C/C++ adapter fixtures cover ordinary and nested parentheses,
function-pointer returns, pointer bindings, parameters, fields and namespace
members. They are unvalidated; native grammar, compiler and platform acceptance
remain open.
