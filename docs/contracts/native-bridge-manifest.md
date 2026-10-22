# Supplied native bridge manifest pilot

Unvalidated data-only first slice of #1508. The internal strict manifest binds
source/build world, runtime/ABI/layout/target, producer options, snapshot and roots,
binary digest/build/symbol/debug identities, wrapper chains and image-relative
binding offsets. Unknown fields (including process addresses) are rejected.
Artifact hashes must agree with the separately admitted artifact inventory.

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
