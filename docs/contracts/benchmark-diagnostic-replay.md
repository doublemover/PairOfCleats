# Benchmark diagnostic occurrence replay

Diagnostic stream version 3 adds an execution UUID to every process invocation
and its summary. Every event retains its existing diagnostic fingerprint and
positive process-local occurrence counter. Mirrored files receive the same
payload. `costSemantics: "occurrence-delta"` declares the numeric fields as costs
or work reported for that occurrence. Fingerprints and interactive log layout
retain their existing identity; an execution restart receives a new UUID.

The report distinguishes four scopes:

- Fingerprint presence per repository/source supplies the existing parity counts.
- Repository/type presence supplies the existing repository parity denominator.
- Execution/repository/fingerprint/occurrence identity supplies logical occurrence
  counts and cost accumulation.
- Repeated copies of that identity supply transport duplicate counts.

Two occurrences of one fingerprint therefore retain one parity presence and two
cost deltas. The same fingerprint in repositories A and B retains both repository
presences. A master-stream copy suppresses only its matching observation, so a
missing repository stream cannot cause another repository's evidence to vanish.
An unknown master label stays in an explicit unknown-source bucket; it is not
merged with a known repository. `unknownRepoCountsByType` exposes those buckets
within the legacy repository-presence totals used by parity.

`eventCount` and `uniqueEventCount` keep their presence interpretation.
`occurrenceCount` and `repeatedFingerprintOccurrenceCount` expose repeated work.
Version 3 `duplicateEventCount` counts transport copies; a second legitimate
occurrence is no longer called a duplicate. `mirrorDuplicateCount` identifies
copies found across files. Conflicting content for one qualified occurrence
marks the replay incomplete and cannot add another cost.

Cost fields preserve primitive finite nonnegative numbers; work counts require
safe integers. Null, omitted, string, boolean, negative and nonfinite values stay
unknown. True zero is observed. `cost` holds the observed sum, or null when no
observation exists. `costCoverage` retains observed/unknown counts and completeness
for each field. `costScope` explicitly identifies summed observed occurrence
deltas, which may overlap and do not measure wall duration.

Historical version 1/2 and unversioned rows remain readable. Their known projected
fields, timestamp, label and occurrence support exact-copy matching, but cannot
prove execution identity across restarts or indistinguishable legacy copies.
`identityCoverage.state: "legacy-unqualified"` preserves that uncertainty.
Historical rows are not silently promoted to the current execution contract.
Unknown current cost semantics and unsupported future versions make replay
incomplete and cannot supply numeric costs.

One invocation-local owner retains at most 100,000 distinct occurrence identities;
private fixtures may lower that allowance. Its keys are digests, not raw-log
caches. Exhausted identity allowance, conflicting copies or aggregate overflow
remain incomplete and prevent a passing parity claim. The existing captured-file,
bounded-line, single-pass transport is unchanged; reducers do not reread files.

Existing presence and material-parity assertions remain. The older summary
fixture's duplicate oracle changes because its fallback occurrence 2 is real
work, not a mirrored copy. New actual JSONL controls cover repeated costs, exact
mirrors, master-only repositories, partial master fallback, restarts, reordered
inventory, unknown labels, legacy uncertainty, conflicting copies, bounds and
zero/unknown cost admission. The real process fixture also checks the common
execution ID and delta receipt. Functional execution remains deferred with the
implementation wave.
