# Throughput result input admission

Throughput report version 2 records the selected result-file cohort before
aggregating it. Its completeness receipt does not qualify optional derived
analysis readers, workload success or backend execution.
Supported current/unversioned benchmark envelopes, legacy measured summaries and
recognized artifact measurement wrappers are distinct from unrelated JSON.
Canonical zero-work and failed-run envelopes remain visible. Nonempty run arrays
and summary fields must have supported shapes; malformed runs cannot masquerade
as empty measurements. Supported legacy
files do not need an invented new schema version. Known non-run reports, canonical terminal receipts and attempt snapshots
are explicitly excluded; unsupported envelopes and versions fail input admission.
Dates, filenames and truthy JSON alone cannot establish a benchmark run.

One shared input owner serves inspection and explicit materialization. It
enumerates ordinary directory entries through the existing storage-directory
owner and reads contained files with bounded UTF-8/JSON admission. Missing,
unreadable, malformed, oversized, changed and unsupported inputs retain their
filename, bounded cause code and any captured source bytes/hash. Causes do not
include arbitrary file contents. Original resource-settlement failures propagate;
classification cannot turn unknown closure into a passing read.

Metadata admission is sequential. It retains resolved repository/history
identity, recorded timestamp, filename, source extent/digest and selection state,
without retaining every parsed payload. Existing repository/history normalization
now has a thin shared owner; analysis reexports it with unchanged semantics. Repository filtering precedes latest-N
selection through the existing timestamp and stable-filename tie owner. Missing
timestamps keep their existing oldest ordering. Filename/mtime ordering does not
replace the documented selection policy.

Selected bodies are read again against their original byte length, SHA-256 and
private descriptor identity before expensive sections are derived. Descriptor
authority is not serialized into the receipt. Changed/missing selected files
cannot acquire their earlier metadata identity. The selector's pure ordering
fixture now uses a recognized zero-query envelope instead of arbitrary `{}`;
its repository/latest/tie assertions remain unchanged.

Fixed invocation allowances are 32 MiB per file, 512 MiB read allowance, 128 MiB
retained selected payload bytes, 8 MiB retained file metadata and 10,000 discovered
JSON files. Private fixtures may lower them. A bounded stop receipt records
inventory exhaustion without retaining another oversized metadata body. Failed
native reads reserve their admitted read allowance because their exact I/O extent
may be unavailable; observed successful read bytes remain a separate counter.
These are encoded-byte allowances, not heap or process-tree RSS measurements.

The owner yields between files and derivation phases and observes cancellation.
It owns only its signal listeners and directory/file readers; it does not create
another subprocess or timeout supervisor. Receipt counts distinguish discovered,
selected, admitted, processed, excluded and failed inputs, plus inventory and
cancellation state. An empty cohort is different from a partial/unreadable one.
Useful healthy observations can still be shown from a partial cohort, but both
inspection and materialization return nonzero status for incomplete inputs.

Inspection performs no writes. Explicit materialization processes only admitted
run inputs and reports input failures separately from write failures; rejected
and non-run documents remain untouched. No user cache is deleted or repaired as
part of admission.

Comparison version 2 requires both versioned report envelopes and complete,
internally consistent input receipts before computing deltas. Nonzero/signal,
truncated or invalid child output, wrong schemas, partial cohorts and empty
selected work produce an incomparable disposition with no numeric comparison
rows. Child output uses the existing bounded subprocess capture owner. Input
completeness does not prove comparable workload semantics, relevance, runtime
qualification or statistical performance; those retain their separate owners.

New small controls cover healthy plus truncated/unrelated/legacy/failed inputs,
latest selection, missing/changed selected files, read/retention/metadata/file
allowances, cancellation, no inspection writes, rejected materialization inputs,
zero-exit wrong/partial child output and explicit empty reports. Existing positive
profile/comparison assertions remain. Functional execution is deferred with the
implementation wave.

Throughput report/comparison version 3 projects the selected focused mode into
text, JSON and CSV rows, including variability and line rates. `extractedProse`
normalizes to `extracted-prose`. Comparison numeric sorting consumes the current
comparison values; unsupported combinations fail explicitly. Repository/latest
selection does not modify source reports. Run-level waiver policy findings affect
verdict and issue counts without inflating repository result-class denominators.
