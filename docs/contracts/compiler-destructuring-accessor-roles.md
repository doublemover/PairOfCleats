# Destructuring property accessor roles

Status: UNVALIDATED source implementation and authored controls.

The existing compiler implicit-call collector recognizes property targets inside
object/array/rest destructuring assignments and for-of/in assignment patterns.
Transparent wrappers and nested pattern defaults retain their outer assignment
owner. These targets produce setter candidates rather than a read of the written
property. Receiver access, computed source keys, RHS/default expressions and
ordinary value object/array literals preserve their separate getter candidates.
An ordinary assignment expression inside a value literal keeps its actual RHS.

The collector does not claim to extract a property, iterator element, rest object
or default value. Its established nullable setter argument remains null, with the
whole RHS/iterable and enclosing default expressions retained only as unknown
influences. The existing incomplete-target/model reasons are extended with
`destructuring_assignment_value_unresolved`; setter result suppression prevents
invented getter return channels or whole-object argument-to-parameter mappings.
No native/checker identity crosses a new store or boundary.

The authored fixture follows actual compiler property symbols through the existing
conservative CFG execution owner and retained cross-file call writer/reader. It
covers array/object/nested/rest/default patterns, iteration patterns, computed key
and receiver getters, RHS/default reads and ordinary value-literal assignments.
It has not run. The source methods, accessors, iterators and defaults are not
executed by these fixtures.

This changes persisted call-flow candidate/channel meaning and requires the shared
callFlow producer version to advance. Compiler binding, CFG and immutable value
slice owners are unchanged. Complete destructuring evaluation order, extracted
values, iterator closing, conditional default execution, unknown write effects,
descriptor mutation, dispatch uniqueness and source-language/native/runtime
qualification remain open. Existing CFG destructuring reasons stay partial; this
does not claim that an accessor-candidate correction closes those other models.
