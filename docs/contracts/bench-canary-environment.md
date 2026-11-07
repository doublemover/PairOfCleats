# Canary child environment evidence

Live canaries resolve one immutable executable/argument/cwd/environment plan
after expanding their supported runner tokens. Parent environment capture is
separate from effective child evidence. Version probes resolve commands through
the existing bounded binary-discovery and Windows invocation owners using the
same selected cwd and final environment passed to the actual child. Later parent
environment edits cannot change that launch. Windows environment aliases are
merged once so overrides replace their inherited case variants.

Context version **2** binds the safe selected child environment, observed child
Node runtime, resolved executable observations, cwd and requested probe outcomes.
Canonical hashing preserves key-order equivalence. Task-owned operational paths
remain in provenance and are normalized separately for comparable dimensions.
Executable stat observations remain advisory selection evidence, not a binary
content or full provider qualification.

The existing diagnostic environment projector remains the allowlist/redaction
owner. Full execution values are private, immutable and non-enumerable; they are
never serialized as a report or environment cache key. Unknown child overrides
remain visible by key with partial comparison coverage. Unavailable probes retain
unknown runtime/version evidence and cannot yield a comparison fingerprint.
Injected probes are explicitly synthetic. Informational Git/npm unavailability
does not fail an unrelated workload; missing required evidence prevents blocker
closure qualification while preserving the workload's own observed result.

Probe snapshots are memoized only within one immutable runner invocation. A new
invocation probes afresh, including equivalent-looking contexts whose local tool
configuration could have changed. This replaces the old process-lifetime cache
keyed only by declared prose and probe IDs. No opaque secret-derived fingerprint,
public cache-control setting or extra provider installation is introduced.

The context fixture compares exact cwd/allowed values seen by injected probes
and real Node children, including a parent edit between probe and launch. Real
fixture commands on two PATHs exercise selection without external providers.
Reverse key order, private values, changed cwd/settings, unavailable versions
and invocation-local reuse have independent assertions. Synthetic probe evidence
cannot qualify real provider execution or release acceptance.
