# Supplied native bridge manifest pilot

Unvalidated data-only first slice of #1508. The internal strict manifest binds
source/build world, runtime/ABI/layout/target, producer options, snapshot and roots,
binary digest/build/symbol/debug identities, wrapper chains and image-relative
binding offsets. Unknown fields (including process addresses) are rejected.
Artifact hashes must agree with the separately admitted artifact inventory.

Aggregate admission validates `maxBytes` before touching the supplied descriptor
and passes that allowance to the shared passive canonical encoder. Each logical
occurrence counts, including repeated references to one caller-owned wrapper
array/string. An oversized descriptor fails with `ERR_SEMANTIC_JSON_BUDGET` before
full expansion or capture. Other non-JSON/accessor descriptor failures remain
`ERR_NATIVE_BRIDGE_MANIFEST`; accessors are not evaluated. Pending resource errors
cannot be converted into an ordinary input diagnostic.

One bounded canonical representation supplies the owned JSON containers, all
subsequent manifest validation and the existing domain-separated manifest hash.
No second full-manifest encoding or structuredClone is performed for identity.
Expected world/runtime comparison is separately byte-bounded. Accepted identities
remain byte-for-byte compatible; caller mutation cannot rewrite admitted facts.
Owned freezing uses iterative traversal. The allowance covers logical UTF-8 JSON
bytes, not caller storage or an absolute parse-tree/heap/RSS maximum. Separately
admitted artifact/layout authority and all existing binding/coverage limits remain.

The consumer never imports packages, loads binaries, runs debuggers or invokes
producers. Layout support is explicitly admitted by the caller. Unsupported
layouts stay unknown; a stripped or absent target may be unobservable. A
registered/observed binding is distinct from invocation, reachability and effect
evidence. Missing bindings never establish unreachability. Callback, late
registration, loader and ctypes coverage remain separate.

Remaining #1508 work includes canonical public schemas/report intake, actual
runtime-layout conformance, transfer/effect translators and object correspondence,
cooperative solver adapters/SCC closure, semantic publication/trace integration,
two-family conformance and measured qualification. This pilot supplies no global
may-analysis closure and makes no empirical or source-language soundness claim.
Its regression sources have not been executed.
