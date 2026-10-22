# Preview source-wide cooperative search

The local preview endpoint now adopts an asynchronous search operation over its
pinned admitted source model. File/member records are projected transiently in
canonical source order; the default demand caller does not build another complete
table of combined search keys. It yields after bounded row groups so a client
disconnect, cancellation or session retirement can stop pending work. The original
materialized map and its source inventory/adjacency owners remain required by the
current producer and saved-input reader.

Search preserves exact available matching totals, original scalar IDs and
generation-local addresses, directory/type scope, bounded UTF-8 result bytes and
exact advancing continuation. The synchronous compatibility API and cooperative
API share the result-page collector and matching fields. Neither path expands
the selected export, infers absent source evidence or promotes static relationships
to runtime execution.

Both transport modes use one query/scope predicate, rejecting unsupported entity
types and malformed directory scope before work. Compact-worker compatibility
search checkpoints count every visited source candidate, including rows excluded
by entity type; sparse type matches cannot prevent cancellation from yielding.

The preview handler gives every accepted request a cancellation owner connected
to client response closure, request abort and server lifetime. Its existing two
in-flight server allowance is unchanged. Result publication checks cancellation
again after search. Retirement cancels transport work before dropping source
arrays and indexes. A completed bounded file/member/detail page keeps its existing
operation path.

This source slice chooses no GPU/backend, source admission threshold or performance
acceptance value. Cooperative scan latency, allocation/heap impact, concurrency and
HTTP/worker/browser behavior remain unqualified; the authored cancellation/parity
regression has not been run. A canonical streaming source reader is still separate
integration work.
