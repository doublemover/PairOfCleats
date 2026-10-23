# Python lexical call projection

CPython declaration scope IDs combine the lexical display name with the original
definition line and byte column. Call details carry that ID as `callerScopeId`,
and AST chunks retain it as `meta.pythonScopeId`. The registered chunk projection
uses this identity before selecting calls, so repeated functions or local classes
with the same display name do not merge their body or header observations.

The projection intersects the existing, already-budgeted call and detail arrays.
It does not recover observations from an extra metadata store after inference
limits remove them. Legacy AST responses without the identity retain their prior
projection. This is partial syntactic ownership, not resolved Python dispatch,
lambda/comprehension execution modeling, native parser parity, or runtime proof.

The real CPython transport and registered relation projection regression is
authored but UNVALIDATED in the development-first October 23 wave.
