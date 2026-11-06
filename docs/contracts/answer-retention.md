# Opt-in retained answers

`createRetainedAnswerStore` retains derived historical answers inside the admitted
repository cache at `answers-v1/`. Construction acquires the existing process
cache lease; only explicit operations create answer artifacts. Ephemeral answer
compilation remains the default. A marker binds the store to the canonical
repository namespace. Foreign markers, unmarked nonempty roots and obsolete
formats are rejected.

`begin({questionRef, worldId, expectedBaseDigest})` atomically records an intent
before asynchronous query work. It preserves the previous complete answer. The
intent contains an increasing epoch and opaque identifier; a newer request
supersedes older unfinished work even when the published base is unchanged.
`resume(intent)` requires that exact pending intent and base. `commit(intent,
answer)` additionally checks deterministic content integrity, question revision,
source world and repository. An obsolete result cannot publish over a newer
intent. Exact completed publication is idempotent after lost delivery; it does
not replay query work. Conflicts require fresh base/intent admission.
`prepare` stages an immutable receipt and an explicit commit closure, retaining
bounded heap data and no native handle. Transport projection admits that receipt
before calling the closure. Its deeply frozen receipt cannot mutate publication.

Immutable, content-addressed objects factor inputs, claims, support bundles and
fragment maps. Repeated support nodes share encoded identity rather than
expanding derivation paths. One atomic head references the complete immutable
manifest. Object publication precedes head replacement, so interruption leaves
the old complete answer plus a pending refresh, never old claims paired with new
citations. Valid orphan objects can be reused by an explicit resumed commit.

The existing atomic-write owner controls staging descriptors, sync, replacement,
rollback and publication diagnostics. The existing file-lock owner serializes
the actual read/mutation/publication interval. Only an exact known dead local
lock owner may be reclaimed; age is not authority. Original unconfirmed native
work preserves its actual recovery session and blocks metadata release. Unknown
staging entries require inspection; this store does not delete or adopt them.

The store admits at most 4,096 object names and 32 MiB of encoded object payload,
plus at most 256 question slots of 4 KiB each. These are logical payload and
inventory bounds, not physical allocated-disk measurements. Mutation admission
scans the bounded object/slot inventory; it does not claim work proportional only
to changed claims. Quota exhaustion rejects the new publication without pruning
history. No automatic eviction or recursive cleanup is introduced.

Reads are contained, bounded, canonical UTF-8 JSON with single-link ordinary-file
and opened-identity checks. Objects verify their encoded digest; loaded revisions
recompile every deterministic claim and map. `read(questionRef)` selects the
question slot by ID and returns its historical answer, pending intent, epoch and
explicit status. It establishes no current source authority. Every new source
expansion still uses the real pinned query/source admission owners.
`readRevision(receipt)` loads an exact older immutable revision. A receipt locates
content; historical inspection does not prove that a valid orphan manifest was
ever the published head. Reading absent storage creates no answer namespace.

Six regression cases are authored and unexecuted. They cover shared immutable
graphs, stale intent/base conflicts, interrupted replacement and fresh-process
resume, cancellation with reusable orphan objects, corruption/foreign storage,
ordinary-file authority, quota admission, cache cleanup exclusion and preservation
of the actual native-failure lock session. Runtime qualification remains pending.
