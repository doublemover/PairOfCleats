# Cross-file argument names

The existing cross-file summary producer stores positional argument bindings in
a map with no inherited properties. Names such as `__proto__`, `constructor`,
`toString` and `hasOwnProperty` are ordinary source parameter names. Their
argument text must survive both propagation and output-cache serialization.

Type propagation uses an own-property check before falling back to the
positional argument. An absent name cannot resolve through `Object.prototype`,
and a valid named argument is not replaced by an inherited object value. This
changes derived argument/type meaning and requires the shared call-flow producer
increment; the cache's existing format and source identity requirements remain.

The authored regression follows the actual cross-file pipeline through cold
propagation, source-qualified cache admission and warm replay. It is unvalidated.
Native parser, full index, fine-grained resume and runtime call qualification
remain separate work.
