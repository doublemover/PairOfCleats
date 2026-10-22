# Service job exit-code admission

Status: **UNVALIDATED source and authored regressions**. No fixture, formatting,
bootstrap, worker, native binding or queue runtime acceptance has run.

The existing job completion owner accepts safe integer exit codes and decimal
integer strings, including the existing trimmed string input. Numeric zero is
successful only when the existing signal policy also permits success. Signed
and unsigned Windows crash statuses retain their exact integer value.

Missing, null, Boolean, container, BigInt, fractional, nonfinite, unsafe integer
and nondecimal string statuses take the existing exit-1 failure path. Conversion
hooks on foreign objects are never invoked. A missing process exit status cannot
become zero through JavaScript coercion; a fractional failure cannot be rounded
to zero. No retry limit, lease authority or queue schema changes.

The actual completion fixture authors both existing retry and exhausted-quarantine
paths, retained lease owner/version, failure metrics, ordinary zero success,
decimal string compatibility and original Windows crash integers. These controls
are unrun. This does not repair resource-cleanup failure recovery, prove native
closure, or change the separate cancellation and signal policies. The queue
worker still needs a durable recovery design for failed lifecycle cleanup; a
logged close error and removal of an active job are not settlement evidence.
