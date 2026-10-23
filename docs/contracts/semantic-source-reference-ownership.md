# Semantic source-reference input ownership

The shared retained source-header reader captures the submitted RecordRef and
two scalar span endpoints before calling the partition inventory or asynchronous
row iterator. It reads only own data properties and rejects accessors, sparse
spans, negative/noninteger endpoints, reversed spans and invalid canonical refs.
Null or omitted spans remain unavailable source references. Reflection failures
propagate unchanged, including falsey values and original pending resource work.

Header selection, source-unit checking, coordinate bounds and returned ref use
this same captured input. A caller changing its original record during header
I/O cannot relabel one partition's path/hash with another partition's RecordRef
or change the span that was admitted. Returned refs are immutable and detached
from the caller. Both artifact and SQLite stores use this shared reader.

The source header must still validate and agree with its pinned partition.
Generated/mapped sources retain the existing unavailable result until an exact
coordinate adapter owns them. No working-tree source fallback, full text read,
default provider acquisition, new option or producer/schema version is added.

The authored controls use actual retained headers from two different source
partitions and mutate the direct programmatic record during physical reads.
They are **UNVALIDATED**. This does not capture every caller's mutable response
envelope, store construction metadata or foreign iterator products, and does not
qualify native, provider, runtime, editor or full-index behavior.
