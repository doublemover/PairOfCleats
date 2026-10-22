# Legacy LSP source signature admission

The existing type enrichment path uses the canonical Location/LocationLink
normalizer. A LocationLink requires its target selection and containing range;
missing selections cannot borrow the container. Both ranges must map exactly
to the captured current document, with containment, before source signature
parsing. Foreign URIs, clamped positions and invalid scalar endpoints supply no
source signature. The actual protocol container supplies the candidate text;
a name-only range cannot borrow a complete signature from its source line.

DocumentSymbol enrichment likewise requires its real selection, exact enclosing
range and containment. Flat SymbolInformation retains its own URI and single
range, and only the current or explicitly admitted legacy URI can contribute.
Missing URI/selection metadata cannot become current-document evidence during
flattening. Source candidate ranges use exclusive ends without extra characters
or clamping. These checks qualify the existing heuristic signature consumer;
they do not prove runtime call targets or provider completeness.

The local request cache policy is `rq7`, retiring signatures admitted by the
previous coordinate/shape rules. Shared LSP producer identity also changes.
The authored actual document-processing regression remains unrun; real-server,
native and end-to-end qualification are pending.
