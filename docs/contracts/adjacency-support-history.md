# Adjacency support history

An original occurrence/support identity binds endpoints and source reference for
its entire admitted revision chain. Full retraction removes its live coefficient,
not that binding. An add/delete pair with net zero also binds the original
producer identity. A later contribution with changed endpoints/provenance needs
a new occurrence/support identity; the same payload may be reintroduced normally.

The previous owner checked only live rows, so delete → changed-payload re-add
could silently give one immutable support two meanings. The current owner keeps
private payload bindings and includes them in the **v2 private view root**.
There is no v1 compatibility path. This is an in-memory prototype identity;
no persisted semantic artifact version or publication pointer is introduced.
The occurrence relation still identifies its logical world, coverage and bag,
so clean-rebuild relation roots remain directly comparable.

History shares the existing 16,384-support ceiling and the serialized state byte
allowance; it is not an unbounded tombstone cache. Transition work includes
retained binding visits. A full history returns `checkpoint-required` before
admitting a new identity, preserving the original view. Checkpoint/source
redeclaration is an explicit producer boundary, not proof of global history or
cross-bootstrap occurrence authority. Ledger, cancellation, negative-coefficient
and original request-capture controls remain unchanged.

Four locally unrun cases cover full/net-zero retraction, changed endpoints and
provenance, same-payload re-add, the real 16,384-binding ceiling/work accounting,
old-reader preservation and both original select/project and group owners.
Existing independent bag/rebuild fixtures retain their positive comparisons.
