# Service progress read ownership

Status: partial source repair for #1593; authored controls remain unrun.

The monitor now retains only the exact build root, build ID and runtime attempt
after initial ownership selection. Each ordinary bound poll reads that one state
and revalidates the latest attempt, claim correlation, stage and repository/root
identity. It performs no retained-directory enumeration, mtime sorting or unrelated
state reads while that binding stays valid. Disappearance, corruption or changed
ownership invalidates the binding before compatibility discovery. A sticky path
alone never establishes ownership. Existing predecessor, concurrent-claim and
resumed-build negatives remain unchanged.

State reads use the existing contained descriptor/verified-byte owner, capped
at1MiB before allocation or decode. Only completed bytes enter fatal UTF8 decoding
and JSON object admission. Structured observations distinguish ok, missing,
oversized, corrupt, unsafe and transient outcomes. JSON-decode attempts and known
read bytes are separate from unknown failed-read work; failure is never a numeric
zero-work observation. The nullable compatibility helper remains available for
embedding replay. Pending original resources or unreadable diagnostic authority
propagate through the storage observer rather than becoming a harmless null.

The existing lifecycle still owns the production timer and one captured poll.
Concurrent poll requests share that promise. Stop drains actual I/O and suppresses
late presentation before dropping the binding. Internal fixed-size diagnostics
record bound/candidate reads, discovery cycles, invalidations, classified outcomes,
known bytes and JSON decodes. They retain no parsed state between polls and change
no public CLI, configuration, artifact or log-text contract.

Two unrun controls use actual files and descriptor reads: retained inventories
of1/8/32 plus two monitored claims, constant bound-read counts, changed correlation,
corrupt state, captured in-flight drain, fatal UTF8, extent rejection before any
payload read, ordinary I/O failure and preserved original pending work. No new
physical symlink, index or elevated privilege is required.

Remaining source work is explicit: executor-produced exact binding, repository-
shared incremental discovery/backoff before binding, and bounded producer
projection for oversized histories where useful. Initial/invalidated compatibility
discovery still enumerates/stats/sorts retained roots per monitor. This batch does
not qualify startup discovery scaling, production timing, native execution or the
full #1593 acceptance target.
