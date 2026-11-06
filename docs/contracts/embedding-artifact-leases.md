# Embedding artifact verification leases

Runtime artifact selection and post-load verification use bounded asynchronous
opened-file hashing. Two verification tasks run concurrently, with at most 32
distinct queued/in-progress requests. Each hashes one selected file at a time with
a 1 MiB scratch buffer. Equal requests share only an in-progress verification;
later acquisitions rehash mutable files. No path/size/mtime digest cache authorizes
reuse. Same-size replacements, preserved modification times and tokenizer-only
edits therefore remain observable by byte digest.

The selected inventory is bounded to 128 files. Receipt-qualified ONNX closure
selection includes its declared graph/external-data files. Where the generic loader
does not prove an exact graph closure, conservative inventory remains, including
recognized sibling graphs. Qualified immutable-revision and deterministic stub
identities retain their existing contract. A directory named by a content digest
does not itself establish filesystem immutability or permit a stat-only shortcut.

Each opened file is checked against its descriptor/path identity and byte count.
The selected namespace is planned again after the last hash as well as rechecking
every observed file. A newly selected graph, changed installation selector or
changed tokenizer closure cannot be certified using the earlier inventory.
Linked loader routes, linked artifact candidates and non-file artifacts fail
before sibling hashing. The synchronous compatibility resolver uses the same
contained-descriptor owner and checks the selected namespace again.
A post-load phase
rehashes mutable bytes and compares artifact compatibility before provider success
can publish evidence. These checks detect observed replacement; they do not create
an operating-system write lock or make a mutable model installation immutable.
Unknown provenance is unique to each requester even when verification was
coalesced, and never gains reusable cache authority.

The public synchronous adapter constructor returns an owned deferred adapter when
byte verification is necessary. Awaited operations perform verification, acquire
the existing identity-keyed adapter/session owner, and preserve its disposal and
inference tracking. Disposal during verification waits for acquisition to settle
and disposes the acquired resource without starting the canceled operation.
Observation does not start native work. Supplied verified artifact identities and
qualified immediate identities retain the existing direct path. The synchronous
artifact resolver remains a compatibility/diagnostic API, rather than the runtime
full-model read path.

Lease metrics count verification/coalescing calls and bytes/files hashed. Async
selection intentionally does not claim zero warm I/O for mutable installations.
The [Windows closeout](../archived/embedding-artifact-lease-closeout-2026-11-05.md)
qualifies actual native graph/external-data selection, interrupted acquisition,
replacement/refusal, initialization cleanup and cancellation controls. Serial
fresh-process samples retain hash/read counts, CPU, sampled heap, lifetime RSS
and event-loop delay. Concurrent requests share verification; mutable warm
acquisition still performs real reads. These measurements qualify artifact
verification and do not establish model inference throughput or cold-device I/O.
