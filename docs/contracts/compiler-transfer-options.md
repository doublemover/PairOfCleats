# Shared compiler transfer-options projection

Browser worker request emission and browser port inference share one projection
of the same immutable compiler AST. It distinguishes an exact literal list,
known absence and a fixed unresolved reason. An accepted options object has
unique static data/shorthand properties; spreads, duplicate properties, computed
keys, accessors/methods and prototype setters are unresolved. The analyzer never
evaluates indexed user code or chooses an overwritten first property.

The projection admits at most 128 object properties and 32 transfer elements,
with the existing collection work budget charged before inspection. Lists with
spreads/holes or nonliteral values remain unresolved. Result/witness arrays are
immutable and mutable lookup maps stay private. Cache reuse is limited to the
current compiler collection and original AST nodes, with bounded visit counters;
it grants no authority to a later parse, source or changed invocation.

Supported syntax still requires the existing endpoint, transferable-kind,
duplicate-port and port-order checks. Node worker constructor/options schemas
remain separate; no browser overload is added to them. A transfer-request edge
models source request syntax, not successful cloning, detachment, activation or
delivery. Known absence supplies no transferred-port identity. Dynamic syntax
retains the existing broad coverage category and adds its precise reason.

Producer identity advances to workerFlow11. Authored actual-AST controls cover
supported/absent/overwritten/unknown/accessor/computed/prototype/oversized shapes
and shared visit counts. Actual compiler/stored-graph controls compare transfer
source refs with port reply identity and reordered document scheduling. These
are unrun; existing duplicate-port, unknown-order, SharedArrayBuffer, fake-platform
and broader native/runtime controls remain required.
