# Binary row-frame producer resource lifetime

Status: UNVALIDATED source and authored actual-consumer controls. No runtime,
native, worker, cross-process, physical-link, import-budget or performance checks
were run. Existing bounded-batch, positive-short-write, codec and timing fixtures
remain unchanged and unexecuted for this source batch.

The public binary row-frame producer retains its one-MiB payload buffer, 256-row
offset/length batches, preallocation cap, exact output formats and existing
offsets/lengths/data publication order. Original FileHandle write, truncate, sync,
stat and close methods are captured by the existing contained-file owner for each
of the three exclusive staging files. All admitted sync and close promises settle
before the producer decides whether publication or cleanup is allowed.

The actual source iterator factory, next and return methods keep their original
receivers. Sync iterator values, including a final return value, retain their
promised-value semantics. Failure captures its original observer before source
return or descriptor destruction. An absent/false marker or later method
replacement cannot authorize closing while original work remains pending. Native
write progress is strict; nonvoid truncate/sync/close acknowledgements cannot
become success. Falsey/frozen primary and independent close failures compose.

Source protocol and original operation prerequisites are captured before native
close failures are produced. A same-owner outward close error is never inserted
back into that owner's own release predicate. Failed/unconfirmed close preserves
the actual private descriptor sessions and every temporary pathname. Close-only
reconciliation never consumes more rows, rewrites payload, reallocates, syncs,
publishes or removes metadata.

If original pending work prevented the first source return, the nonenumerable
`binaryColumnarSourceClose` capability can explicitly attempt that captured return
after the original observations settle. It neither calls next nor retries a known
failed return. Its `{closed}` result describes iterator protocol completion; it
does not prove arbitrary native resource settlement. Once that protocol and every
independent prerequisite are confirmed, the existing descriptor sessions may
explicitly close their exact FileHandles. Uncaptured or failed source closure stays
unknown; no path/serialization/PID can reconstruct those original methods.

Only confirmed closed staging files are sealed for publication. Exact object,
extent and parent checks precede the existing replacement owner. Cleanup verifies
the admitted original object and parent, preserving a replaced namespace. Parent
directory sync uses the existing owner after each individual commit. A later
parent failure preserves the published prefix and uncommitted staging, carrying
the actual parent descriptor capability rather than reporting full success.

The new authored producer fixture covers captured methods and truncation, late
close-only recovery, pending original write/sync, first-return recovery without
row replay, partial open admission, failed return, falsey primaries, replaced
staging and post-prefix parent close. It uses only disposable file/iterator seams.

This is not a generation transaction or new resource registry. Three final paths
still have separate publication boundaries; callers retain their manifest/replay
and category admission responsibilities. Mutable external sources, abandoned
producers, final compare/syscall races, platform durability and whole-generation
recovery remain explicit independent limits. No JSON-stream, token-postings loader,
quantization codec, embedding-cache or compiler/semantic producer is edited.
