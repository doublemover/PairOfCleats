# Compiler accessor reference roles

The compiler session's existing implicit-accessor collector uses the shared checker property-symbol owner for dot access and literal string/numeric element keys. The binding of a dynamic key expression is not a property symbol and cannot supply an accessor target. These candidates feed the existing call-site summary and retained call-flow consumer.

Transparent parentheses and erased TypeScript expression wrappers preserve the surrounding reference role. A simple assignment emits a setter candidate with its actual right-hand-side input; a compound assignment or increment/decrement keeps getter and setter candidates. Reading keeps a getter. Deleting the selected property emits neither accessor invocation, while a receiver expression such as `box.child` in `delete box.child.value` still retains its own getter candidate. Setter calls do not supply a returned assignment value.

Accessor targets remain incomplete and modeled under the existing descriptor-mutation/receiver uncertainty reason. This change does not prove unique runtime dispatch, proxy behavior, conditional execution of logical setters, destructuring assignment coverage or dynamic-key completeness. The shared `callFlow` producer identity must advance; compiler syntax, binding facts and local CFG ownership do not change here.

Authored regressions use the actual checker, implicit collector and retained call-flow partitions to inspect getter return, setter input and call-target channels, with wrapped assignment, literal numeric keys, deletion and dynamic-key controls. They are **UNVALIDATED**: no tests, format, syntax, bootstrap, compiler execution, native process or source getter/method execution was performed.
