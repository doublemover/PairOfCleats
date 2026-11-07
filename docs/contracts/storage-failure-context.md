# Storage failure context and original diagnostic ownership

Status: **UNVALIDATED source and authored regressions**. No fixture, syntax,
format, bootstrap, native or publication acceptance has been executed for this
change. Historical workspace receipts are not clean-checkout evidence.

`addStorageFailureContext` retains the original object when ordinary context can
be attached safely. Frozen objects, readonly collisions and independent errors
use an aggregate with the exact primary cause. A primitive is wrapped with its
exact value as `cause`, including `false`, zero, an empty string, null and
undefined. The existing null/undefined no-secondary convention remains;
`secondaryPresent: true` identifies an actual caught secondary with either value.
This is an internal call option, not a public configuration surface.

Original ownership observers are captured once and called with their original
receiver, including observers whose pending marker is absent or false. Context
ownership fields add prerequisites; they cannot replace the original predicate.
An unreadable marker or observer remains unknown. Errors thrown while reading
those properties are retained independently, with their own original observers.

The aggregate fallback reads the original message once. A message getter failure
is retained rather than discarded. Descriptor copying skips message, stack and
owned control fields before inspecting their descriptors, avoiding incidental
lazy stack preparation. Readonly data descriptors remain readonly. Copied
accessors run on their original receiver and preserve their exact thrown values.
Getter and predicate failures discovered later remain in private diagnostic
history even when the public error or its initial `errors` array is frozen.
Aggregate ownership accessors remain live for later copied-accessor failures;
an initially unmarked diagnostic cannot erase work discovered by a later getter.

`readStorageFailureContext` returns only a private actual-producer snapshot:
`{complete, inspectionErrors, inspectionObservations}`. Each observation carries
the exact inspected error and its captured receiver-bound predicate; consumers
do not reread replaceable lifecycle fields. It follows relationships between
context helper calls, never arbitrary causes, getters or field lookalikes.
Diagnostics and traversal are bounded; overflow makes the snapshot incomplete
and cannot authorize release. The snapshot grants no mutation, deletion,
resource admission or settlement authority.

The actual storage directory and transfer owners synchronize these inspection
errors before native close and explicit close retry. Each independent observer
adds a blocker. They do not recapture their own outward `isSettled` method as an
independent prerequisite. Their existing private producer identity still
distinguishes exact same-owner failures from lookalikes. A message or accessor
inspection discovered after an initial failed close therefore gates the later
retry; no read, copy, write or enumeration is replayed to manufacture evidence.

Configuration waits for all independent observations, retaining falsey failures
and code-inspection errors from both the selected path and missing-path ancestor.
Failed coordinator release preserves the original non-null operation failure
and exposes only the actual retained metadata lock. Official release and
Windows setup context inspections explicitly identify caught null/undefined
secondaries rather than dropping them through the legacy sentinel.

Authored controls are `operation-error-context-lifetime.test.js` and
`context-inspection-native-close.test.js`. They cover falsey independent errors,
message read counts, readonly/accessor receivers, frozen and late failures,
unknown original evidence, actual configuration observations and metadata locks,
plus disposable Dir/FileHandle close counters and observer replacement. They
have not run. They provide no cross-process durability, crash, hostile mutation,
Windows filesystem, native cancellation or full installation qualification.
