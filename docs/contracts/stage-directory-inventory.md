# Stage and final directory inventory

Stage2 snapshots preserve regular-file members. Their copy admission explicitly
rejects final backend directories before creating snapshot payloads. Graph-only
selection retains its declared file families. Final recovery inventory has a
separate representation scope and admits the immutable LanceDB families emitted
by the current backend publisher, including `format: dir`, `bytes: null` members.
Metadata receipts remain independent regular-file manifest members.

Directory admission requires the canonical same-generation backend path, one
unambiguous metadata companion, matching variant/model/dimensions/count and
embedding generation, and a complete physical table shape. The existing backend inventory implementation is factored into the shared
artifact-I/O owner; its tooling export remains a direct compatibility re-export.
That owner supplies ordered relative member names, kinds, exact file sizes
and SHA-256 digests. Directory and file resources settle through the existing
owners. Enumeration captures physical stamps and verifies them again after
hashing; membership, type, link, extent and same-size changes cannot be silently
accepted. Metadata is reread against its observed hash after payload reads.
Recorded closed-writer inventory, when present, must match the actual inventory.
The resulting directory identity also binds the backend/model/generation receipt
and metadata digest; path/count equality alone does not qualify it.

The existing 4,096-entry, 512 KiB and depth-32 bounds remain. Exceeding them returns
an explicit unavailable inventory, and final recovery rejects publication with
`ERR_STAGE_DIRECTORY_INVENTORY_UNAVAILABLE`. This is not a verified empty store.
The producer does not publish zero-row variants; an empty directory cannot
satisfy a nonempty backend receipt. Internal test limits may only reduce the
bounds. No public configuration or native dependency was added.

Recovery validates and inventories all selected final outputs before pointer
commit, while retaining its repository writer/generation owner. Durable completion
stores those exact qualified output identities. Confirmation requalifies them;
changed content or membership cannot become `alreadyComplete`. An unexpected
failure after actual commit still reports `ERR_RECOVERY_POST_COMMIT` with its
publication context. Pre-publication inventory rejection does not suppress or
relabel later persistence failures.

The filesystem fixtures use synthetic closed-writer table bytes through the real
backend publication and manifest owners. They qualify physical inventory and
recovery ordering. Native LanceDB decoding/query parity remains an independent
optional qualification. Link-branch injection is explicitly distinct from
physical-symlink execution and requires no new links or Windows elevation.
