# Compiler callback runtime parameters

Compiler timer, Promise, process-IPC, browser-worker/port and Node-worker/port
callback models share the existing runtime-parameter projection. TypeScript's
explicit `this` parameter is erased and cannot shift the first delivered payload
into a different source binding. Multiple timer payloads retain their runtime
ordinals. Ordinary callback parameters keep their existing mapping.

Generic callback and Node message payload projections use the existing runtime
lexical read owner. Parameter declarations, erased `typeof` type queries, labels and
non-value property-name bindings cannot become delivered-payload consumers.
Browser message candidates still refer to their existing `MessageEvent.data`
owner. Rest bindings remain unresolved rather than treating the aggregate rest
array as one direct message payload; default/destructuring and precise activation
semantics remain outside the supported simple mapping.

The generic boundary runtime-use inventory still retains assignment references
needed by the existing WebAssembly handle mutation/escape guards. Read projection
does not remove those guard inputs. Erased syntax is excluded from that inventory.

These are source dispatch candidates under the existing platform authority,
endpoint and source identities. No callback, timer, process, IPC, worker or native
operation is executed by this change. Delivery, multiplicity, receiver binding,
listener replacement, clone/transfer effects and runtime closure remain
unobserved. Shared boundary-flow and worker-flow producer identities must advance;
compiler syntax/binding, CFG, ordinary call-flow and schema owners do not change.

The authored actual compiler/artifact fixture follows timer/Promise and browser/
Node MessageChannel inputs into retained consumer edges, with erased `this`,
multiple payloads, type-query/declaration negatives and unresolved rest controls.
It is **UNVALIDATED**; no tests, syntax, lint, format, bootstrap, compiler/native/
source execution or benchmarks were run.
